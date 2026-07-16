import { Env } from "./scrapecreators.js";

const YOUTUBE_FEED_ORIGIN = "https://www.youtube.com";
const SPONSORBLOCK_ORIGIN = "https://sponsor.ajay.app";
const SPONSORBLOCK_CONCURRENCY = 5;
const SPONSORBLOCK_TIMEOUT_MS = 2500;
const SPONSORBLOCK_USER_AGENT = "SCOUT Sponsor Scan (https://scout.dayhaw.dev)";

export type RecentVideoSource = "stored" | "rss";

export interface RecentVideo {
  video_id: string;
  video_title: string | null;
  published_at: string | null;
}

export interface RecentVideoResult {
  source: RecentVideoSource;
  videos: RecentVideo[];
}

export interface SponsorBlockVideoScan extends RecentVideo {
  sponsorblock_has_sponsor: number | null;
  sponsorblock_segments_json: string | null;
  error: string | null;
}

export interface SponsorBlockSegment {
  segment?: [number, number];
  [key: string]: unknown;
}

export function mergeSponsorVideoCoverage(
  recentCoverage: RecentVideo[],
  deepPage: RecentVideo[],
  limit = 45,
): RecentVideo[] {
  const merged = new Map<string, RecentVideo>();

  for (const video of [...recentCoverage, ...deepPage]) {
    if (!video.video_id || merged.has(video.video_id)) continue;
    merged.set(video.video_id, video);
  }

  return [...merged.values()]
    .sort((a, b) => publishedTime(b.published_at) - publishedTime(a.published_at))
    .slice(0, limit);
}

export function sponsorCoverageLabel(
  videos: RecentVideo[],
  now = Date.now(),
): string {
  const published = videos
    .map((video) => Date.parse(video.published_at ?? ""))
    .filter(Number.isFinite);
  if (published.length === 0) return `${videos.length} videos`;

  const oldest = Math.min(...published);
  const months = Math.max(1, Math.ceil((now - oldest) / (30.4375 * 24 * 60 * 60 * 1000)));
  return `${videos.length} videos / ${months} month${months === 1 ? "" : "s"}`;
}

export class RecentVideosError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecentVideosError";
  }
}

export async function getRecentVideoIds(
  env: Env,
  channelId: string,
  limit = 15,
  fetcher: typeof fetch = fetch,
): Promise<RecentVideoResult> {
  const stored = await storedRecentVideos(env, channelId, limit);
  if (stored.length >= 5) {
    return { source: "stored", videos: stored };
  }

  const rss = await fetchRssRecentVideos(channelId, limit, fetcher);
  return { source: "rss", videos: rss };
}

async function storedRecentVideos(
  env: Env,
  channelId: string,
  limit: number,
): Promise<RecentVideo[]> {
  const { results } = await env.SCOUT_DB.prepare(
    `SELECT video_id, title AS video_title, published_at
    FROM videos
    WHERE channel_id = ?
    ORDER BY
      CASE WHEN published_at IS NULL THEN 1 ELSE 0 END,
      datetime(published_at) DESC,
      created_at DESC
    LIMIT ?`,
  )
    .bind(channelId, limit)
    .all<RecentVideo>();

  return results;
}

async function fetchRssRecentVideos(
  channelId: string,
  limit: number,
  fetcher: typeof fetch,
): Promise<RecentVideo[]> {
  const url = new URL("/feeds/videos.xml", YOUTUBE_FEED_ORIGIN);
  url.searchParams.set("channel_id", channelId);

  const response = await fetcher(url.toString(), {
    headers: {
      accept: "application/atom+xml, application/xml;q=0.9, text/xml;q=0.8",
    },
  });
  if (!response.ok) {
    throw new RecentVideosError(
      `YouTube RSS feed request failed with ${response.status}.`,
    );
  }

  const xml = await response.text();
  const videos = parseYouTubeVideoFeed(xml).slice(0, limit);
  if (videos.length === 0) {
    throw new RecentVideosError("YouTube RSS feed returned no videos.");
  }

  return videos;
}

