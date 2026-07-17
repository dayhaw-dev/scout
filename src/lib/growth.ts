export interface SnapshotPoint {
  subscriber_count: number | null;
  view_count: number | null;
  video_count?: number | null;
  taken_at: string;
}

export interface GrowthMetrics {
  subs_growth_7d: number | null;
  subs_growth_7d_days: number | null;
  subs_growth_30d: number | null;
  subs_growth_30d_days: number | null;
  views_growth_30d: number | null;
  views_growth_30d_days: number | null;
  tracking_days: number | null;
  first_snapshot_at: string | null;
  latest_snapshot_at: string | null;
  snapshots: SnapshotPoint[];
}

export const MOVER_CONFIG = {
  subsGrowth7d: 5,
  subsGrowth30d: 15,
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

export function computeGrowthMetrics(
  snapshots: SnapshotPoint[],
  now = new Date(),
): GrowthMetrics {
  const sorted = snapshots
    .filter((snapshot) => Number.isFinite(new Date(snapshot.taken_at).getTime()))
    .sort((a, b) => new Date(a.taken_at).getTime() - new Date(b.taken_at).getTime());

  if (sorted.length === 0) {
    return emptyGrowth([]);
  }

  const first = sorted[0];
  const latest = sorted[sorted.length - 1];
  const firstTime = new Date(first.taken_at).getTime();
  const latestTime = new Date(latest.taken_at).getTime();
  const trackingDays = Math.max(0, Math.floor((latestTime - firstTime) / DAY_MS));

  if (sorted.length < 2 || trackingDays < 5) {
    return {
      ...emptyGrowth(sorted),
      tracking_days: trackingDays,
      first_snapshot_at: first.taken_at,
      latest_snapshot_at: latest.taken_at,
    };
  }

  const baseline7d = nearestSnapshot(sorted, new Date(now.getTime() - 7 * DAY_MS));
  const baseline30d = nearestSnapshot(sorted, new Date(now.getTime() - 30 * DAY_MS));

  return {
    subs_growth_7d: percentGrowth(baseline7d, latest, "subscriber_count"),
    subs_growth_7d_days: growthSpanDays(baseline7d, latest, 7),
    subs_growth_30d: percentGrowth(baseline30d, latest, "subscriber_count"),
    subs_growth_30d_days: growthSpanDays(baseline30d, latest, 30),
    views_growth_30d: percentGrowth(baseline30d, latest, "view_count"),
    views_growth_30d_days: growthSpanDays(baseline30d, latest, 30),
    tracking_days: trackingDays,
    first_snapshot_at: first.taken_at,
    latest_snapshot_at: latest.taken_at,
    snapshots: sorted,
  };
}

export function isMover(metrics: Pick<GrowthMetrics, "subs_growth_7d" | "subs_growth_30d">): boolean {
  return (
    (metrics.subs_growth_7d ?? Number.NEGATIVE_INFINITY) >= MOVER_CONFIG.subsGrowth7d ||
    (metrics.subs_growth_30d ?? Number.NEGATIVE_INFINITY) >= MOVER_CONFIG.subsGrowth30d
  );
}

function emptyGrowth(snapshots: SnapshotPoint[]): GrowthMetrics {
  return {
    subs_growth_7d: null,
    subs_growth_7d_days: null,
    subs_growth_30d: null,
    subs_growth_30d_days: null,
    views_growth_30d: null,
    views_growth_30d_days: null,
    tracking_days: null,
    first_snapshot_at: null,
    latest_snapshot_at: null,
    snapshots,
  };
}

function nearestSnapshot(snapshots: SnapshotPoint[], target: Date): SnapshotPoint {
  const targetTime = target.getTime();
  return snapshots.reduce((best, snapshot) => {
    const bestDistance = Math.abs(new Date(best.taken_at).getTime() - targetTime);
    const distance = Math.abs(new Date(snapshot.taken_at).getTime() - targetTime);
    return distance < bestDistance ? snapshot : best;
  });
}

function percentGrowth(
  baseline: SnapshotPoint,
  latest: SnapshotPoint,
  field: "subscriber_count" | "view_count",
): number | null {
  const start = baseline[field];
  const end = latest[field];
  if (start === null || start === undefined || end === null || end === undefined || start <= 0) {
    return null;
  }

  return ((end - start) / start) * 100;
}

function growthSpanDays(
  baseline: SnapshotPoint,
  latest: SnapshotPoint,
  windowDays: number,
): number {
  const baselineTime = new Date(baseline.taken_at).getTime();
  const latestTime = new Date(latest.taken_at).getTime();
  const actualDays = Math.max(0, Math.floor((latestTime - baselineTime) / DAY_MS));
  return Math.min(windowDays, actualDays);
}
