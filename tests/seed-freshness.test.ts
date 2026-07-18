import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  deriveSeedFreshness,
  fetchYouTubeRssUploads,
  seedFreshnessCacheIsFresh,
  seedFreshnessCacheIsUsable,
  YOUTUBE_RSS_ENTRY_LIMIT,
} from "../src/lib/seed-freshness.js";
import { RecentVideo } from "../src/lib/sponsor-scan.js";
import {
  SEED_FRESHNESS_PACING_MAX_MS,
  SEED_FRESHNESS_PACING_MIN_MS,
  seedFreshnessPacingMs,
} from "../ui/src/seed-freshness.js";

test("freshness counts feed entries before the newest stored video, including Shorts", () => {
  const rss: RecentVideo[] = [
    { video_id: "short-new", video_title: "A new Short", published_at: "2026-07-17T10:00:00Z" },
    { video_id: "video-new", video_title: "A new video", published_at: "2026-07-16T10:00:00Z" },
    { video_id: "stored", video_title: "Already stored", published_at: "2026-07-15T10:00:00Z" },
    { video_id: "older-gap", video_title: "Older missing upload", published_at: "2026-07-14T10:00:00Z" },
  ];

  const result = deriveSeedFreshness(
    rss,
    [{ video_id: "stored", published_at: "2026-07-15T12:00:00Z" }],
    30,
  );

  assert.equal(result.latest_upload_at, "2026-07-17T10:00:00Z");
  assert.equal(result.unmined_count, 2);
  assert.equal(result.unmined_is_lower_bound, false);
  assert.equal(result.never_mined, false);
});

test("freshness reports 15+ when the full RSS window is newer than stored coverage", () => {
  const rss = Array.from({ length: YOUTUBE_RSS_ENTRY_LIMIT }, (_, index) => ({
    video_id: `new-${index}`,
    video_title: `New ${index}`,
    published_at: new Date(Date.UTC(2026, 6, 17 - index)).toISOString(),
  }));

  const result = deriveSeedFreshness(
    rss,
    [{ video_id: "old", published_at: "2025-01-01T00:00:00Z" }],
    90,
  );

  assert.equal(result.unmined_count, 15);
  assert.equal(result.unmined_is_lower_bound, true);
});

test("zero stored videos is never mined rather than an invented unmined count", () => {
  const result = deriveSeedFreshness(
    [{ video_id: "latest", video_title: "Latest", published_at: "2026-07-17T10:00:00Z" }],
    [],
    0,
  );

  assert.equal(result.never_mined, true);
  assert.equal(result.unmined_count, null);
  assert.equal(result.latest_upload_at, "2026-07-17T10:00:00Z");
});

test("an empty successful YouTube feed is preserved as zero RSS entries", async () => {
  const uploads = await fetchYouTubeRssUploads(
    "channel",
    async () => new Response("<feed></feed>", { status: 200 }),
  );

  assert.deepEqual(uploads, []);
});

test("transient YouTube RSS 404 is retried once", async () => {
  let calls = 0;
  const uploads = await fetchYouTubeRssUploads("channel", async () => {
    calls += 1;
    if (calls === 1) return new Response("Not found", { status: 404 });
    return new Response(`
      <feed xmlns:yt="http://www.youtube.com/xml/schemas/2015">
        <entry>
          <yt:videoId>after-retry</yt:videoId>
          <title>After retry</title>
          <published>2026-07-17T12:00:00Z</published>
        </entry>
      </feed>
    `);
  });

  assert.equal(calls, 2);
  assert.equal(uploads[0]?.video_id, "after-retry");
});

test("persistent retryable RSS failures stop after three attempts", async () => {
  let calls = 0;
  await assert.rejects(
    () => fetchYouTubeRssUploads("channel", async () => {
      calls += 1;
      return new Response("Server error", { status: 500 });
    }),
    /failed with 500/,
  );
  assert.equal(calls, 3);
});

