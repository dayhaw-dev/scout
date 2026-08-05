import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  collectOutreachTrackingMetrics,
  isOpenOutreachChannel,
  OPEN_OUTREACH_WHERE,
  OUTREACH_TRACKING_CRON,
  outreachTrackingJobIdentity,
  scheduledJobForCron,
  summarizeOutreachTrackingResults,
  WATCHLIST_CRON,
} from "../src/lib/outreach-tracking.js";

const worker = readFileSync("src/index.ts", "utf8");
const migration = readFileSync("migrations/0032_outreach_metric_tracking.sql", "utf8");
const wrangler = readFileSync("wrangler.prod.jsonc", "utf8");
const app = readFileSync("ui/src/App.tsx", "utf8");
const styles = readFileSync("ui/src/styles.css", "utf8");

test("open Outreach membership is live, includes reopened stages, and has no kind filter", () => {
  assert.equal(isOpenOutreachChannel({ is_active: 1, outreach_stage: "signed" }), true);
  for (const outreach_stage of ["sent", "replied", "in_talks", "pitched"]) {
    assert.equal(isOpenOutreachChannel({ is_active: 0, outreach_stage }), true);
  }
  assert.equal(isOpenOutreachChannel({ is_active: 0, outreach_stage: "passed" }), false);
  assert.equal(isOpenOutreachChannel({ is_active: 0, outreach_stage: "signed" }), false);

  const reopened = { is_active: 0, outreach_stage: "passed" };
  assert.equal(isOpenOutreachChannel(reopened), false);
  reopened.outreach_stage = "in_talks";
  assert.equal(isOpenOutreachChannel(reopened), true);

  assert.equal(
    OPEN_OUTREACH_WHERE,
    "is_active = 1\n  OR (is_active = 0 AND outreach_stage IN ('sent', 'replied', 'in_talks', 'pitched'))",
  );
  assert.doesNotMatch(OPEN_OUTREACH_WHERE, /kind|creator/i);
  assert.match(worker, /WHERE \$\{OPEN_OUTREACH_WHERE\}/);
});

test("the Outreach tracker bypasses enrichment freshness and watchlist cooldown guards", () => {
  const runStart = worker.indexOf("async function runOpenOutreachTrackingJob");
  const firstTargetCall = worker.indexOf("trackOpenOutreachChannel", runStart);
  const selector = worker.slice(runStart, firstTargetCall);
  assert.match(selector, /WHERE \$\{OPEN_OUTREACH_WHERE\}/);
  assert.doesNotMatch(selector, /ENRICH_CONFIG|staleAfterDays|enriched_at|last_snapshot_at|skipWithinHours|kind\s*=|LIMIT/);
});

test("tracking migration is additive and adds metric and job provenance", () => {
  assert.match(migration, /ALTER TABLE snapshots ADD COLUMN median_recent_views INTEGER;/);
  assert.match(migration, /ALTER TABLE snapshots ADD COLUMN job_id INTEGER REFERENCES jobs\(id\) ON DELETE SET NULL;/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS job_channel_results/);
  assert.match(migration, /UNIQUE\(job_id, channel_id\)/);
  assert.match(migration, /score_recomputed INTEGER NOT NULL DEFAULT 0/);
  assert.doesNotMatch(migration, /DROP TABLE|RENAME TO|DELETE FROM|UPDATE channels/i);
  assert.doesNotMatch(migration, /CREATE TABLE IF NOT EXISTS (?:snapshots|jobs)\b/i);
});

test("cron dispatch branches on controller.cron and leaves the 09:00 job intact", () => {
  assert.equal(WATCHLIST_CRON, "0 9 * * MON,THU");
  assert.equal(OUTREACH_TRACKING_CRON, "0 14 * * MON,THU");
  assert.equal(scheduledJobForCron(WATCHLIST_CRON), "watchlist");
  assert.equal(scheduledJobForCron(OUTREACH_TRACKING_CRON), "outreach_tracking");
  assert.equal(scheduledJobForCron("0 12 * * FRI"), null);
  assert.match(wrangler, /"0 9 \* \* MON,THU"[\s\S]*"0 14 \* \* MON,THU"/);
  assert.match(worker, /switch \(scheduledJobForCron\(controller\.cron\)\)/);
  assert.match(worker, /case "watchlist":\s*await runExistingScheduledJob\(env\)/);
  assert.match(worker, /case "outreach_tracking":\s*await runOpenOutreachTrackingJob/);

  const existingStart = worker.indexOf("async function runExistingScheduledJob");
  const existingEnd = worker.indexOf("async function createSeed", existingStart);
  const existing = worker.slice(existingStart, existingEnd);
  assert.match(existing, /await wakeDueSnoozed\(env\)/);
  assert.match(existing, /runSponsorWatcherCronPass/);
  assert.match(existing, /runSnapshotJob/);
});

