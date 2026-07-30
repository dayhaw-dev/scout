import { RecentVideo } from "./sponsor-scan.js";

export const SPONSOR_APPEARS_TRIGGER = "sponsor_appears" as const;
export const SPONSOR_BASELINE_VIDEO_LIMIT = 45;
export const SPONSOR_BASELINE_SCAN_DELAY_MS = 325;
export const SPONSOR_BASELINE_RETRY_DELAY_MS = 6 * 60 * 60 * 1000;
export const SPONSOR_WATCHER_DUE_LIMIT = 10;
export const SPONSOR_WATCHER_PER_CHANNEL_SCAN_CAP = 5;
export const SPONSOR_WATCHER_GLOBAL_SCAN_CAP = 20;
export const SPONSOR_WATCHER_ZERO_RETRY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const SPONSOR_WATCHER_RSS_PACING_MIN_MS = 1500;
export const SPONSOR_WATCHER_RSS_PACING_MAX_MS = 2000;
export const SPONSOR_WATCHER_SNAPSHOT_COOLDOWN_MIN_MS = 3000;
export const SPONSOR_WATCHER_SNAPSHOT_COOLDOWN_MAX_MS = 5000;

export type SponsorWatcherBaselineState = "pending" | "ready" | "error";

export interface SponsorWatcherCoverageVideo extends RecentVideo {
  sponsorblock_has_sponsor: number | null;
  sponsorblock_checked_at: string | null;
  sponsorblock_error: string | null;
}

export interface SponsorWatcherBaselineVideo extends SponsorWatcherCoverageVideo {
  is_baseline: 1;
}

export interface SponsorWatcherCheckVideo extends RecentVideo {
  watcher_id: number;
  is_baseline: number;
  sponsorblock_has_sponsor: number | null;
  last_seen_at: string;
}

export interface SponsorWatcherScanQueue {
  watcherId: number;
  videos: SponsorWatcherCheckVideo[];
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

export function sponsorWatcherVideoCanFire(
  video: SponsorWatcherCheckVideo,
  baselineCutoffAt: string,
  nowMs = Date.now(),
): boolean {
  if (video.is_baseline === 1 || video.sponsorblock_has_sponsor === 1) return false;
  const publishedAt = Date.parse(video.published_at ?? "");
  const cutoffAt = Date.parse(baselineCutoffAt);
  if (!Number.isFinite(publishedAt) || !Number.isFinite(cutoffAt)) return false;
  if (publishedAt <= cutoffAt) return false;
  if (publishedAt > nowMs) return false;
  return nowMs - publishedAt <= SPONSOR_WATCHER_ZERO_RETRY_MAX_AGE_MS;
}

export function sponsorWatcherScanShouldFire(
  video: SponsorWatcherCheckVideo,
  baselineCutoffAt: string,
  sponsorblockHasSponsor: number | null,
  nowMs = Date.now(),
): boolean {
  return sponsorblockHasSponsor === 1
    && sponsorWatcherVideoCanFire(
      { ...video, sponsorblock_has_sponsor: null },
      baselineCutoffAt,
      nowMs,
    );
}

export function roundRobinSponsorWatcherScans(
  queues: SponsorWatcherScanQueue[],
  perChannelCap = SPONSOR_WATCHER_PER_CHANNEL_SCAN_CAP,
  globalCap = SPONSOR_WATCHER_GLOBAL_SCAN_CAP,
): Array<{ watcherId: number; video: SponsorWatcherCheckVideo }> {
  const bounded = queues.map((queue) => ({
    watcherId: queue.watcherId,
    videos: queue.videos.slice(0, perChannelCap),
  }));
  const plan: Array<{ watcherId: number; video: SponsorWatcherCheckVideo }> = [];

  for (let index = 0; plan.length < globalCap; index += 1) {
    let added = false;
    for (const queue of bounded) {
      const video = queue.videos[index];
      if (!video) continue;
      plan.push({ watcherId: queue.watcherId, video });
      added = true;
      if (plan.length >= globalCap) break;
    }
    if (!added) break;
  }
  return plan;
}

export function sponsorWatcherRssPacingMs(random = Math.random()): number {
  return jitterBetween(
    SPONSOR_WATCHER_RSS_PACING_MIN_MS,
    SPONSOR_WATCHER_RSS_PACING_MAX_MS,
    random,
  );
}

export function sponsorWatcherSnapshotCooldownMs(random = Math.random()): number {
  return jitterBetween(
    SPONSOR_WATCHER_SNAPSHOT_COOLDOWN_MIN_MS,
    SPONSOR_WATCHER_SNAPSHOT_COOLDOWN_MAX_MS,
    random,
  );
}

export async function runWatcherPhaseBeforeSnapshots(input: {
  watcherPhase: () => Promise<void>;
  cooldown: () => Promise<void>;
  snapshotPhase: () => Promise<void>;
  onWatcherError?: (error: unknown) => void;
}): Promise<void> {
  try {
    await input.watcherPhase();
  } catch (error) {
    input.onWatcherError?.(error);
  }
  await input.cooldown();
  await input.snapshotPhase();
}

export async function runIsolatedWatcherTasks<T>(input: {
  items: T[];
  task: (item: T, index: number) => Promise<void>;
  onError: (item: T, error: unknown) => Promise<void> | void;
}): Promise<void> {
  for (let index = 0; index < input.items.length; index += 1) {
    const item = input.items[index];
    try {
      await input.task(item, index);
    } catch (error) {
      await input.onError(item, error);
    }
  }
}

function jitterBetween(minimum: number, maximum: number, random: number): number {
  const bounded = Math.min(1, Math.max(0, random));
  return Math.round(minimum + (maximum - minimum) * bounded);
}

function publishedTime(value: string | null): number {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}
