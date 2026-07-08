export const QUALITY_GATE_CONFIG = {
  minSubsSearchResolve: 5_000,
  applySubFloorToMentionExpansion: false,
  dormantPublishedYears: 8,
  dormantSubscriberCeiling: 1_000,
} as const;

export const ENRICH_CONFIG = {
  staleAfterDays: 14,
  defaultLimit: 30,
  maxLimit: 100,
} as const;
