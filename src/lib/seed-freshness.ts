import { parseYouTubeVideoFeed, RecentVideo } from "./sponsor-scan.js";

const YOUTUBE_FEED_ORIGIN = "https://www.youtube.com";
const YOUTUBE_RSS_MAX_BYTES = 512_000;
const YOUTUBE_RSS_TIMEOUT_MS = 6_000;
const YOUTUBE_RSS_RETRY_DELAY_MS = 350;
const YOUTUBE_RSS_MAX_ATTEMPTS = 3;

export const YOUTUBE_RSS_ENTRY_LIMIT = 15;
export const SEED_FRESHNESS_CACHE_MS = 6 * 60 * 60 * 1000;
export const SEED_SHORTS_CLASSIFICATION_REQUEST_CAP = 30;
export const SEED_SHORTS_CLASSIFICATION_DELAY_MS = 150;

export const SEED_RSS_ENTRY_UPSERT_SQL = `
  INSERT INTO seed_rss_entries (
    channel_id,
    video_id,
    title,
    published_at,
    feed_position,
    first_seen_at,
    last_seen_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(channel_id, video_id) DO UPDATE SET
    title = excluded.title,
    published_at = excluded.published_at,
    feed_position = excluded.feed_position,
    last_seen_at = excluded.last_seen_at
`;

export interface StoredSeedVideo {
  video_id: string;
  published_at: string | null;
}

export interface PersistedSeedRssEntry {
  channel_id: string;
  video_id: string;
  title: string | null;
  published_at: string | null;
  feed_position: number;
  is_short: number | null;
  classification_attempted_at: string | null;
  classified_at: string | null;
  classification_error: string | null;
  first_seen_at: string;
  last_seen_at: string;
}

export interface SeedShortsClassification {
  is_short: 0 | 1 | null;
  error: string | null;
}

export interface SeedShortsClassificationAttempt extends SeedShortsClassification {
  channel_id: string;
  video_id: string;
  attempted_at: string;
  classified_at: string | null;
}

export interface SeedRssSnapshotAggregates {
  shorts_count: number;
  pending_classification_count: number;
}

export interface DerivedSeedFreshness {
  latest_upload_at: string | null;
  newest_stored_video_at: string | null;
  stored_video_count: number;
  unmined_count: number | null;
  unmined_is_lower_bound: boolean;
  never_mined: boolean;
  rss_entry_count: number;
  shorts_count: number;
  pending_classification_count: number;
}

export class YouTubeRssError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YouTubeRssError";
  }
}