export async function enrichVideosWithSponsorBlock(
  videos: RecentVideo[],
  fetcher: typeof fetch = fetch,
): Promise<SponsorBlockVideoScan[]> {
  return mapWithConcurrency(videos, SPONSORBLOCK_CONCURRENCY, async (video) => {
    const result = await fetchSponsorBlock(video.video_id, fetcher);
    return {
      ...video,
      sponsorblock_has_sponsor: result.sponsorblock_has_sponsor,
      sponsorblock_segments_json: result.sponsorblock_segments_json,
      error: result.error,
    };
  });
}

export function sponsorBlockTotalDurationSeconds(segmentsJson: string | null): number {
  if (!segmentsJson) return 0;

  try {
    const parsed = JSON.parse(segmentsJson) as unknown;
    if (!Array.isArray(parsed)) return 0;
    return totalSegmentDurationSeconds(parsed);
  } catch {
    return 0;
  }
}

async function fetchSponsorBlock(
  videoId: string,
  fetcher: typeof fetch,
): Promise<{
  sponsorblock_has_sponsor: number | null;
  sponsorblock_segments_json: string | null;
  error: string | null;
}> {
  const url = new URL("/api/skipSegments", SPONSORBLOCK_ORIGIN);
  url.searchParams.set("videoID", videoId);
  url.searchParams.set("category", "sponsor");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SPONSORBLOCK_TIMEOUT_MS);

  try {
    const response = await fetcher(url.toString(), {
      headers: {
        accept: "application/json",
        "user-agent": SPONSORBLOCK_USER_AGENT,
      },
      signal: controller.signal,
    });

    if (response.status === 404) {
      return {
        sponsorblock_has_sponsor: 0,
        sponsorblock_segments_json: null,
        error: null,
      };
    }

    if (!response.ok) {
      return {
        sponsorblock_has_sponsor: null,
        sponsorblock_segments_json: null,
        error: `SponsorBlock request failed with ${response.status}.`,
      };
    }

    const payload = (await response.json()) as unknown;
    if (!Array.isArray(payload)) {
      return {
        sponsorblock_has_sponsor: null,
        sponsorblock_segments_json: null,
        error: "SponsorBlock response was not an array.",
      };
    }

    return {
      sponsorblock_has_sponsor: payload.length > 0 ? 1 : 0,
      sponsorblock_segments_json: payload.length > 0 ? JSON.stringify(payload) : null,
      error: null,
    };
  } catch (error) {
    return {
      sponsorblock_has_sponsor: null,
      sponsorblock_segments_json: null,
      error: error instanceof Error && error.name === "AbortError"
        ? "SponsorBlock request timed out."
        : `SponsorBlock request failed: ${errorMessage(error)}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function totalSegmentDurationSeconds(segments: unknown[]): number {
  const total = segments.reduce<number>((sum, segment) => {
    if (!segment || typeof segment !== "object") return sum;
    const range = (segment as SponsorBlockSegment).segment;
    if (!Array.isArray(range) || range.length < 2) return sum;
    const start = Number(range[0]);
    const end = Number(range[1]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return sum;
    return sum + end - start;
  }, 0);

  return Number(total.toFixed(3));
}

async function mapWithConcurrency<T, U>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<U>,
): Promise<U[]> {
  const results = new Array<U>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 500);
  return String(error).slice(0, 500);
}

function publishedTime(value: string | null): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

export function parseYouTubeVideoFeed(xml: string): RecentVideo[] {
  const entries = xml.match(/<entry\b[\s\S]*?<\/entry>/gi) ?? [];
  return entries
    .map((entry) => {
      const videoId = textContent(entry, "yt:videoId") ?? textContent(entry, "videoId");
      if (!videoId) return null;

      return {
        video_id: videoId,
        video_title: textContent(entry, "title"),
        published_at: textContent(entry, "published"),
      };
    })
    .filter((video): video is RecentVideo => Boolean(video));
}

function textContent(xml: string, tagName: string): string | null {
  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = xml.match(new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`, "i"));
  if (!match) return null;
  const value = decodeXmlEntities(match[1].trim());
  return value.length > 0 ? value : null;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, numeric: string) =>
      String.fromCodePoint(Number.parseInt(numeric, 10)),
    );
}
