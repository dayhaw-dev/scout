import type { SeedMiningFreshness } from "./api";

export const SEED_FRESHNESS_PACING_MIN_MS = 700;
export const SEED_FRESHNESS_PACING_MAX_MS = 1_100;
export const SEED_RSS_WINDOW_TOOLTIP =
  "UNMINED counts only fetchable, non-live long-form uploads within YouTube's latest 15 RSS entries. Shorts and archived live VODs are not mined and consume RSS window slots, so older fetchable uploads may sit outside visibility.";

export interface SeedOrePresentation {
  value: string;
  label: string;
  tone: "pending" | "never" | "error" | "high" | "low" | "mined";
  note: string | null;
  title: string | undefined;
}

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

export function seedFreshnessSecondaryNote(
  freshness: SeedMiningFreshness | null,
): string | null {
  if (!freshness) return null;
  const shorts = Math.max(0, freshness.shorts_count);
  const live = Math.max(0, freshness.live_count);
  const pendingShorts = Math.max(0, freshness.pending_classification_count);
  const pendingLive = Math.max(0, freshness.pending_live_classification_count);
  const noteParts: string[] = [];

  if (shorts > 0) noteParts.push(`+${shorts} SHORTS`);
  if (live > 0) noteParts.push(`+${live} LIVE`);
  if (noteParts.length > 0) noteParts.push("NOT MINED");
  if (pendingShorts > 0) noteParts.push(`${pendingShorts} PENDING CLASSIFICATION`);
  if (pendingLive > 0) noteParts.push(`${pendingLive} LIVE PENDING CLASSIFICATION`);

  return noteParts.length > 0 ? noteParts.join(" · ") : null;
}

export function seedOrePresentation(
  freshness: SeedMiningFreshness | null,
): SeedOrePresentation {
  const note = seedFreshnessSecondaryNote(freshness);
  if (!freshness) {
    return { value: "--", label: "CHECKING", tone: "pending", note, title: undefined };
  }
  if (freshness.never_mined) {
    return { value: "!", label: "NEVER MINED", tone: "never", note, title: SEED_RSS_WINDOW_TOOLTIP };
  }
  if (freshness.status === "error") {
    return { value: "!", label: "RSS ERROR", tone: "error", note, title: freshness.error ?? undefined };
  }
  if (freshness.status === "empty") {
    return { value: "0", label: "NO RSS", tone: "pending", note, title: SEED_RSS_WINDOW_TOOLTIP };
  }

  const count = freshness.unmined_count;
  if (count === null) {
    return { value: "--", label: "UNKNOWN", tone: "pending", note, title: SEED_RSS_WINDOW_TOOLTIP };
  }
  const fullyMined = freshness.fully_mined;
  const suffix = freshness.stale ? " · STALE" : "";
  const title = freshness.error
    ? `${SEED_RSS_WINDOW_TOOLTIP} Last refresh error: ${freshness.error}`
    : SEED_RSS_WINDOW_TOOLTIP;
  return {
    value: `${count}${count > 0 && freshness.unmined_is_lower_bound ? "+" : ""}`,
    label: `${fullyMined ? "MINED" : "UNMINED"}${suffix}`,
    tone: fullyMined ? "mined" : count >= 8 ? "high" : count > 0 ? "low" : "pending",
    note,
    title,
  };
}
