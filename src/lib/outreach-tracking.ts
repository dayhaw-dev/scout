export const WATCHLIST_CRON = "0 9 * * MON,THU";
export const OUTREACH_TRACKING_CRON = "0 14 * * MON,THU";

export const OPEN_OUTREACH_WHERE = `is_active = 1
  OR (is_active = 0 AND outreach_stage IN ('sent', 'replied', 'in_talks', 'pitched'))`;

export type ScheduledJob = "watchlist" | "outreach_tracking";
export type OutreachTrackingTrigger = "scheduled" | "manual";
export type TrackingCallStatus = "success" | "failed";
export type TrackingOutcome = "success" | "partial" | "failed";

export interface OutreachTrackingJobIdentity {
  kind: "outreach_metrics:cron" | "outreach_metrics:manual";
  scheduledFor: string | null;
}

export interface OpenOutreachMembership {
  is_active: boolean | number;
  outreach_stage: string;
}

export interface TrackingCollection<TChannel, TVideos> {
  channel: TChannel | null;
  videos: TVideos | null;
  getChannelStatus: TrackingCallStatus;
  getVideosStatus: TrackingCallStatus;
  getChannelError: unknown | null;
  getVideosError: unknown | null;
  outcome: TrackingOutcome;
  shouldWriteSnapshot: boolean;
  shouldRecomputeScore: boolean;
  scoreNote: string;
}

export interface TrackingResultAccountingInput {
  outcome: TrackingOutcome;
  creditsSpent: number;
  snapshotWritten: boolean;
}

export interface TrackingRunAccounting {
  channelsSucceeded: number;
  channelsFailed: number;
  channelsPartial: number;
  channelsSnapshotted: number;
  creditsSpent: number;
}

export function scheduledJobForCron(cron: string): ScheduledJob | null {
  if (cron === WATCHLIST_CRON) return "watchlist";
  if (cron === OUTREACH_TRACKING_CRON) return "outreach_tracking";
  return null;
}

export function outreachTrackingJobIdentity(
  trigger: OutreachTrackingTrigger,
  runAt: Date,
): OutreachTrackingJobIdentity {
  return trigger === "scheduled"
    ? { kind: "outreach_metrics:cron", scheduledFor: runAt.toISOString() }
    : { kind: "outreach_metrics:manual", scheduledFor: null };
}

export function isOpenOutreachChannel(channel: OpenOutreachMembership): boolean {
  if (channel.is_active === true || channel.is_active === 1) return true;
  return channel.is_active === false || channel.is_active === 0
    ? ["sent", "replied", "in_talks", "pitched"].includes(channel.outreach_stage)
    : false;
}

export function summarizeOutreachTrackingResults(
  results: TrackingResultAccountingInput[],
): TrackingRunAccounting {
  return results.reduce<TrackingRunAccounting>((summary, result) => {
    summary.creditsSpent += result.creditsSpent;
    if (result.snapshotWritten) summary.channelsSnapshotted += 1;
    if (result.outcome === "success") {
      summary.channelsSucceeded += 1;
    } else if (result.outcome === "failed") {
      summary.channelsFailed += 1;
    } else {
      summary.channelsPartial += 1;
    }
    return summary;
  }, {
    channelsSucceeded: 0,
    channelsFailed: 0,
    channelsPartial: 0,
    channelsSnapshotted: 0,
    creditsSpent: 0,
  });
}

export async function collectOutreachTrackingMetrics<TChannel, TVideos>(input: {
  getChannel: () => Promise<TChannel>;
  getVideos: () => Promise<TVideos>;
}): Promise<TrackingCollection<TChannel, TVideos>> {
  const [channelResult, videosResult] = await Promise.allSettled([
    input.getChannel(),
    input.getVideos(),
  ]);
  const channelSucceeded = channelResult.status === "fulfilled";
  const videosSucceeded = videosResult.status === "fulfilled";
  const outcome: TrackingOutcome = channelSucceeded && videosSucceeded
    ? "success"
    : channelSucceeded || videosSucceeded
      ? "partial"
      : "failed";

  return {
    channel: channelSucceeded ? channelResult.value : null,
    videos: videosSucceeded ? videosResult.value : null,
    getChannelStatus: channelSucceeded ? "success" : "failed",
    getVideosStatus: videosSucceeded ? "success" : "failed",
    getChannelError: channelSucceeded ? null : channelResult.reason,
    getVideosError: videosSucceeded ? null : videosResult.reason,
    outcome,
    shouldWriteSnapshot: channelSucceeded || videosSucceeded,
    shouldRecomputeScore: channelSucceeded && videosSucceeded,
    scoreNote: channelSucceeded && videosSucceeded
      ? "score recomputed from same-run channel and video metrics"
      : videosSucceeded
        ? "score deliberately not recomputed: subscriber count was not refreshed in this run"
        : channelSucceeded
          ? "score deliberately not recomputed: activity metrics were not refreshed in this run"
          : "score not recomputed: neither provider call succeeded",
  };
}
