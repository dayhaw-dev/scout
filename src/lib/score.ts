import { ChannelKind, parseRaw } from "./classify.js";
import { effectiveReach, REACH_CONFIG } from "./reach.js";

export interface ScorableChannel {
  subscriber_count: number | null;
  video_count: number | null;
  view_count: number | null;
  published_at: string | null;
  discovered_via: string | null;
  mention_count: number | null;
  raw_json: string | null;
  kind: ChannelKind;
  last_upload_at?: string | null;
  uploads_last_90d?: number | null;
  median_recent_views?: number | null;
  enriched_at?: string | null;
  recent_velocity?: number | null;
}

export interface ScoreResult {
  score: number | null;
  breakdown: ScoreBreakdown | null;
}

export interface ScoreBreakdown {
  total: number;
  components: Record<string, ScoreComponent>;
  notes: string[];
}

export interface ScoreComponent {
  points: number;
  weight: number;
  reason: string;
}

export const SCORE_CONFIG = {
  weights: {
    subRangeFit: 30,
    engagementReach: 30,
    mentionStrength: 15,
    contactability: 10,
    legacyEngagement: 15,
  },
  subscribers: {
    floor: 5_000,
    fullMin: 30_000,
    fullMax: 1_500_000,
    ceiling: 3_500_000,
  },
  engagement: {
    fullRatio: 0.15,
  },
  mention: {
    fullMentions: 10,
    collabBonus: 0.15,
  },
  reach: {
    fullReach: REACH_CONFIG.fullScoreReach,
    fullUploads90d: 12,
  },
} as const;

export function scoreChannel(channel: ScorableChannel, now = new Date()): ScoreResult {
  if (channel.kind === "brand" || channel.kind === "alt") {
    return { score: null, breakdown: null };
  }

  const components: ScoreBreakdown["components"] = {};
  const notes: string[] = [];

  components.subRangeFit = subRangeFit(channel.subscriber_count);
  components.engagementReach = engagementReach(channel, now, notes);
  components.mentionStrength = mentionStrength(channel);
  components.contactability = contactability(channel);
  components.legacyEngagement = legacyEngagement(channel, notes);

  const total = Math.round(
    Object.values(components).reduce((sum, component) => sum + component.points, 0) *
      10,
  ) / 10;

  return {
    score: total,
    breakdown: {
      total,
      components,
      notes,
    },
  };
}

function subRangeFit(subscribers: number | null): ScoreComponent {
  const weight = SCORE_CONFIG.weights.subRangeFit;
  if (subscribers === null) {
    return { points: 0, weight, reason: "missing subscriber count" };
  }

  const { floor, fullMin, fullMax, ceiling } = SCORE_CONFIG.subscribers;
  let scalar = 0;
  if (subscribers >= fullMin && subscribers <= fullMax) {
    scalar = 1;
  } else if (subscribers > floor && subscribers < fullMin) {
    scalar = (subscribers - floor) / (fullMin - floor);
  } else if (subscribers > fullMax && subscribers < ceiling) {
    scalar = 1 - (subscribers - fullMax) / (ceiling - fullMax);
  }

  return {
    points: roundPoints(weight * clamp01(scalar)),
    weight,
    reason: `${subscribers} subscribers vs 30k-1.5M target; zero by 5k/3.5M`,
  };
}

function legacyEngagement(channel: ScorableChannel, notes: string[]): ScoreComponent {
  const weight = SCORE_CONFIG.weights.legacyEngagement;
  if (channel.enriched_at) {
    return { points: 0, weight, reason: "not used after activity enrichment" };
  }

  const views = channel.view_count;
  const videos = channel.video_count;
  const subscribers = channel.subscriber_count;
  if (!views || !videos || !subscribers) {
    notes.push("engagement proxy is 0 because view_count, video_count, or subscriber_count is missing/zero");
    return { points: 0, weight, reason: "missing/zero engagement inputs" };
  }

  const ratio = (views / videos) / subscribers;
  const scalar = clamp01(ratio / SCORE_CONFIG.engagement.fullRatio);
  return {
    points: roundPoints(weight * scalar),
    weight,
    reason: `views/video/subscriber ratio ${roundPoints(ratio)}`,
  };
}

