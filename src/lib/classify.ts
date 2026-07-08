export type ChannelKind = "creator" | "brand" | "alt";

export interface ClassifiableChannel {
  channel_id: string;
  handle: string | null;
  title: string | null;
  description: string | null;
  subscriber_count?: number | null;
  raw_json: string | null;
}

export interface SeedIdentity {
  channel_id: string;
  handle: string | null;
  title: string | null;
  raw_json?: string | null;
}

export interface Classification {
  kind: ChannelKind;
  reason: string;
}

export const BRAND_TOKENS = [
  "official",
  "inc",
  "llc",
  "ltd",
  "studios",
  "studio",
  "entertainment",
  "pictures",
  "films",
  "media",
  "cookware",
  "supplements",
  "superfoods",
  "foods",
  "shop",
  "store",
  "company",
  "brand",
  "products",
  "kitchen",
  "global",
  "network",
  "corporation",
  "corp",
  "amazon",
  "sony",
];

const PRODUCT_FIRST_PATTERNS = [
  /\bour products?\b/i,
  /\bshop\b/i,
  /\bbuy\b/i,
  /\border now\b/i,
  /\bcustomers?\b/i,
  /\bwe (make|sell|offer|provide|build|deliver)\b/i,
  /\bpremium (cookware|supplements|products|service)\b/i,
  /\bfor businesses\b/i,
  /\bb2b\b/i,
];

const CREATOR_PATTERNS = [
  /\bi (make|cook|teach|try|review|explore|build|create|host)\b/i,
  /\bmy channel\b/i,
  /\bjoin me\b/i,
  /\bfollow me\b/i,
  /\bpatreon\b/i,
];

const PERSONAL_DOMAINS = [
  "patreon.com",
  "instagram.com",
  "tiktok.com",
  "twitter.com",
  "x.com",
  "threads.net",
  "substack.com",
];

const SHOP_DOMAINS = [
  "shop",
  "store",
  "amazon.",
  "myshopify.com",
  "shopify.com",
  "buy",
  "products",
];

const TOKEN_STOPWORDS = new Set([
  "the",
  "and",
  "with",
  "plus",
  "extra",
  "clips",
  "vods",
  "vod",
  "official",
  "channel",
  "show",
  "tv",
  "videos",
  "video",
]);

export function classifyChannel(
  channel: ClassifiableChannel,
  seeds: SeedIdentity[],
): Classification {
  const raw = parseRaw(channel.raw_json);
  const title = channel.title ?? "";
  const handle = channel.handle ?? "";
  const description = channel.description ?? "";
  const links = extractLinks(raw);
  const text = `${title} ${handle} ${description}`.toLowerCase();

  const altReason = altReasonFor(channel, seeds, links);
  if (altReason) {
    return { kind: "alt", reason: altReason };
  }

  const brandReason = brandReasonFor(title, description, links);
  if (brandReason) {
    return { kind: "brand", reason: brandReason };
  }

  if (CREATOR_PATTERNS.some((pattern) => pattern.test(description))) {
    return { kind: "creator", reason: "first-person creator description" };
  }

  if (hasPersonalLinks(links) && looksPersonLike(title, handle)) {
    return { kind: "creator", reason: "person-like channel with personal social links" };
  }

  if (looksPersonLike(title, handle) && !BRAND_TOKENS.some((token) => text.includes(token))) {
    return { kind: "creator", reason: "person-like channel name" };
  }

  return { kind: "creator", reason: "default creator classification; no strong brand or alt signal" };
}

export function extractLinks(raw: unknown): string[] {
  if (!raw || typeof raw !== "object") return [];
  const record = raw as Record<string, unknown>;
  const links = new Set<string>();

  for (const key of ["store", "twitter", "instagram", "tiktok", "channel"]) {
    const value = record[key];
    if (typeof value === "string" && value) links.add(value);
  }

  const rawLinks = record.links;
  if (Array.isArray(rawLinks)) {
    for (const link of rawLinks) {
      if (typeof link === "string" && link) links.add(link);
    }
  }

  return [...links];
}

export function parseRaw(rawJson: string | null | undefined): unknown {
  if (!rawJson) return null;
  try {
    return JSON.parse(rawJson) as unknown;
  } catch {
    return null;
  }
}

function altReasonFor(
  channel: ClassifiableChannel,
  seeds: SeedIdentity[],
  links: string[],
): string | null {
  const channelTokens = distinctiveTokens(channel.title, channel.handle);

  for (const seed of seeds) {
    if (channel.channel_id === seed.channel_id) continue;

    const seedHandle = seed.handle?.replace(/^@/, "").toLowerCase();
    const seedTokens = distinctiveTokens(seed.title, seed.handle);
    const overlap = [...channelTokens].filter((token) => seedTokens.has(token));
    if (overlap.length > 0) {
      return `shares distinctive token "${overlap[0]}" with seed ${seed.title ?? seed.handle}`;
    }

    if (
      seedHandle &&
      links.some((link) => link.toLowerCase().includes(`youtube.com/@${seedHandle}`))
    ) {
      return `links to seed handle @${seedHandle}`;
    }

    if (links.some((link) => link.includes(seed.channel_id))) {
      return `links to seed channel ${seed.channel_id}`;
    }
  }

  return null;
}

function brandReasonFor(
  title: string,
  description: string,
  links: string[],
): string | null {
  const titleLower = title.toLowerCase();
  const matchedToken = BRAND_TOKENS.find((token) =>
    new RegExp(`\\b${escapeRegExp(token)}\\b`, "i").test(titleLower),
  );
  if (matchedToken) return `title contains corporate token "${matchedToken}"`;

  const opening = description.slice(0, 320);
  const matchedPattern = PRODUCT_FIRST_PATTERNS.find((pattern) => pattern.test(opening));
  if (matchedPattern) return "description is product/company-first";

  if (links.length > 0) {
    const shopLinks = links.filter((link) => {
      const lower = link.toLowerCase();
      return SHOP_DOMAINS.some((domain) => lower.includes(domain));
    });
    if (shopLinks.length / links.length >= 0.6) {
      return "links are dominated by shop/product domains";
    }
  }

  return null;
}

function hasPersonalLinks(links: string[]): boolean {
  return links.some((link) => {
    const lower = link.toLowerCase();
    return PERSONAL_DOMAINS.some((domain) => lower.includes(domain));
  });
}

function looksPersonLike(title: string, handle: string): boolean {
  const words = title
    .split(/\s+/)
    .map((word) => word.replace(/[^A-Za-z'-]/g, ""))
    .filter(Boolean);

  if (words.length >= 2 && words.length <= 4) {
    return words.every((word) => /^[A-Z][a-zA-Z'-]+$/.test(word));
  }

  return /^[a-z]+[a-z0-9]*$/.test(handle) && !handle.includes("official");
}

function distinctiveTokens(title: string | null | undefined, handle: string | null | undefined): Set<string> {
  const text = `${title ?? ""} ${handle ?? ""}`.toLowerCase();
  const tokens = text
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 5 && !TOKEN_STOPWORDS.has(token));
  return new Set(tokens);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
