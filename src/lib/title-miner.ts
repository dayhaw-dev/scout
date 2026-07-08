export interface TitleMiningSeed {
  channel_id: string;
  title: string | null;
  handle: string | null;
  description?: string | null;
  latest_video_at?: string | null;
  video_count?: number;
  videos: Array<string | TitleMiningVideo>;
}

export interface TitleMiningVideo {
  title: string;
  published_at: string | null;
}

export interface MinedTitlePhrase {
  term: string;
  seed_count: number;
  count: number;
  score: number;
  seeds: Array<{
    channel_id: string;
    title: string | null;
    handle: string | null;
  }>;
}

export const TITLE_MINER_STOPWORDS = new Set([
  "a",
  "about",
  "after",
  "all",
  "and",
  "announcement",
  "are",
  "at",
  "behind",
  "best",
  "book",
  "but",
  "by",
  "can",
  "channel",
  "cook",
  "cooking",
  "day",
  "days",
  "did",
  "do",
  "does",
  "dont",
  "easy",
  "episode",
  "ep",
  "for",
  "giveaway",
  "from",
  "full",
  "get",
  "how",
  "in",
  "insane",
  "is",
  "it",
  "make",
  "makes",
  "making",
  "merch",
  "new",
  "of",
  "on",
  "one",
  "part",
  "podcast",
  "send",
  "recipe",
  "recipes",
  "review",
  "should",
  "special",
  "the",
  "this",
  "to",
  "tour",
  "try",
  "trying",
  "update",
  "video",
  "vs",
  "watch",
  "we",
  "what",
  "why",
  "will",
  "with",
  "wow",
  "you",
  "your",
]);

export const TITLE_MINER_STOP_PHRASES = [
  "book tour",
  "announcement",
  "special announcement",
  "live stream",
  "livestream",
  "q and a",
  "q a",
  "channel update",
  "giveaway",
  "merch",
  "podcast",
  "behind the scenes",
  "full send",
];

export function mineSeedTitlePhrases(
  seed: TitleMiningSeed,
  allSeeds: TitleMiningSeed[] = [seed],
  limit = 5,
  blockedTerms: Set<string> = new Set(),
): MinedTitlePhrase[] {
  const global = aggregatePhraseCounts(allSeeds);
  return rankedPhrasesForSeed(seed, global, allSeeds.length, blockedTerms).slice(0, limit);
}

export function aggregateTitleQuerySuggestions(
  seeds: TitleMiningSeed[],
  limit = 30,
  blockedTerms: Set<string> = new Set(),
): MinedTitlePhrase[] {
  const global = aggregatePhraseCounts(seeds);
  const merged = new Map<string, MinedTitlePhrase>();

  for (const seed of seeds) {
    for (const phrase of rankedPhrasesForSeed(seed, global, seeds.length, blockedTerms)) {
      const existing = merged.get(phrase.term) ?? {
        ...phrase,
        count: 0,
        seed_count: 0,
        seeds: [],
      };
      existing.count += phrase.count;
      existing.score += phrase.score;
      if (!existing.seeds.some((item) => item.channel_id === seed.channel_id)) {
        existing.seed_count += 1;
        existing.seeds.push({
          channel_id: seed.channel_id,
          title: seed.title,
          handle: seed.handle,
        });
      }
      merged.set(phrase.term, existing);
    }
  }

  return dedupeNearIdentical([...merged.values()]
    .sort((a, b) => b.score - a.score || b.count - a.count || a.term.localeCompare(b.term)))
    .slice(0, limit);
}

function rankedPhrasesForSeed(
  seed: TitleMiningSeed,
  global: Map<string, { count: number; seedIds: Set<string> }>,
  seedTotal: number,
  blockedTerms: Set<string>,
): MinedTitlePhrase[] {
  const counts = seedPhraseCounts(seed);
  const phrases = [...counts.entries()]
    .filter(([term]) => !blockedTerms.has(term))
    .map(([term, count]) => {
      const globalEntry = global.get(term);
      const seedCount = globalEntry?.seedIds.size ?? 1;
      const distinctiveness = Math.log2(seedTotal + 1) / seedCount;
      const lengthBonus = term.split(" ").length === 3 ? 1.18 : 1;
      return {
        term,
        seed_count: seedCount,
        count,
        score: count * distinctiveness * lengthBonus,
        seeds: [{
          channel_id: seed.channel_id,
          title: seed.title,
          handle: seed.handle,
        }],
      };
    })
    .sort((a, b) => b.score - a.score || b.count - a.count || a.term.localeCompare(b.term));

  return dedupeNearIdentical(phrases);
}

