import assert from "node:assert/strict";
import test from "node:test";
import { SCORE_CONFIG, scoreChannel } from "../src/lib/score.js";

test("scores mid-size creators above mega celebrities and excludes brands", () => {
  const now = new Date("2026-07-07T00:00:00Z");
  const creator = scoreChannel(
    {
      kind: "creator",
      subscriber_count: 250_000,
      video_count: 350,
      view_count: 90_000_000,
      published_at: "2018-01-01T00:00:00.000Z",
      discovered_via: "collab",
      mention_count: 4,
      raw_json: JSON.stringify({ email: "hello@example.com" }),
    },
    now,
  );
  const mega = scoreChannel(
    {
      kind: "creator",
      subscriber_count: 58_000_000,
      video_count: 80,
      view_count: 20_000_000_000,
      published_at: "2016-01-01T00:00:00.000Z",
      discovered_via: "mention",
      mention_count: 1,
      raw_json: "{}",
    },
    now,
  );
  const brand = scoreChannel(
    {
      kind: "brand",
      subscriber_count: 250_000,
      video_count: 100,
      view_count: 10_000_000,
      published_at: "2018-01-01T00:00:00.000Z",
      discovered_via: "mention",
      mention_count: 3,
      raw_json: "{}",
    },
    now,
  );

  assert.ok((creator.score ?? 0) > (mega.score ?? 0));
  assert.equal(brand.score, null);
});

test("contactability uses named raw_json fields even when URLs are redirects", () => {
  const result = scoreChannel(
    {
      kind: "creator",
      subscriber_count: 699_000,
      video_count: 869,
      view_count: 36_945_778,
      published_at: "2015-09-30T00:00:00.000Z",
      discovered_via: "mention",
      mention_count: 1,
      raw_json: JSON.stringify({
        email: null,
        instagram: "https://tdk.link/yt_profile_ig",
        podcasts: "https://tdk.link/yt_profile_pod",
        website: "https://tdk.link/yt_profile_web",
        facebook: "https://tdk.link/yt_profile_fb",
        links: [
          "https://tdk.link/yt_profile_ig",
          "https://tdk.link/yt_profile_pod",
          "https://tdk.link/yt_profile_web",
          "https://tdk.link/yt_profile_fb",
        ],
      }),
    },
    new Date("2026-07-07T00:00:00Z"),
  );

  assert.ok(result.breakdown);
  assert.ok(result.breakdown.components.contactability.points > 0);
  assert.match(result.breakdown.components.contactability.reason, /named contact field/);
});

test("subscriber curve matches small-to-mid outreach range", () => {
  assert.deepEqual(SCORE_CONFIG.weights, {
    subRangeFit: 30,
    engagementReach: 30,
    mentionStrength: 15,
    contactability: 10,
    legacyEngagement: 15,
  });
  assert.deepEqual(SCORE_CONFIG.subscribers, {
    floor: 5_000,
    fullMin: 30_000,
    fullMax: 1_500_000,
    ceiling: 3_500_000,
  });
});

test("enriched activity contributes reach scoring and disables legacy engagement", () => {
  const result = scoreChannel(
    {
      kind: "creator",
      subscriber_count: 80_000,
      video_count: 80,
      view_count: 4_000_000,
      published_at: "2020-01-01T00:00:00.000Z",
      discovered_via: "search",
      mention_count: 2,
      raw_json: JSON.stringify({ instagram: "https://instagram.com/example" }),
      enriched_at: "2026-07-07T00:00:00.000Z",
      last_upload_at: "2026-07-01T00:00:00.000Z",
      uploads_last_90d: 8,
      median_recent_views: 60_000,
      recent_velocity: 0.75,
    },
    new Date("2026-07-07T00:00:00Z"),
  );

  assert.ok(result.breakdown);
  assert.ok(result.breakdown.components.engagementReach.points > 20);
  assert.match(result.breakdown.components.engagementReach.reason, /reach/);
  assert.equal(result.breakdown.components.legacyEngagement.points, 0);
});

test("reach scoring decays inactive and tiny channels", () => {
  const inactiveTiny = scoreChannel(
    {
      kind: "creator",
      subscriber_count: 255,
      video_count: 40,
      view_count: 100_000,
      published_at: "2020-01-01T00:00:00.000Z",
      discovered_via: "search",
      mention_count: 1,
      raw_json: "{}",
      enriched_at: "2026-07-07T00:00:00.000Z",
      last_upload_at: "2025-07-07T00:00:00.000Z",
      uploads_last_90d: 0,
      median_recent_views: 245,
      recent_velocity: 0.96,
    },
    new Date("2026-07-07T00:00:00Z"),
  );

  const activeSmall = scoreChannel(
    {
      kind: "creator",
      subscriber_count: 2_500,
      video_count: 40,
      view_count: 100_000,
      published_at: "2024-01-01T00:00:00.000Z",
      discovered_via: "search",
      mention_count: 1,
      raw_json: "{}",
      enriched_at: "2026-07-07T00:00:00.000Z",
      last_upload_at: "2026-07-01T00:00:00.000Z",
      uploads_last_90d: 5,
      median_recent_views: 10_000,
      recent_velocity: 4,
    },
    new Date("2026-07-07T00:00:00Z"),
  );

  assert.ok(inactiveTiny.breakdown);
  assert.equal(inactiveTiny.breakdown.components.engagementReach.points, 0);
  assert.match(inactiveTiny.breakdown.components.engagementReach.reason, /reach 0 effective/);
  assert.ok(activeSmall.breakdown);
  assert.match(activeSmall.breakdown.components.engagementReach.reason, /reach 2 effective/);
});
