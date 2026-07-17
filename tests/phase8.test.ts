import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { activityMetrics } from "../src/lib/activity.js";
import { searchQualityGateReason } from "../src/lib/quality.js";
import { aggregateSeedSuggestions } from "../src/lib/suggestions.js";

test("search quality gate rejects resolved channels below the subscriber floor", () => {
  const reason = searchQualityGateReason(
    {
      channelId: "UCsmall",
      name: "Tiny AI Farm",
      subscriberCount: 149,
      videoCountText: "240 videos",
      viewCountText: "1,200 views",
      joinedDateText: "Joined Jan 1, 2026",
    },
    5_000,
  );

  assert.equal(reason, "auto: below search sub floor");
});

test("search quality gate auto-rejects dormant old tiny channels", () => {
  const reason = searchQualityGateReason(
    {
      channelId: "UCdormant",
      name: "Old Institution",
      subscriberCount: 800,
      videoCountText: "20 videos",
      viewCountText: "10,000 views",
      joinedDateText: "Joined Jan 1, 2010",
    },
    0,
  );

  assert.equal(reason, "auto: dormant");
});

test("activity enrichment computes recency, cadence, median views, and raw reach", () => {
  const metrics = activityMetrics(
    [
      { id: "a", publishedTime: "2026-07-01T00:00:00.000Z", viewCountInt: 20_000 },
      { id: "b", publishedTime: "2026-06-01T00:00:00.000Z", viewCountInt: 40_000 },
      { id: "c", publishedTime: "2025-01-01T00:00:00.000Z", viewCountInt: 100_000 },
    ],
    100_000,
    new Date("2026-07-07T00:00:00.000Z"),
  );

  assert.equal(metrics.lastUploadAt, "2026-07-01T00:00:00.000Z");
  assert.equal(metrics.uploadsLast90d, 2);
  assert.equal(metrics.medianRecentViews, 40_000);
  assert.equal(metrics.recentVelocity, 0.4);
});

test("suggestion aggregation ranks shared seed tags and drops generic/self terms", () => {
  const suggestions = aggregateSeedSuggestions([
    {
      channel_id: "seed-a",
      title: "Kitchen Science",
      handle: "kitchenscience",
      raw_json: JSON.stringify({ tags: ["Food science", "Fermentation", "video", "Kitchen Science"] }),
    },
    {
      channel_id: "seed-b",
      title: "Breakfast Lab",
      handle: "breakfastlab",
      raw_json: JSON.stringify({ keywords: ["food science", "breakfast recipes", "YouTube"] }),
    },
  ]);

  assert.equal(suggestions[0].term, "food science");
  assert.equal(suggestions[0].seed_count, 2);
  assert.ok(!suggestions.some((suggestion) => suggestion.term === "video"));
  assert.ok(!suggestions.some((suggestion) => suggestion.term === "kitchen science"));
});

test("suggestion aggregation omits blocklisted terms", () => {
  const suggestions = aggregateSeedSuggestions(
    [
      {
        channel_id: "seed-a",
        title: "Kitchen Science",
        handle: "kitchenscience",
        raw_json: JSON.stringify({ tags: ["Food science", "Fermentation"] }),
      },
      {
        channel_id: "seed-b",
        title: "Breakfast Lab",
        handle: "breakfastlab",
        raw_json: JSON.stringify({ keywords: ["food science", "breakfast recipes"] }),
      },
    ],
    30,
    new Set(["food science"]),
  );

  assert.ok(!suggestions.some((suggestion) => suggestion.term === "food science"));
  assert.equal(suggestions[0].term, "breakfast recipes");
});

test("phase 8 migration adds watchlist, enrichment fields, and removes unknown kind", () => {
  const migration = readFileSync("migrations/0009_phase8_watchlist_enrichment.sql", "utf8");
  assert.match(migration, /'watchlist'/);
  assert.match(migration, /last_upload_at TEXT/);
  assert.match(migration, /uploads_last_90d INTEGER/);
  assert.match(migration, /recent_velocity REAL/);
  assert.match(migration, /CASE WHEN kind = 'unknown' THEN 'creator'/);
  assert.match(migration, /CHECK \(kind IN \('creator', 'brand', 'alt'\)\)/);
});

test("phase 8 follow-up migration adds suggestion blocklist", () => {
  const migration = readFileSync("migrations/0010_phase8_followups.sql", "utf8");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS suggestion_blocklist/);
  assert.match(migration, /term TEXT PRIMARY KEY/);
});

test("HOT indicator is gated behind configured subscriber and reach floors", () => {
  const config = readFileSync("ui/src/config.ts", "utf8");
  const app = readFileSync("ui/src/App.tsx", "utf8");
  assert.match(config, /minSubscribers: 1_000/);
  assert.match(config, /minReach: 0\.3/);
  assert.match(app, />= HOT_CONFIG\.minSubscribers/);
  assert.match(app, />= HOT_CONFIG\.minReach/);
  assert.match(app, /function effectiveReach/);
});

