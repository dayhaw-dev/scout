export interface SnapshotPoint {
  subscriber_count: number | null;
  view_count: number | null;
  video_count?: number | null;
  median_recent_views?: number | null;
  job_id?: number | null;
  taken_at: string;
}

export interface GrowthMetrics {
  subs_growth_7d: number | null;
  subs_growth_7d_days: number | null;
  subs_growth_30d: number | null;
  subs_growth_30d_days: number | null;
  views_growth_30d: number | null;
  views_growth_30d_days: number | null;
  median_views_growth_7d: number | null;
  median_views_growth_7d_days: number | null;
  median_views_growth_30d: number | null;
  median_views_growth_30d_days: number | null;
  median_tracking_days: number | null;
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
type SnapshotMetricField = "subscriber_count" | "view_count" | "median_recent_views";

interface MetricGrowth {
  growth7d: number | null;
  growth7dDays: number | null;
  growth30d: number | null;
  growth30dDays: number | null;
  trackingDays: number | null;
}

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
  const subscriberGrowth = metricGrowth(sorted, "subscriber_count", now);
  const viewGrowth = metricGrowth(sorted, "view_count", now);
  const medianViewGrowth = metricGrowth(sorted, "median_recent_views", now);

  return {
    subs_growth_7d: subscriberGrowth.growth7d,
    subs_growth_7d_days: subscriberGrowth.growth7dDays,
    subs_growth_30d: subscriberGrowth.growth30d,
    subs_growth_30d_days: subscriberGrowth.growth30dDays,
    views_growth_30d: viewGrowth.growth30d,
    views_growth_30d_days: viewGrowth.growth30dDays,
    median_views_growth_7d: medianViewGrowth.growth7d,
    median_views_growth_7d_days: medianViewGrowth.growth7dDays,
    median_views_growth_30d: medianViewGrowth.growth30d,
    median_views_growth_30d_days: medianViewGrowth.growth30dDays,
    median_tracking_days: medianViewGrowth.trackingDays,
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
    median_views_growth_7d: null,
    median_views_growth_7d_days: null,
    median_views_growth_30d: null,
    median_views_growth_30d_days: null,
    median_tracking_days: null,
    tracking_days: null,
    first_snapshot_at: null,
    latest_snapshot_at: null,
    snapshots,
  };
}

function metricGrowth(
  snapshots: SnapshotPoint[],
  field: SnapshotMetricField,
  now: Date,
): MetricGrowth {
  const sampled = snapshots.filter((snapshot) => {
    const value = snapshot[field];
    return typeof value === "number" && Number.isFinite(value);
  });
  if (sampled.length === 0) {
    return {
      growth7d: null,
      growth7dDays: null,
      growth30d: null,
      growth30dDays: null,
      trackingDays: null,
    };
  }

  const first = sampled[0];
  const latest = sampled[sampled.length - 1];
  const trackingDays = Math.max(
    0,
    Math.floor((new Date(latest.taken_at).getTime() - new Date(first.taken_at).getTime()) / DAY_MS),
  );
  if (sampled.length < 2 || trackingDays < 5) {
    return {
      growth7d: null,
      growth7dDays: null,
      growth30d: null,
      growth30dDays: null,
      trackingDays,
    };
  }

  const baseline7d = nearestSnapshot(sampled, new Date(now.getTime() - 7 * DAY_MS));
  const baseline30d = nearestSnapshot(sampled, new Date(now.getTime() - 30 * DAY_MS));
  return {
    growth7d: percentGrowth(baseline7d, latest, field),
    growth7dDays: growthSpanDays(baseline7d, latest, 7),
    growth30d: percentGrowth(baseline30d, latest, field),
    growth30dDays: growthSpanDays(baseline30d, latest, 30),
    trackingDays,
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
  field: SnapshotMetricField,
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
