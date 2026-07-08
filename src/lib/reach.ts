export const REACH_CONFIG = {
  fullRecencyDays: 30,
  zeroRecencyDays: 180,
  dampingSubscriberFloor: 5_000,
  displayAndScoreCap: 3.0,
  fullScoreReach: 0.35,
} as const;

export interface ReachResult {
  rawReach: number;
  effectiveReach: number;
  recencyFactor: number;
  subscriberFactor: number;
  daysSinceLastUpload: number | null;
}

export function effectiveReach(
  rawReach: number | null | undefined,
  subscribers: number | null | undefined,
  lastUploadAt: string | null | undefined,
  now = new Date(),
): ReachResult {
  const normalizedRaw = Math.max(0, rawReach ?? 0);
  const recencyFactor = uploadRecencyFactor(lastUploadAt, now);
  const subscriberFactor = Math.min(1, Math.max(0, subscribers ?? 0) / REACH_CONFIG.dampingSubscriberFloor);
  const effective = Math.min(
    REACH_CONFIG.displayAndScoreCap,
    normalizedRaw * recencyFactor.factor * subscriberFactor,
  );

  return {
    rawReach: normalizedRaw,
    effectiveReach: roundReach(effective),
    recencyFactor: roundReach(recencyFactor.factor),
    subscriberFactor: roundReach(subscriberFactor),
    daysSinceLastUpload: recencyFactor.daysSinceLastUpload,
  };
}

export function uploadRecencyFactor(
  lastUploadAt: string | null | undefined,
  now = new Date(),
): { factor: number; daysSinceLastUpload: number | null } {
  if (!lastUploadAt) return { factor: 0, daysSinceLastUpload: null };
  const lastUpload = new Date(lastUploadAt);
  if (Number.isNaN(lastUpload.getTime())) return { factor: 0, daysSinceLastUpload: null };

  const days = Math.max(0, (now.getTime() - lastUpload.getTime()) / (24 * 60 * 60 * 1000));
  if (days <= REACH_CONFIG.fullRecencyDays) {
    return { factor: 1, daysSinceLastUpload: Math.round(days) };
  }
  if (days >= REACH_CONFIG.zeroRecencyDays) {
    return { factor: 0, daysSinceLastUpload: Math.round(days) };
  }

  const factor = 1 -
    ((days - REACH_CONFIG.fullRecencyDays) /
      (REACH_CONFIG.zeroRecencyDays - REACH_CONFIG.fullRecencyDays));
  return { factor, daysSinceLastUpload: Math.round(days) };
}

function roundReach(value: number): number {
  return Math.round(value * 1000) / 1000;
}
