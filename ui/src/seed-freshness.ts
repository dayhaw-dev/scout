import type { SeedMiningFreshness } from "./api";

export const SEED_FRESHNESS_PACING_MIN_MS = 700;
export const SEED_FRESHNESS_PACING_MAX_MS = 1_100;
export const SEED_RSS_WINDOW_TOOLTIP =
  "UNMINED counts only long-form uploads within YouTube's latest 15 RSS entries. Shorts consume RSS window slots, so older long-form uploads may sit outside visibility.";

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
  const pending = Math.max(0, freshness.pending_classification_count);
  if (shorts > 0 && pending > 0) return `+${shorts} SHORTS · ${pending} PENDING`;
  if (shorts > 0) return `+${shorts} SHORTS · NOT MINED`;
  if (pending > 0) return `${pending} PENDING CLASSIFICATION`;
  return null;
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
