export const HOT_CONFIG = {
  minSubscribers: 1_000,
  maxLastUploadDays: 30,
  minReach: 0.3,
} as const;

export const REACH_CONFIG = {
  fullRecencyDays: 30,
  zeroRecencyDays: 180,
  dampingSubscriberFloor: 5_000,
  displayAndScoreCap: 3.0,
} as const;

export const MOVER_CONFIG = {
  subsGrowth7d: 5,
  subsGrowth30d: 15,
} as const;