function aggregatePhraseCounts(seeds: TitleMiningSeed[]): Map<string, { count: number; seedIds: Set<string> }> {
  const global = new Map<string, { count: number; seedIds: Set<string> }>();
  for (const seed of seeds) {
    for (const [term, count] of seedPhraseCounts(seed)) {
      const existing = global.get(term) ?? { count: 0, seedIds: new Set<string>() };
      existing.count += count;
      existing.seedIds.add(seed.channel_id);
      global.set(term, existing);
    }
  }
  return global;
}

function seedPhraseCounts(seed: TitleMiningSeed): Map<string, number> {
  const ownTokens = ownNameTokens(seed);
  const counts = new Map<string, number>();
  for (const video of seed.videos) {
    const title = typeof video === "string" ? video : video.title;
    const weight = typeof video === "string" ? 1 : recencyWeight(video.published_at);
    const tokens = titleTokens(title, ownTokens);
    for (const size of [2, 3]) {
      for (let index = 0; index <= tokens.length - size; index += 1) {
        const phrase = tokens.slice(index, index + size).join(" ");
        if (shouldDropPhrase(phrase)) continue;
        counts.set(phrase, (counts.get(phrase) ?? 0) + weight);
      }
    }
  }
  return counts;
}

function titleTokens(title: string, ownTokens: Set<string>): string[] {
  return title
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/\b(?:ep|episode|part)\s*\d+\b/g, " ")
    .replace(/\b\d+[a-z]*\b/g, " ")
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) =>
      token.length >= 3 &&
      !TITLE_MINER_STOPWORDS.has(token) &&
      !ownTokens.has(token),
    );
}

function shouldDropPhrase(phrase: string): boolean {
  const words = phrase.split(" ");
  if (words.length < 2 || words.length > 3) return true;
  if (new Set(words).size !== words.length) return true;
  if (words.every((word) => TITLE_MINER_STOPWORDS.has(word))) return true;
  if (TITLE_MINER_STOP_PHRASES.some((stopPhrase) => phrase.includes(stopPhrase))) return true;
  return false;
}

function recencyWeight(publishedAt: string | null): number {
  if (!publishedAt) return 0.6;
  const published = Date.parse(publishedAt);
  if (!Number.isFinite(published)) return 0.6;
  const ageDays = Math.max(0, (Date.now() - published) / 86_400_000);
  if (ageDays <= 90) return 1;
  if (ageDays >= 365) return 0.2;
  return 1 - ((ageDays - 90) / (365 - 90)) * 0.8;
}

function dedupeNearIdentical(phrases: MinedTitlePhrase[]): MinedTitlePhrase[] {
  const selected: MinedTitlePhrase[] = [];
  for (const phrase of phrases) {
    if (selected.some((existing) => phraseSimilarity(existing.term, phrase.term) >= 0.8)) {
      continue;
    }
    selected.push(phrase);
  }
  return selected;
}

function phraseSimilarity(left: string, right: string): number {
  const a = new Set(left.split(" ").map(stem));
  const b = new Set(right.split(" ").map(stem));
  if ([...a].every((word) => b.has(word)) || [...b].every((word) => a.has(word))) {
    return 1;
  }
  const intersection = [...a].filter((word) => b.has(word)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

function stem(word: string): string {
  return word.replace(/(?:ing|ers|er|ed|es|s)$/u, "");
}

function ownNameTokens(seed: TitleMiningSeed): Set<string> {
  return new Set(
    `${seed.title ?? ""} ${seed.handle ?? ""}`
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3),
  );
}
