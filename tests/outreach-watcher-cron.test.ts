import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  roundRobinSponsorWatcherScans,
  runIsolatedWatcherTasks,
  runWatcherPhaseBeforeSnapshots,
  SPONSOR_WATCHER_DUE_LIMIT,
  SPONSOR_WATCHER_GLOBAL_SCAN_CAP,
  SPONSOR_WATCHER_PER_CHANNEL_SCAN_CAP,
  sponsorWatcherRssPacingMs,
  sponsorWatcherScanShouldFire,
  sponsorWatcherSnapshotCooldownMs,
  sponsorWatcherVideoCanFire,
  type SponsorWatcherCheckVideo,
} from "../src/lib/outreach-watchers.js";

const worker = readFileSync("src/index.ts", "utf8");
const migration = readFileSync("migrations/0030_outreach_watcher_error_timestamp.sql", "utf8");
const now = Date.parse("2026-07-30T18:00:00.000Z");
const cutoff = "2026-07-01T00:00:00.000Z";

function video(overrides: Partial<SponsorWatcherCheckVideo> = {}): SponsorWatcherCheckVideo {
  return {
    watcher_id: 1,
    video_id: "video-1",
    video_title: "Post-attachment upload",
    published_at: "2026-07-20T00:00:00.000Z",
    is_baseline: 0,
    sponsorblock_has_sponsor: null,
    last_seen_at: "2026-07-30T18:00:00.000Z",
    ...overrides,
  };
}

test("only definite post-attachment positives can fire", () => {
  assert.equal(sponsorWatcherScanShouldFire(video({ is_baseline: 1 }), cutoff, 1, now), false);
  assert.equal(sponsorWatcherScanShouldFire(
    video({ published_at: "2026-06-30T23:59:59.000Z" }), cutoff, 1, now,
  ), false);
  assert.equal(sponsorWatcherScanShouldFire(video(), cutoff, 1, now), true);
  assert.equal(sponsorWatcherScanShouldFire(video({ published_at: null }), cutoff, 1, now), false);
  assert.equal(sponsorWatcherScanShouldFire(video(), cutoff, 0, now), false);
  assert.equal(sponsorWatcherScanShouldFire(video(), cutoff, null, now), false);
});

test("zero-segment results remain unknown and eligible for bounded retries", () => {
  const unknown = video({ sponsorblock_has_sponsor: 0 });
  assert.equal(sponsorWatcherVideoCanFire(unknown, cutoff, now), true);
  assert.equal(sponsorWatcherScanShouldFire(unknown, cutoff, 0, now), false);
  assert.equal(sponsorWatcherVideoCanFire(unknown, cutoff, now + 19 * 24 * 60 * 60 * 1000), true);
  assert.equal(sponsorWatcherVideoCanFire(unknown, cutoff, now + 21 * 24 * 60 * 60 * 1000), false);
  assert.equal(sponsorWatcherVideoCanFire(
    video({ published_at: "2026-07-31T00:00:00.000Z" }), cutoff, now,
  ), false);
});

test("round-robin scan planning enforces per-channel and global caps", () => {
  const queues = Array.from({ length: 5 }, (_, watcherIndex) => ({
    watcherId: watcherIndex + 1,
    videos: Array.from({ length: 7 }, (_, videoIndex) => video({
      watcher_id: watcherIndex + 1,
      video_id: `${watcherIndex + 1}-${videoIndex + 1}`,
    })),
  }));
  const plan = roundRobinSponsorWatcherScans(queues);
  assert.equal(SPONSOR_WATCHER_PER_CHANNEL_SCAN_CAP, 5);
  assert.equal(SPONSOR_WATCHER_GLOBAL_SCAN_CAP, 20);
  assert.equal(plan.length, 20);
  assert.deepEqual(plan.slice(0, 5).map((item) => item.watcherId), [1, 2, 3, 4, 5]);
  for (const watcherId of [1, 2, 3, 4, 5]) {
    assert.ok(plan.filter((item) => item.watcherId === watcherId).length <= 5);
  }
});

test("one watcher failure does not suppress later watchers or snapshots", async () => {
  const completed: number[] = [];
  const failed: number[] = [];
  await runIsolatedWatcherTasks({
    items: [1, 2, 3],
    task: async (item) => {
      if (item === 1) throw new Error("first watcher failed");
      completed.push(item);
    },
    onError: (item) => {
      failed.push(item);
    },
  });
  assert.deepEqual(failed, [1]);
  assert.deepEqual(completed, [2, 3]);

  const phases: string[] = [];
  await runWatcherPhaseBeforeSnapshots({
    watcherPhase: async () => {
      phases.push("watchers");
      throw new Error("whole watcher phase failed");
    },
    cooldown: async () => {
      phases.push("cooldown");
    },
    snapshotPhase: async () => {
      phases.push("snapshots");
    },
  });
  assert.deepEqual(phases, ["watchers", "cooldown", "snapshots"]);
});

test("scheduled placement, due eligibility, pacing, and free-only dependencies are explicit", () => {
  const wakeIndex = worker.indexOf("await wakeDueSnoozed(env)");
  const watcherIndex = worker.indexOf("runSponsorWatcherCronPass", wakeIndex);
  const snapshotIndex = worker.indexOf("runSnapshotJob", watcherIndex);
  assert.ok(wakeIndex >= 0 && watcherIndex > wakeIndex && snapshotIndex > watcherIndex);

  assert.equal(SPONSOR_WATCHER_DUE_LIMIT, 10);
  assert.equal(sponsorWatcherRssPacingMs(0), 1500);
  assert.equal(sponsorWatcherRssPacingMs(1), 2000);
  assert.equal(sponsorWatcherSnapshotCooldownMs(0), 3000);
  assert.equal(sponsorWatcherSnapshotCooldownMs(1), 5000);
  assert.match(worker, /baseline_state = 'ready'[\s\S]*next_check_at <= \?[\s\S]*NOT EXISTS[\s\S]*resolved_at IS NULL/);
  assert.match(worker, /ORDER BY ow\.next_check_at ASC, ow\.id ASC[\s\S]*LIMIT \?/);

  const phaseStart = worker.indexOf("async function runSponsorWatcherCronPass");
  const phaseEnd = worker.indexOf("async function latestDistinctSponsorWatcherCoverage", phaseStart);
  const phase = worker.slice(phaseStart, phaseEnd);
  assert.match(phase, /fetchYouTubeRssUploads/);
  assert.match(phase, /enrichVideosWithSponsorBlock/);
  assert.doesNotMatch(phase, /ScrapeCreatorsClient|api_log|INSERT INTO api_log/);
});

test("watcher failures receive an additive timestamp column", () => {
  assert.match(migration, /^ALTER TABLE outreach_watchers ADD COLUMN last_error_at TEXT;\s*$/);
  assert.doesNotMatch(migration, /DROP TABLE|CREATE TABLE|CASCADE|SET NULL/i);
  assert.match(worker, /last_error = \?,[\s\S]*last_error_at = \?,[\s\S]*next_check_at = \?/);
});
