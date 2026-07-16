import { Env } from "./scrapecreators.js";
import { normalizeSuggestionTerm } from "./suggestions.js";

const ANTHROPIC_ORIGIN = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = "claude-haiku-4-5";

export interface SeedQueryPrompt {
  title: string | null;
  handle: string | null;
  description: string | null;
  videoTitles: string[];
  blockedTerms?: Set<string>;
}

export interface DeepVariantPrompt {
  baseQuery: string;
}

export interface AnthropicQueryResult {
  queries: string[];
  inputTokens: number;
  outputTokens: number;
  rawResponseText: string;
}

export class AnthropicApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AnthropicApiError";
  }
}

export class AnthropicClient {
  constructor(private readonly env: Env) {}

  async generateSeedQueries(prompt: SeedQueryPrompt): Promise<AnthropicQueryResult> {
    if (!this.env.ANTHROPIC_API_KEY) {
      throw new AnthropicApiError(401, "ANTHROPIC_API_KEY is not configured.");
    }

    return this.requestQueries({
      system: seedSystemPrompt(prompt.blockedTerms ?? new Set()),
      user: seedUserPrompt(prompt),
      blockedTerms: prompt.blockedTerms ?? new Set(),
      maxQueries: 6,
    });
  }

  async generateDeepVariants(prompt: DeepVariantPrompt): Promise<AnthropicQueryResult> {
    if (!this.env.ANTHROPIC_API_KEY) {
      throw new AnthropicApiError(401, "ANTHROPIC_API_KEY is not configured.");
    }

    return this.requestQueries({
      system: deepVariantSystemPrompt(),
      user: JSON.stringify({ base_query: prompt.baseQuery }),
      blockedTerms: new Set(),
      maxQueries: 4,
      rejectLazySuffixBase: prompt.baseQuery,
    });
  }

  private async requestQueries({
    system,
    user,
    blockedTerms,
    maxQueries,
    rejectLazySuffixBase,
  }: {
    system: string;
    user: string;
    blockedTerms: Set<string>;
    maxQueries: number;
    rejectLazySuffixBase?: string;
  }): Promise<AnthropicQueryResult> {
    if (!this.env.ANTHROPIC_API_KEY) {
      throw new AnthropicApiError(401, "ANTHROPIC_API_KEY is not configured.");
    }

    const payload = {
      model: MODEL,
      max_tokens: 400,
      system,
      messages: [
        {
          role: "user",
          content: user,
        },
      ],
    };

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await this.logApiCall();
      const response = await fetch(new URL("/v1/messages", ANTHROPIC_ORIGIN), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.env.ANTHROPIC_API_KEY,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify(payload),
      });

      if (response.status >= 500 && attempt === 0) {
        await delay(500);
        continue;
      }

      if (!response.ok) {
        throw new AnthropicApiError(response.status, await response.text());
      }

      const body = await response.json() as AnthropicResponse;
      const rawResponseText = extractText(body);
      return {
        queries: parseAnthropicQueries(rawResponseText, blockedTerms, {
          maxQueries,
          rejectLazySuffixBase,
        }),
        inputTokens: Number(body.usage?.input_tokens ?? 0),
        outputTokens: Number(body.usage?.output_tokens ?? 0),
        rawResponseText,
      };
    }

    throw new AnthropicApiError(500, "Anthropic request failed after retry.");
  }

  private async logApiCall(): Promise<void> {
    await this.env.SCOUT_DB.prepare(
      "INSERT INTO api_log (endpoint, credits_estimated) VALUES ('anthropic', 0)",
    ).run();
  }
}

interface AnthropicResponse {
  content?: Array<{ type?: string; text?: string }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

export function parseAnthropicQueries(
  text: string,
  blockedTerms: Set<string> = new Set(),
  options: {
    maxQueries?: number;
    rejectLazySuffixBase?: string;
  } = {},
): string[] {
  const maxQueries = options.maxQueries ?? 6;
  const normalized = stripCodeFence(text).trim();
  const start = normalized.indexOf("[");
  const end = normalized.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Anthropic response did not contain a JSON array.");
  }

  const value = JSON.parse(normalized.slice(start, end + 1)) as unknown;
  if (!Array.isArray(value)) {
    throw new Error("Anthropic response was not a JSON array.");
  }

  const queries: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const term = normalizeSuggestionTerm(item)
      .replace(/[^a-z0-9 '&.-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const words = term.split(/\s+/).filter(Boolean);
    if (words.length < 2 || words.length > 4) continue;
    if (term.length > 64) continue;
    if (blockedTerms.has(term)) continue;
    if (options.rejectLazySuffixBase && isLazyDeepVariant(options.rejectLazySuffixBase, term)) continue;
    if (!queries.includes(term)) queries.push(term);
    if (queries.length === maxQueries) break;
  }

  if (queries.length === 0) {
    throw new Error("Anthropic response contained no valid queries.");
  }

  return queries;
}

function isLazyDeepVariant(baseQuery: string, term: string): boolean {
  const base = normalizeSuggestionTerm(baseQuery);
  if (!base || !term.startsWith(`${base} `)) return false;
  const suffix = term.slice(base.length).trim();
  return suffix === "review" || suffix === "how to" || suffix === "vs";
}

function extractText(body: AnthropicResponse): string {
  return (body.content ?? [])
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
}

function stripCodeFence(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
}

function seedSystemPrompt(blockedTerms: Set<string>): string {
  const blocked = [...blockedTerms].slice(0, 80);
  return [
    "You generate YouTube search queries for a talent scout hunting SIMILAR CREATORS to this channel.",
    "Return exactly 6 queries.",
    "Rules: concrete subjects only (dishes, vehicles, techniques, games, topics); proper nouns encouraged (\"pagani huayra review\", \"carne asada recipe\", \"salsa roja\"); 2-4 words; lowercase; NEVER clickbait fragments, channel-meta phrases (book tour, announcement, giveaway, merch), the channel's own name, or generic single-word topics.",
    blocked.length > 0 ? `Do not return any of these dismissed terms: ${blocked.join(", ")}.` : "",
    "Respond ONLY with a JSON array of 6 strings.",
  ].filter(Boolean).join("\n");
}

function deepVariantSystemPrompt(): string {
  return [
    "You generate YouTube search query variants for a creator discovery operator.",
    "Return exactly 4 queries that explore the SAME niche from different concrete angles.",
    "Use adjacent dishes, techniques, ingredients, subtopics, proper nouns, or creator-audience language.",
    "Each query must be 2-4 words, lowercase, and scout-usable.",
    "NEVER return lazy suffix appends of the base query such as adding only \"review\", \"how to\", or \"vs\".",
    "NEVER return clickbait fragments, channel-meta phrases, announcements, giveaways, merch, or generic single-word topics.",
    "Respond ONLY with a JSON array of 4 strings.",
  ].join("\n");
}

function seedUserPrompt(prompt: SeedQueryPrompt): string {
  return JSON.stringify({
    channel_title: prompt.title,
    channel_handle: prompt.handle,
    description_excerpt: (prompt.description ?? "").slice(0, 200),
    recent_video_titles: prompt.videoTitles.slice(0, 30),
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
