import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  mergeSponsorWatcherBaseline,
  newestSponsorWatcherBaseline,
  SPONSOR_APPEARS_TRIGGER,
  SPONSOR_BASELINE_SCAN_DELAY_MS,
  sponsorWatcherCanFire,
} from "../src/lib/outreach-watchers.js";

const worker = readFileSync("src/index.ts", "utf8");
const app = readFileSync("ui/src/App.tsx", "utf8");
const api = readFileSync("ui/src/api.ts", "utf8");
const migration = readFileSync("migrations/0029_outreach_watcher_baseline_state.sql", "utf8");

test("baseline merges RSS and scan IDs while preserving definitive prior coverage", () => {
  const videos = mergeSponsorWatcherBaseline(
    [
      { video_id: "rss-new", video_title: "RSS title", published_at: "2026-07-30T12:00:00Z" },
      { video_id: "shared", video_title: "RSS shared", published_at: "2026-07-29T12:00:00Z" },
    ],
    [
      {
        video_id: "shared",
        video_title: "Scan shared",
        published_at: "2026-07-29T12:00:00Z",
        sponsorblock_has_sponsor: 1,
        sponsorblock_checked_at: "2026-07-29T13:00:00Z",
        sponsorblock_error: null,
      },
      {
        video_id: "scan-only",
        video_title: "Older scanned video",
        published_at: "2026-07-28T12:00:00Z",
        sponsorblock_has_sponsor: 0,
        sponsorblock_checked_at: "2026-07-28T13:00:00Z",
        sponsorblock_error: null,
      },
    ],
  );

  assert.deepEqual(videos.map((video) => video.video_id), ["rss-new", "shared", "scan-only"]);
  assert.equal(videos.every((video) => video.is_baseline === 1), true);
  assert.equal(videos.find((video) => video.video_id === "shared")?.sponsorblock_has_sponsor, 1);
  assert.equal(videos.find((video) => video.video_id === "scan-only")?.sponsorblock_has_sponsor, 0);
  assert.equal(newestSponsorWatcherBaseline(videos)?.video_id, "rss-new");
});
test("only an active ready watcher can ever fire", () => {
  assert.equal(sponsorWatcherCanFire({ active: 1, baseline_state: "ready" }), true);
  assert.equal(sponsorWatcherCanFire({ active: 1, baseline_state: "pending" }), false);
  assert.equal(sponsorWatcherCanFire({ active: 1, baseline_state: "error" }), false);
  assert.equal(sponsorWatcherCanFire({ active: 0, baseline_state: "ready" }), false);
  assert.match(migration, /CREATE TRIGGER outreach_trigger_events_require_ready_watcher/);
  assert.match(migration, /active = 1[\s\S]*baseline_state = 'ready'/);
});

test("attachment stores an immutable attachment-time cutoff and shares close and retro paths", () => {
  assert.equal(SPONSOR_APPEARS_TRIGGER, "sponsor_appears");
  assert.equal(SPONSOR_BASELINE_SCAN_DELAY_MS, 325);
  assert.match(worker, /function sponsorWatcherInsertStatement/);
  assert.match(worker, /baseline_cutoff_at[\s\S]*input\.attachedAt/);
  assert.match(worker, /statements\.push\([\s\S]*sponsorWatcherInsertStatement/);
  assert.match(worker, /async function attachSponsorWatcher[\s\S]*sponsorWatcherInsertStatement/);
  assert.match(migration, /CREATE TRIGGER outreach_watchers_baseline_cutoff_immutable/);
  assert.match(migration, /RAISE\(ABORT, 'baseline_cutoff_at is immutable'\)/);
});

test("baseline captures RSS and prior video scans, then scans uncovered IDs sequentially", () => {
  assert.match(worker, /fetchYouTubeRssUploads\(watcher\.channel_id\)/);
  assert.match(worker, /latestDistinctSponsorWatcherCoverage/);
  assert.match(worker, /mergeSponsorWatcherBaseline\(rssVideos, scanCoverage\)/);
  assert.match(worker, /for \(let index = 0; index < missingCoverage\.length; index \+= 1\)/);
  assert.match(worker, /enrichVideosWithSponsorBlock\(\[video\]\)/);
  assert.match(worker, /await delay\(SPONSOR_BASELINE_SCAN_DELAY_MS\)/);
  assert.match(worker, /sponsorblock_has_sponsor = COALESCE\([\s\S]*outreach_watcher_videos\.sponsorblock_has_sponsor/);
});

test("baseline failure leaves the saved watcher retryable and stop watching preserves history", () => {
  const batchIndex = worker.indexOf("await env.SCOUT_DB.batch(statements)");
  const completionIndex = worker.indexOf("completeSponsorWatcherBaseline", batchIndex);
  assert.ok(batchIndex >= 0 && completionIndex > batchIndex);
  assert.match(worker, /catch \(error\) \{[\s\S]*markSponsorWatcherBaselineError/);
  assert.match(worker, /baseline_state = 'error'/);
  assert.match(worker, /next_check_at = \?/);
  assert.match(worker, /SET active = 0,[\s\S]*deactivated_at = \?/);
  assert.doesNotMatch(worker, /DELETE FROM outreach_watchers/);
});

test("UI exposes opt-in close attachment and retroactive closed-card controls", () => {
  assert.match(app, /Watch for sponsor appearance/);
  assert.match(app, /checked=\{watchSponsorAppearance\}/);
  assert.match(app, /watch_sponsor_appearance: outreachStatus === "passed" && watchSponsorAppearance/);
  assert.match(app, /videos already published by then are baseline and cannot trigger re-engagement/);
  assert.match(app, /onWatchSponsor=.*attachSponsorWatcher\(channel\)/);
  assert.match(app, /Stop watching sponsors/);
  assert.match(api, /\/outreach\/watchers/);
  assert.match(api, /\/deactivate/);
});
