import { parseRaw } from "./classify.js";

export interface SuggestionSeed {
  channel_id: string;
  title: string | null;
  handle: string | null;
  raw_json: string | null;
}

export interface SearchSuggestion {
  term: string;
  seed_count: number;
  seeds: Array<{
    channel_id: string;
    title: string | null;
    handle: string | null;
  }>;
}

const GENERIC_TERMS = new Set([
  "video",
  "videos",
  "youtube",
  "channel",
  "official",
  "shorts",
  "short",
  "clips",
  "music",
  "food",
  "science",
]);

export function aggregateSeedSuggestions(
  seeds: SuggestionSeed[],
  limit = 30,
  blockedTerms: Set<string> = new Set(),
): SearchSuggestion[] {
  const byTerm = new Map<string, SearchSuggestion>();

  for (const seed of seeds) {
    for (const term of seedSuggestionTerms(seed, blockedTerms)) {
      const existing = byTerm.get(term) ?? { term, seed_count: 0, seeds: [] };
      existing.seed_count += 1;
      existing.seeds.push({
        channel_id: seed.channel_id,
        title: seed.title,
        handle: seed.handle,
      });
      byTerm.set(term, existing);
    }
  }

  return [...byTerm.values()]
    .sort((a, b) => b.seed_count - a.seed_count || a.term.localeCompare(b.term))
    .slice(0, limit);
}

export function seedSuggestionTerms(
  seed: SuggestionSeed,
  blockedTerms: Set<string> = new Set(),
): string[] {
  const ownTokens = ownNameTokens(seed);
  const terms = new Set(seedTerms(seed.raw_json).map(normalizeSuggestionTerm).filter(Boolean));
  return [...terms]
    .filter((term) => !blockedTerms.has(term) && !shouldDropTerm(term, ownTokens))
    .sort((a, b) => a.localeCompare(b));
}

function seedTerms(rawJson: string | null): string[] {
  const raw = parseRaw(rawJson);
  if (!raw || typeof raw !== "object") return [];
  const record = raw as Record<string, unknown>;
  const terms: string[] = [];
  for (const key of ["tags", "keywords"]) {
    const value = record[key];
    if (Array.isArray(value)) {
      terms.push(...value.filter((item): item is string => typeof item === "string"));
    } else if (typeof value === "string") {
      terms.push(...value.split(/[,\n]/));
    }
  }
  return terms;
}

export function normalizeSuggestionTerm(value: string): string {
  return value
    .toLowerCase()
    .replace(/[#"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function shouldDropTerm(term: string, ownTokens: Set<string>): boolean {
  if (!term) return true;
  if (GENERIC_TERMS.has(term)) return true;
  const words = term.split(/\s+/).filter(Boolean);
  if (words.length === 1 && (words[0].length < 4 || GENERIC_TERMS.has(words[0]))) return true;
  return words.every((word) => ownTokens.has(word));
}

function ownNameTokens(seed: SuggestionSeed): Set<string> {
  return new Set(
    `${seed.title ?? ""} ${seed.handle ?? ""}`
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3),
  );
}
