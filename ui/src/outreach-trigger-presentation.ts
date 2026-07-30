import type { SponsorAppearanceWatcher } from "./api";

export const SPONSOR_CONFIRMED_COPY =
  "SPONSOR CONFIRMED — SponsorBlock has a community-submitted sponsor segment for this upload. Advertiser identity is unknown.";

export const SPONSOR_TRIGGER_CARD_NOTE =
  "Detected on a video published after this watch began. Brand identity is not available from SponsorBlock.";

export const SPONSOR_APPEARED_LABEL = "SPONSOR APPEARED";
export const WATCHING_FOR_SPONSOR_LABEL = "WATCHING FOR SPONSOR";

export function sponsorWatcherStateLabel(
  state: SponsorAppearanceWatcher["baseline_state"],
): string {
  switch (state) {
    case "ready":
      return WATCHING_FOR_SPONSOR_LABEL;
    case "pending":
      return "WATCHER PENDING · NOT ARMED";
    case "error":
      return "WATCHER ERROR · NOT ARMED";
  }
}
