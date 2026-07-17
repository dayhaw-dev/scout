export const SEED_FRESHNESS_PACING_MIN_MS = 700;
export const SEED_FRESHNESS_PACING_MAX_MS = 1_100;

export function seedFreshnessPacingMs(randomValue = Math.random()): number {
  const bounded = Number.isFinite(randomValue)
    ? Math.min(1, Math.max(0, randomValue))
    : 0;
  const range = SEED_FRESHNESS_PACING_MAX_MS - SEED_FRESHNESS_PACING_MIN_MS;
  return Math.min(
    SEED_FRESHNESS_PACING_MAX_MS,
    SEED_FRESHNESS_PACING_MIN_MS + Math.floor(bounded * (range + 1)),
  );
}