test("six-hour cache also invalidates immediately when stored coverage changes", () => {
  const now = Date.parse("2026-07-17T12:00:00Z");
  assert.equal(
    seedFreshnessCacheIsFresh(
      "2026-07-17T07:00:00Z",
      30,
      "2026-07-16T00:00:00Z",
      30,
      "2026-07-16T00:00:00Z",
      now,
    ),
    true,
  );
  assert.equal(
    seedFreshnessCacheIsFresh(
      "2026-07-17T07:00:00Z",
      30,
      "2026-07-16T00:00:00Z",
      31,
      "2026-07-17T00:00:00Z",
      now,
    ),
    false,
  );
  assert.equal(
    seedFreshnessCacheIsFresh(
      "2026-07-17T05:59:59Z",
      30,
      "2026-07-16T00:00:00Z",
      30,
      "2026-07-16T00:00:00Z",
      now,
    ),
    false,
  );
});

test("errored freshness rows and failed refresh markers are never usable cache hits", () => {
  const now = Date.parse("2026-07-17T12:00:00Z");
  const args = [
    "2026-07-17T11:59:00Z",
    30,
    "2026-07-16T00:00:00Z",
    30,
    "2026-07-16T00:00:00Z",
    now,
  ] as const;

  assert.equal(seedFreshnessCacheIsUsable("ok", null, ...args), true);
  assert.equal(seedFreshnessCacheIsUsable("error", "RSS 500", ...args), false);
  assert.equal(seedFreshnessCacheIsUsable("ok", "RSS 500", ...args), false);
});

test("seed freshness client pacing adds bounded jitter between sequential requests", () => {
  assert.equal(seedFreshnessPacingMs(0), SEED_FRESHNESS_PACING_MIN_MS);
  assert.equal(seedFreshnessPacingMs(1), SEED_FRESHNESS_PACING_MAX_MS);
  assert.ok(seedFreshnessPacingMs(0.5) > SEED_FRESHNESS_PACING_MIN_MS);
  assert.ok(seedFreshnessPacingMs(0.5) < SEED_FRESHNESS_PACING_MAX_MS);
});

test("freshness migration adds a dependent cache table without rebuilding channels", () => {
  const migration = readFileSync("migrations/0022_seed_mining_freshness.sql", "utf8");

  assert.match(migration, /CREATE TABLE IF NOT EXISTS seed_mining_freshness/);
  assert.match(migration, /REFERENCES channels\(channel_id\) ON DELETE CASCADE/);
  assert.doesNotMatch(migration, /ALTER TABLE channels|DROP TABLE channels|RENAME TO channels/);
});

test("freshness route is RSS-only and remains available to locked seeds", () => {
  const worker = readFileSync("src/index.ts", "utf8");
  const app = readFileSync("ui/src/App.tsx", "utf8");
  const api = readFileSync("ui/src/api.ts", "utf8");
  const handler = worker.match(
    /async function refreshSeedFreshness[\s\S]*?async function seedStoredVideoStats/,
  )?.[0] ?? "";

  assert.match(worker, /seedFreshnessMatch = url\.pathname\.match/);
  assert.match(handler, /fetchYouTubeRssUploads/);
  assert.doesNotMatch(handler, /ScrapeCreatorsClient|requireUnlockedSeed/);
  assert.match(api, /refreshSeedFreshness\(channelId: string, force = false\)/);
  assert.match(app, /Check freshness/);
  assert.match(app, /15\+|unmined_is_lower_bound/);
  assert.match(app, /upload ore, not a channel count/);
  assert.match(app, /Unmined desc/);
  assert.match(app, /NEVER MINED/);
  assert.match(app, /seedFreshnessPacingMs/);
  assert.match(app, /freshnessQueueRef/);
  assert.match(app, /freshness\.error/);
  assert.match(app, /· STALE/);
});
