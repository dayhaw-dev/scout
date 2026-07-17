import { parseYouTubeVideoFeed, RecentVideo } from "./sponsor-scan.js";

const YOUTUBE_FEED_ORIGIN = "https://www.youtube.com";
const YOUTUBE_RSS_MAX_BYTES = 512_000;
const YOUTUBE_RSS_TIMEOUT_MS = 6_000;
const YOUTUBE_RSS_RETRY_DELAY_MS = 350;
const YOUTUBE_RSS_MAX_ATTEMPTS = 3;

export const YOUTUBE_RSS_ENTRY_LIMIT = 15;
export const SEED_FRESHNESS_CACHE_MS = 6 * 60 * 60 * 1000;

export interface StoredSeedVideo {
  video_id: string;
  published_at: string | null;
}

export interface DerivedSeedFreshness {
  latest_upload_at: string | null;
  newest_stored_video_at: string | null;
  stored_video_count: number;
  unmined_count: number | null;
  unmined_is_lower_bound: boolean;
  never_mined: boolean;
  rss_entry_count: number;
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

export function deriveSeedFreshness(
  rssEntries: RecentVideo[],
  storedVideos: StoredSeedVideo[],
  storedVideoCount = storedVideos.length,
): DerivedSeedFreshness {
  const entries = rssEntries.slice(0, YOUTUBE_RSS_ENTRY_LIMIT);
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
    };
  }

  const storedIds = new Set(storedVideos.map((video) => video.video_id));
  const firstStoredEntry = entries.findIndex((entry) => storedIds.has(entry.video_id));
  let unminedCount: number;

  if (firstStoredEntry >= 0) {
    unminedCount = firstStoredEntry;
  } else {
    const newestStoredTime = publishedTime(newestStoredVideoAt);
    unminedCount = Number.isFinite(newestStoredTime)
      ? entries.filter((entry) => publishedTime(entry.published_at) > newestStoredTime).length
      : entries.length;
  }

  return {
    latest_upload_at: latestUploadAt,
    newest_stored_video_at: newestStoredVideoAt,
    stored_video_count: storedVideoCount,
    unmined_count: unminedCount,
    unmined_is_lower_bound:
      entries.length >= YOUTUBE_RSS_ENTRY_LIMIT && unminedCount === entries.length,
    never_mined: false,
    rss_entry_count: entries.length,
  };
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