test("manual and cron tracking routes invoke the identical job function with explicit provenance", () => {
  const scheduled = outreachTrackingJobIdentity(
    "scheduled",
    new Date("2026-08-06T14:00:00.000Z"),
  );
  const manual = outreachTrackingJobIdentity(
    "manual",
    new Date("2026-08-06T14:00:00.000Z"),
  );
  assert.deepEqual(scheduled, {
    kind: "outreach_metrics:cron",
    scheduledFor: "2026-08-06T14:00:00.000Z",
  });
  assert.deepEqual(manual, {
    kind: "outreach_metrics:manual",
    scheduledFor: null,
  });

  const cronFunction = worker.match(
    /case "outreach_tracking":[\s\S]*?await (runOpenOutreachTrackingJob)\([\s\S]*?"scheduled"/,
  )?.[1];
  const endpointBlock = worker.match(
    /url\.pathname === "\/api\/admin\/outreach-tracking\/run"[\s\S]*?\n      }/,
  )?.[0] ?? "";
  const manualFunction = endpointBlock.match(
    /(runOpenOutreachTrackingJob)\(env, "manual", new Date\(\)\)/,
  )?.[1];

  assert.equal(cronFunction, "runOpenOutreachTrackingJob");
  assert.equal(manualFunction, cronFunction);
  assert.match(endpointBlock, /request\.method === "POST"/);
  assert.match(endpointBlock, /const auth = await requireAdmin\(request, env\)/);
  assert.match(endpointBlock, /if \(auth\) return auth/);
});

test("both provider calls are attempted and all four outcomes enforce same-run rescoring", async () => {
  async function collect(channelSucceeds: boolean, videosSucceed: boolean) {
    const calls: string[] = [];
    const result = await collectOutreachTrackingMetrics({
      getChannel: async () => {
        calls.push("channel");
        if (!channelSucceeds) throw new Error("channel failed");
        return { subscriberCount: 100 };
      },
      getVideos: async () => {
        calls.push("videos");
        if (!videosSucceed) throw new Error("videos failed");
        return { medianRecentViews: 20 };
      },
    });
    assert.deepEqual(calls.sort(), ["channel", "videos"]);
    return result;
  }

  const both = await collect(true, true);
  assert.equal(both.outcome, "success");
  assert.equal(both.shouldWriteSnapshot, true);
  assert.equal(both.shouldRecomputeScore, true);

  const channelOnly = await collect(true, false);
  assert.equal(channelOnly.outcome, "partial");
  assert.equal(channelOnly.shouldWriteSnapshot, true);
  assert.equal(channelOnly.shouldRecomputeScore, false);
  assert.match(channelOnly.scoreNote, /activity metrics were not refreshed/);

  const videosOnly = await collect(false, true);
  assert.equal(videosOnly.outcome, "partial");
  assert.equal(videosOnly.shouldWriteSnapshot, true);
  assert.equal(videosOnly.shouldRecomputeScore, false);
  assert.match(videosOnly.scoreNote, /deliberately not recomputed: subscriber count was not refreshed/);

  const neither = await collect(false, false);
  assert.equal(neither.outcome, "failed");
  assert.equal(neither.shouldWriteSnapshot, false);
  assert.equal(neither.shouldRecomputeScore, false);
});

test("partial writes advance activity freshness without overwriting score", () => {
  const persistStart = worker.indexOf("async function persistOutreachTrackingMetrics");
  const persistEnd = worker.indexOf("async function finishOutreachTrackingJob", persistStart);
  const persist = worker.slice(persistStart, persistEnd);
  const videosOnlyStart = persist.indexOf("} else if (activity)");
  const videosOnly = persist.slice(videosOnlyStart);

  assert.match(videosOnly, /median_recent_views = \?/);
  assert.match(videosOnly, /recent_velocity = \?/);
  assert.match(videosOnly, /enriched_at = CURRENT_TIMESTAMP/);
  assert.doesNotMatch(videosOnly, /score\s*=|score_breakdown\s*=/);
});

test("per-channel and run accounting preserve exact outcomes, snapshots, and credits", () => {
  const summary = summarizeOutreachTrackingResults([
    { outcome: "success", creditsSpent: 2, snapshotWritten: true },
    { outcome: "partial", creditsSpent: 3, snapshotWritten: true },
    { outcome: "failed", creditsSpent: 4, snapshotWritten: false },
  ]);
  assert.deepEqual(summary, {
    channelsSucceeded: 1,
    channelsFailed: 1,
    channelsPartial: 1,
    channelsSnapshotted: 2,
    creditsSpent: 9,
  });
  assert.match(worker, /creditsSpent = credits\.getChannel \+ credits\.getVideos/);
  assert.match(worker, /get_channel_credits,[\s\S]*get_videos_credits,[\s\S]*credits_spent/);
  assert.match(worker, /summarizeOutreachTrackingResults\(channelResults\)/);
  assert.match(migration, /get_channel_credits INTEGER NOT NULL DEFAULT 0/);
  assert.match(migration, /get_videos_credits INTEGER NOT NULL DEFAULT 0/);
  assert.match(migration, /credits_spent INTEGER NOT NULL DEFAULT 0/);
});

test("Outreach history exposes SUBS and V/VID modes plus honest under-two-sample state", () => {
  assert.match(app, /type SparklineMode = "subs" \| "views"/);
  assert.match(app, />SUBS<\/button>/);
  assert.match(app, />V\/VID<\/button>/);
  assert.match(app, /mode === "subs" \? point\.subscriber_count : point\.median_recent_views/);
  assert.match(app, /if \(plotted\.length < 2\)/);
  assert.match(app, /history needs 2 samples · \{plotted\.length\}\/2/);
  assert.match(styles, /\.metric-mode button\[aria-pressed="true"\]/);
  assert.match(styles, /\.sparkline-pending/);
});
