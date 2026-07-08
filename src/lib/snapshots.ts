export interface SnapshotTargetState {
  channel_id: string;
  last_snapshot_at: string | null;
}

export interface SnapshotPlan {
  targets: SnapshotTargetState[];
  skippedRecent: number;
  truncated: number;
  note: string | null;
}

export const SNAPSHOT_CONFIG = {
  maxPerRun: 60,
  skipWithinHours: 48,
  cron: "0 9 * * 1,4",
} as const;

export function planSnapshotRun(
  candidates: SnapshotTargetState[],
  now = new Date(),
  maxPerRun = SNAPSHOT_CONFIG.maxPerRun,
): SnapshotPlan {
  const seen = new Set<string>();
  const deduped = candidates.filter((candidate) => {
    if (seen.has(candidate.channel_id)) return false;
    seen.add(candidate.channel_id);
    return true;
  });
  const eligible = deduped.filter((candidate) => !recentlySnapshotted(candidate.last_snapshot_at, now));
  const targets = eligible.slice(0, maxPerRun);
  const skippedRecent = deduped.length - eligible.length;
  const truncated = Math.max(0, eligible.length - targets.length);
  const notes: string[] = [];

  if (skippedRecent > 0) notes.push(`Skipped ${skippedRecent} channel(s) snapshotted within 48h.`);
  if (truncated > 0) notes.push(`Truncated ${truncated} eligible channel(s) beyond the ${maxPerRun}-snapshot cap.`);

  return {
    targets,
    skippedRecent,
    truncated,
    note: notes.length ? notes.join(" ") : null,
  };
}

function recentlySnapshotted(value: string | null, now: Date): boolean {
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return false;
  return now.getTime() - timestamp < SNAPSHOT_CONFIG.skipWithinHours * 60 * 60 * 1000;
}
