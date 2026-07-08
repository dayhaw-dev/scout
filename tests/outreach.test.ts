import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("outreach migration adds channel state and append-only log", () => {
  const migration = readFileSync("migrations/0017_outreach_tracking.sql", "utf8");

  assert.match(migration, /outreach_status TEXT NOT NULL DEFAULT 'none'/);
  assert.match(migration, /sent', 'replied', 'in_talks', 'signed', 'passed', 'ghosted/);
  assert.match(migration, /contacted_at TEXT/);
  assert.match(migration, /next_followup_at TEXT/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS outreach_log/);
  assert.match(migration, /idx_outreach_log_channel_created/);
});

test("worker exposes outreach list and log endpoints", () => {
  const source = readFileSync("src/index.ts", "utf8");

  assert.match(source, /\/api\/outreach/);
  assert.match(source, /\/api\\\/channels\\\/\(\[\^\/\]\+\)\\\/outreach/);
  assert.match(source, /function logOutreach/);
  assert.match(source, /INSERT INTO outreach_log/);
  assert.match(source, /outreach_status NOT IN \('none', 'signed', 'passed'\)/);
  assert.match(source, /outreach_status IN \('signed', 'passed'\)/);
  assert.match(source, /c\.last_touch_at ASC/);
});

test("ui includes outreach tab, optional follow-up, stale flag, and signed seed prompt", () => {
  const source = readFileSync("ui/src/App.tsx", "utf8");

  assert.match(source, /"outreach"/);
  assert.match(source, /Log outreach/);
  assert.match(source, /Promote to seed/);
  assert.match(source, /STALE/);
  assert.match(source, /next_followup_at: nextFollowup \|\| null/);
  assert.doesNotMatch(source, /daysFromNowInput/);
  assert.match(source, /Closed \(\{closed\.length\}\)/);
});
