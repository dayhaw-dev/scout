export const MIN_SEED_QUERY_VIDEOS = 5;

export function hasExplicitEmptySeedTargets(
  seedIds: readonly string[] | undefined,
): boolean {
  return seedIds !== undefined && seedIds.length === 0;
}
