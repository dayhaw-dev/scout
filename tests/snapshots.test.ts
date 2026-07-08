import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { planSnapshotRun, SNAPSHOT_CONFIG } from "../src/lib/snapshots.js";

test("snapshot planner skips recent rows and caps scheduled work with a mocked clock", () => {
  const now = new Date("2026-07-07T09:00:00.000Z");
  const candidates = [
    { channel_id: "recent", last_snapshot_at: "2026-07-06T09:00:00.000Z" },
    { channel_id: "old", last_snapshot_at: "2026-07-04T08:59:00.000Z" },
    { channel_id: "old", last_snapshot_at: "2026-07-04T08:59:00.000Z" },
    ...Array.from({ length: 65 }, (_, index) => ({
      channel_id: `eligible-${index}`,
      last_snapshot_at: null,
    })),
  ];

  const plan = planSnapshotRun(candidates, now, SNAPSHOT_CONFIG.maxPerRun);

  assert.equal(plan.targets.length, 60);
  assert.equal(plan.skippedRecent, 1);
  assert.equal(plan.truncated, 6);
  assert.match(plan.note ?? "", /48h/);
  assert.match(plan.note ?? "", /60-snapshot cap/);
  assert.equal(plan.targets.some((target) => target.channel_id === "recent"), false);
});

test("phase 9 migration adds snapshots and jobs tables", () => {
  const migration = readFileSync("migrations/0011_snapshots_jobs.sql", "utf8");

  assert.match(migration, /CREATE TABLE IF NOT EXISTS snapshots/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_snapshots_channel_taken_at/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS jobs/);
});

test("phase 9.5 migration adds meta table for credit sync", () => {
  const migration = readFileSync("migrations/0012_meta.sql", "utf8");

  assert.match(migration, /CREATE TABLE IF NOT EXISTS meta/);
  assert.match(migration, /key TEXT PRIMARY KEY/);
  assert.match(migration, /updated_at TEXT NOT NULL/);
});