test("expand-all seeds is client-orchestrated and server batch is disabled", () => {
  const source = readFileSync("src/index.ts", "utf8");
  const app = readFileSync("ui/src/App.tsx", "utf8");
  const api = readFileSync("ui/src/api.ts", "utf8");
  assert.match(source, /server_expand_all_disabled/);
  assert.match(app, /runClientExpandAllSeeds/);
  assert.match(app, /api\.expandSeed\(seed\.channel_id, 1, 10\)/);
  assert.match(app, /EXPAND_ALL_CLIENT_CREDIT_CAP = 150/);
  assert.match(app, /failures/);
  assert.doesNotMatch(api, /expandAllSeeds\(\)/);
  assert.match(app, /Expand All Seeds max/);
});

test("seed list includes lifetime yield and sorts by yield descending", () => {
  const source = readFileSync("src/index.ts", "utf8");
  const app = readFileSync("ui/src/App.tsx", "utf8");
  const api = readFileSync("ui/src/api.ts", "utf8");
  assert.match(source, /WHERE resolved\.source_channel_id = c\.channel_id/);
  assert.match(source, /AS yield_count/);
  assert.match(source, /ORDER BY yield_count DESC/);
  assert.match(app, /YIELD: \{seed\.yield_count \?\? 0\}/);
  assert.match(api, /yield_count\?: number/);
});

test("phase 9 UI exposes snapshot growth states and mover thresholds", () => {
  const app = readFileSync("ui/src/App.tsx", "utf8");
  const config = readFileSync("ui/src/config.ts", "utf8");
  const api = readFileSync("ui/src/api.ts", "utf8");
  assert.match(app, /Snapshot now max/);
  assert.match(app, /TRACKING/);
  assert.match(app, /MOVER/);
  assert.match(app, /function Sparkline/);
  assert.match(app, /growthWindowLabel/);
  assert.match(app, /point\.timestamp - firstTime/);
  assert.match(app, /sparkline-change/);
  assert.match(config, /subsGrowth7d: 5/);
  assert.match(config, /subsGrowth30d: 15/);
  assert.match(api, /last_snapshot_run/);
  assert.match(api, /snapshotNow/);
});

test("phase 9 snapshot endpoint has cron config, cap, and local credit accounting", () => {
  const source = readFileSync("src/index.ts", "utf8");
  const wrangler = readFileSync("wrangler.jsonc", "utf8");
  assert.match(wrangler, /"0 9 \* \* MON,THU"/);
  assert.match(source, /async scheduled/);
  assert.match(source, /scope: "watchlist"/);
  assert.match(source, /SNAPSHOT_CONFIG\.maxPerRun/);
  assert.match(source, /onApiLog: \(\) =>/);
  assert.match(source, /\/api\/admin\/snapshot/);
});

test("phase 9.5 credit sync uses meta and redesigned compact header", () => {
  const client = readFileSync("src/lib/scrapecreators.ts", "utf8");
  const source = readFileSync("src/index.ts", "utf8");
  const app = readFileSync("ui/src/App.tsx", "utf8");
  const api = readFileSync("ui/src/api.ts", "utf8");
  assert.match(client, /syncCreditsRemaining/);
  assert.match(client, /INSERT INTO meta \(key, value, updated_at\)/);
  assert.match(source, /SELECT value, updated_at FROM meta WHERE key = 'credits_remaining'/);
  assert.match(api, /credits_remaining_updated_at/);
  assert.match(app, /PIPELINE/);
  assert.match(app, /LAST RUN/);
  assert.match(app, /spent today/);
  assert.doesNotMatch(app, /<span>Total<\/span>/);
});

test("phase 9.5 manual snapshots support watchlist, seeds, and channel scopes", () => {
  const source = readFileSync("src/index.ts", "utf8");
  const app = readFileSync("ui/src/App.tsx", "utf8");
  const api = readFileSync("ui/src/api.ts", "utf8");
  assert.match(source, /function parseSnapshotScope/);
  assert.match(source, /scope must be watchlist, seeds, or channel/);
  assert.match(source, /c\.is_seed = 1/);
  assert.match(app, /Snapshot All Seeds max/);
  assert.match(app, /runClientSnapshotAllSeeds/);
  assert.match(app, /scope: "channel", channel_id: seed\.channel_id/);
  assert.match(app, /runBulkOperation/);
  assert.match(app, /visible\.slice\(0, 30\)/);
  assert.match(app, /scope: "channel", channel_id: channel\.channel_id, limit: 1/);
  assert.match(app, /onSnapshot/);
  assert.match(api, /scope\?: "watchlist" \| "seeds" \| "channel"/);
});

test("enriched cards show median views as primary and reach as secondary", () => {
  const app = readFileSync("ui/src/App.tsx", "utf8");
  const styles = readFileSync("ui/src/styles.css", "utf8");
  const score = readFileSync("src/lib/score.ts", "utf8");
  assert.match(app, /median_recent_views/);
  assert.match(app, /label="views \/ video"/);
  assert.match(app, /value=\{`~\$\{compact\(channel\.median_recent_views\)\}`\}/);
  assert.match(app, /label="reach"/);
  assert.match(app, /median views across recent uploads/);
  assert.match(app, /recent views \/ reach/);
  assert.match(app, /lifetime views \/ video/);
  assert.match(styles, /\.stat-block/);
  assert.match(score, /median views\/video/);
});
