import { QUALITY_GATE_CONFIG } from "./config.js";
import { ScrapeCreatorsChannel } from "./scrapecreators.js";
import { parseCountText, parseJoinedDate } from "./text.js";

export function searchQualityGateReason(channel: ScrapeCreatorsChannel, minSubs: number): string | null {
  const subscriberCount = parseCountText(channel.subscriberCount);
  if (subscriberCount !== null && subscriberCount < minSubs) {
    return "auto: below search sub floor";
  }

  const dormantReason = dormantChannelReason(channel);
  if (dormantReason) return dormantReason;

  return null;
}

export function dormantChannelReason(channel: ScrapeCreatorsChannel): string | null {
  const subscriberCount = parseCountText(channel.subscriberCount);
  const publishedAt = parseJoinedDate(channel.joinedDateText);
  if (subscriberCount === null || subscriberCount >= QUALITY_GATE_CONFIG.dormantSubscriberCeiling) {
    return null;
  }

  if (!publishedAt) return null;
  const published = new Date(publishedAt);
  if (Number.isNaN(published.getTime())) return null;

  const ageYears = (Date.now() - published.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  return ageYears > QUALITY_GATE_CONFIG.dormantPublishedYears ? "auto: dormant" : null;
}