export async function fetchYouTubeRssUploads(
  channelId: string,
  fetcher: typeof fetch = fetch,
): Promise<RecentVideo[]> {
  const url = new URL("/feeds/videos.xml", YOUTUBE_FEED_ORIGIN);
  url.searchParams.set("channel_id", channelId);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), YOUTUBE_RSS_TIMEOUT_MS);

  try {
    let response: Response | null = null;
    for (let attempt = 0; attempt < YOUTUBE_RSS_MAX_ATTEMPTS; attempt += 1) {
      response = await fetcher(url.toString(), {
        headers: {
          accept: "application/atom+xml, application/xml;q=0.9, text/xml;q=0.8",
        },
        signal: controller.signal,
      });
      if (response.ok) break;
      if (
        attempt < YOUTUBE_RSS_MAX_ATTEMPTS - 1
        && isRetryableFeedStatus(response.status)
      ) {
        await delay(YOUTUBE_RSS_RETRY_DELAY_MS * (attempt + 1));
        continue;
      }
      throw new YouTubeRssError(`YouTube RSS feed request failed with ${response.status}.`);
    }
    if (!response?.ok) {
      throw new YouTubeRssError("YouTube RSS feed request failed.");
    }

    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > YOUTUBE_RSS_MAX_BYTES) {
      throw new YouTubeRssError("YouTube RSS feed exceeded the response size limit.");
    }

    const xml = await response.text();
    if (xml.length > YOUTUBE_RSS_MAX_BYTES) {
      throw new YouTubeRssError("YouTube RSS feed exceeded the response size limit.");
    }
    return parseYouTubeVideoFeed(xml).slice(0, YOUTUBE_RSS_ENTRY_LIMIT);
  } catch (error) {
    if (error instanceof YouTubeRssError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new YouTubeRssError("YouTube RSS feed request timed out.");
    }
    throw new YouTubeRssError(
      `YouTube RSS feed request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timeout);
  }
}

function isRetryableFeedStatus(status: number): boolean {
  return status === 404 || status === 429 || status >= 500;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function classifyYouTubeShort(
  videoId: string,
  fetcher: typeof fetch = fetch,
): Promise<SeedShortsClassification> {
  const shortsUrl = new URL(`/shorts/${encodeURIComponent(videoId)}`, YOUTUBE_FEED_ORIGIN);

  try {
    const response = await fetcher(shortsUrl.toString(), {
      method: "HEAD",
      redirect: "manual",
    });
    const location = response.headers.get("location");

    if (response.status === 200 && location === null) {
      return { is_short: 1, error: null };
    }

    if (response.status >= 300 && response.status < 400 && location !== null) {
      const destination = new URL(location, shortsUrl);
      if (
        destination.origin === YOUTUBE_FEED_ORIGIN
        && destination.pathname === "/watch"
        && destination.searchParams.get("v") === videoId
      ) {
        return { is_short: 0, error: null };
      }
    }

    return {
      is_short: null,
      error: `Ambiguous Shorts response: ${response.status}${location ? ` -> ${location}` : ""}`,
    };
  } catch (error) {
    return {
      is_short: null,
      error: `Shorts classification request failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function classifyPendingSeedRssEntries(
  entries: PersistedSeedRssEntry[],
  options: {
    fetcher?: typeof fetch;
    pause?: (ms: number) => Promise<void>;
    now?: () => string;
    limit?: number;
  } = {},
): Promise<SeedShortsClassificationAttempt[]> {
  const fetcher = options.fetcher ?? fetch;
  const pause = options.pause ?? delay;
  const now = options.now ?? (() => new Date().toISOString());
  const requestedLimit = Math.max(0, options.limit ?? SEED_SHORTS_CLASSIFICATION_REQUEST_CAP);
  const pending = entries
    .filter((entry) => entry.is_short === null)
    .slice(0, Math.min(requestedLimit, SEED_SHORTS_CLASSIFICATION_REQUEST_CAP));
  const attempts: SeedShortsClassificationAttempt[] = [];

  for (let index = 0; index < pending.length; index += 1) {
    const entry = pending[index];
    const attemptedAt = now();
    const classification = await classifyYouTubeShort(entry.video_id, fetcher);
    attempts.push({
      channel_id: entry.channel_id,
      video_id: entry.video_id,
      attempted_at: attemptedAt,
      classified_at: classification.is_short === null ? null : attemptedAt,
      ...classification,
    });
    if (index < pending.length - 1) {
      await pause(SEED_SHORTS_CLASSIFICATION_DELAY_MS);
    }
  }

  return attempts;
}

export function seedRssSnapshotAggregates(
  entries: PersistedSeedRssEntry[],
  checkedAt: string,
): SeedRssSnapshotAggregates {
  const currentEntries = entries.filter((entry) => entry.last_seen_at === checkedAt);
  return {
    shorts_count: currentEntries.filter((entry) => entry.is_short === 1).length,
    pending_classification_count: currentEntries.filter((entry) => entry.is_short === null).length,
  };
}

export function deriveSeedFreshness(
  rssEntries: RecentVideo[],
  classifiedEntries: PersistedSeedRssEntry[],
  checkedAt: string,
  storedVideos: StoredSeedVideo[],
  storedVideoCount = storedVideos.length,
): DerivedSeedFreshness {
  const entries = rssEntries.slice(0, YOUTUBE_RSS_ENTRY_LIMIT);
  const currentEntries = classifiedEntries.filter((entry) => entry.last_seen_at === checkedAt);
  const { shorts_count, pending_classification_count } = seedRssSnapshotAggregates(
    currentEntries,
    checkedAt,
  );
  const newestStoredVideoAt = newestPublishedAt(storedVideos);
  const latestUploadAt = newestPublishedAt(entries);
  const neverMined = storedVideoCount === 0;

  if (neverMined) {
    return {
      latest_upload_at: latestUploadAt,
      newest_stored_video_at: null,
      stored_video_count: 0,
      unmined_count: null,
      unmined_is_lower_bound: false,
      never_mined: true,
      rss_entry_count: entries.length,
      shorts_count,
      pending_classification_count,
    };
  }

  const storedIds = new Set(storedVideos.map((video) => video.video_id));
  const longFormEntries = currentEntries.filter((entry) => entry.is_short === 0);
  const unminedCount = longFormEntries.filter(
    (entry) => !storedIds.has(entry.video_id),
  ).length;
  const hasStoredLongFormBoundary = longFormEntries.some(
    (entry) => storedIds.has(entry.video_id),
  );

  return {
    latest_upload_at: latestUploadAt,
    newest_stored_video_at: newestStoredVideoAt,
    stored_video_count: storedVideoCount,
    unmined_count: unminedCount,
    unmined_is_lower_bound:
      entries.length >= YOUTUBE_RSS_ENTRY_LIMIT
      && unminedCount > 0
      && !hasStoredLongFormBoundary,
    never_mined: false,
    rss_entry_count: entries.length,
    shorts_count,
    pending_classification_count,
  };
}

export function seedFreshnessIsFullyMined(
  neverMined: boolean,
  unminedCount: number | null,
  pendingClassificationCount: number,
): boolean {
  return !neverMined
    && unminedCount === 0
    && pendingClassificationCount === 0;
}

export function seedFreshnessCacheIsFresh(
  checkedAt: string,
  cachedStoredVideoCount: number,
  cachedNewestStoredVideoAt: string | null,
  currentStoredVideoCount: number,
  currentNewestStoredVideoAt: string | null,
  now = Date.now(),
): boolean {
  const checkedTime = Date.parse(checkedAt);
  return Number.isFinite(checkedTime)
    && now - checkedTime < SEED_FRESHNESS_CACHE_MS
    && cachedStoredVideoCount === currentStoredVideoCount
    && cachedNewestStoredVideoAt === currentNewestStoredVideoAt;
}

export function seedFreshnessCacheIsUsable(
  status: string,
  error: string | null,
  checkedAt: string,
  cachedStoredVideoCount: number,
  cachedNewestStoredVideoAt: string | null,
  currentStoredVideoCount: number,
  currentNewestStoredVideoAt: string | null,
  now = Date.now(),
): boolean {
  return status !== "error"
    && error === null
    && seedFreshnessCacheIsFresh(
      checkedAt,
      cachedStoredVideoCount,
      cachedNewestStoredVideoAt,
      currentStoredVideoCount,
      currentNewestStoredVideoAt,
      now,
    );
}

function newestPublishedAt(videos: Array<{ published_at: string | null }>): string | null {
  let newest: string | null = null;
  let newestTime = Number.NEGATIVE_INFINITY;
  for (const video of videos) {
    const time = publishedTime(video.published_at);
    if (time > newestTime) {
      newest = video.published_at;
      newestTime = time;
    }
  }
  return newest;
}

function publishedTime(value: string | null): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}
