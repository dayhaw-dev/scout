import { RecentVideo } from "./sponsor-scan.js";

export const SPONSOR_APPEARS_TRIGGER = "sponsor_appears" as const;
export const SPONSOR_BASELINE_VIDEO_LIMIT = 45;
export const SPONSOR_BASELINE_SCAN_DELAY_MS = 325;
export const SPONSOR_BASELINE_RETRY_DELAY_MS = 6 * 60 * 60 * 1000;

export type SponsorWatcherBaselineState = "pending" | "ready" | "error";

export interface SponsorWatcherCoverageVideo extends RecentVideo {
  sponsorblock_has_sponsor: number | null;
  sponsorblock_checked_at: string | null;
  sponsorblock_error: string | null;
}

export interface SponsorWatcherBaselineVideo extends SponsorWatcherCoverageVideo {
  is_baseline: 1;
}

export function mergeSponsorWatcherBaseline(
  rssVideos: RecentVideo[],
  scannedVideos: SponsorWatcherCoverageVideo[],
  limit = SPONSOR_BASELINE_VIDEO_LIMIT,
): SponsorWatcherBaselineVideo[] {
  const merged = new Map<string, SponsorWatcherBaselineVideo>();

  for (const video of rssVideos) {
    if (!video.video_id || merged.has(video.video_id)) continue;
    merged.set(video.video_id, {
      ...video,
      is_baseline: 1,
      sponsorblock_has_sponsor: null,
      sponsorblock_checked_at: null,
      sponsorblock_error: null,
    });
  }

  for (const video of scannedVideos) {
    if (!video.video_id) continue;
    const existing = merged.get(video.video_id);
    const hasDefinitiveCoverage =
      (video.sponsorblock_has_sponsor === 0 || video.sponsorblock_has_sponsor === 1)
      && !video.sponsorblock_error;
    merged.set(video.video_id, {
      video_id: video.video_id,
      video_title: existing?.video_title ?? video.video_title,
      published_at: existing?.published_at ?? video.published_at,
      is_baseline: 1,
      sponsorblock_has_sponsor: hasDefinitiveCoverage
        ? video.sponsorblock_has_sponsor
        : existing?.sponsorblock_has_sponsor ?? null,
      sponsorblock_checked_at: hasDefinitiveCoverage
        ? video.sponsorblock_checked_at
        : existing?.sponsorblock_checked_at ?? null,
      sponsorblock_error: hasDefinitiveCoverage
        ? null
        : video.sponsorblock_error ?? existing?.sponsorblock_error ?? null,
    });
  }

  return [...merged.values()]
    .sort((a, b) => publishedTime(b.published_at) - publishedTime(a.published_at))
    .slice(0, limit);
}

export function newestSponsorWatcherBaseline(
  videos: SponsorWatcherBaselineVideo[],
): SponsorWatcherBaselineVideo | null {
  return [...videos].sort((a, b) => publishedTime(b.published_at) - publishedTime(a.published_at))[0]
    ?? null;
}

export function sponsorWatcherCanFire(watcher: {
  active: number;
  baseline_state: SponsorWatcherBaselineState;
}): boolean {
  return watcher.active === 1 && watcher.baseline_state === "ready";
}

function publishedTime(value: string | null): number {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}