function mentionStrength(channel: ScorableChannel): ScoreComponent {
  const weight = SCORE_CONFIG.weights.mentionStrength;
  const mentions = Math.max(0, channel.mention_count ?? 0);
  const mentionScalar = Math.log1p(mentions) / Math.log1p(SCORE_CONFIG.mention.fullMentions);
  const collabBonus = channel.discovered_via === "collab" ? SCORE_CONFIG.mention.collabBonus : 0;
  const scalar = clamp01(mentionScalar + collabBonus);

  return {
    points: roundPoints(weight * scalar),
    weight,
    reason: `${mentions} mention(s)${collabBonus ? " with collab bonus" : ""}`,
  };
}

function engagementReach(channel: ScorableChannel, now: Date, notes: string[]): ScoreComponent {
  const weight = SCORE_CONFIG.weights.engagementReach;
  if (!channel.enriched_at) {
    notes.push("engagement reach requires activity enrichment");
    return { points: 0, weight, reason: "not enriched yet" };
  }

  const reach = effectiveReach(
    channel.recent_velocity,
    channel.subscriber_count,
    channel.last_upload_at,
    now,
  );
  const reachScalar = clamp01(reach.effectiveReach / SCORE_CONFIG.reach.fullReach);
  const uploads = Math.max(0, channel.uploads_last_90d ?? 0);
  const cadenceScalar = clamp01(uploads / SCORE_CONFIG.reach.fullUploads90d);
  const recencyScalar = reach.recencyFactor;
  const recencyReason = reach.daysSinceLastUpload === null
    ? "missing last upload date"
    : `${reach.daysSinceLastUpload}d since last upload`;
  const medianViews = channel.median_recent_views ?? null;
  const viewsReason = medianViews === null
    ? "median recent views missing"
    : `${medianViews} median views/video`;

  const scalar = (reachScalar * 0.5) + (recencyScalar * 0.3) + (cadenceScalar * 0.2);

  return {
    points: roundPoints(weight * scalar),
    weight,
    reason: `${viewsReason}; reach ${roundPoints(reach.effectiveReach)} effective (${roundPoints(reach.rawReach)} raw, recency ${roundPoints(reach.recencyFactor)}, sub damping ${roundPoints(reach.subscriberFactor)}), ${recencyReason}, ${uploads} uploads/90d`,
  };
}

function contactability(channel: ScorableChannel): ScoreComponent {
  const weight = SCORE_CONFIG.weights.contactability;
  const raw = parseRaw(channel.raw_json);
  const signals = contactSignals(raw);
  if (signals.includes("email")) {
    return { points: weight, weight, reason: "email present in raw_json" };
  }

  const contactCount = new Set(signals).size;

  return {
    points: roundPoints(weight * clamp01(contactCount / 4)),
    weight,
    reason: `${contactCount} named contact field(s), no email`,
  };
}

function contactSignals(raw: unknown): string[] {
  if (!raw || typeof raw !== "object") return [];
  const record = raw as Record<string, unknown>;
  const signals = new Set<string>();
  const namedContactFields = [
    "email",
    "instagram",
    "tiktok",
    "twitter",
    "x",
    "facebook",
    "website",
    "podcast",
    "podcasts",
    "patreon",
    "substack",
    "newsletter",
    "store",
  ];

  for (const key of Object.keys(record)) {
    const normalized = key.toLowerCase();
    const value = record[key];
    if (!value) continue;
    if (namedContactFields.includes(normalized)) {
      signals.add(normalized === "x" ? "twitter" : normalized);
    }
  }

  return [...signals];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function roundPoints(value: number): number {
  return Math.round(value * 10) / 10;
}
