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

test("outreach vocabulary and active relationship migration is additive", () => {
  const migration = readFileSync("migrations/0023_outreach_routing_active.sql", "utf8");

  assert.match(migration, /ALTER TABLE channels ADD COLUMN outreach_stage TEXT NOT NULL DEFAULT 'none'/);
  assert.match(migration, /sent', 'replied', 'in_talks', 'pitched', 'signed', 'passed/);
  assert.match(migration, /ALTER TABLE channels ADD COLUMN is_active INTEGER NOT NULL DEFAULT 0/);
  assert.match(migration, /WHEN 'ghosted' THEN 'passed'/);
  assert.match(migration, /WHERE outreach_status <> 'none'/);
  assert.doesNotMatch(migration, /CREATE TABLE\s+channels/i);
  assert.doesNotMatch(migration, /DROP TABLE\s+channels/i);
  assert.doesNotMatch(migration, /ALTER TABLE\s+channels\s+RENAME/i);
});

test("worker exposes outreach list and log endpoints", () => {
  const source = readFileSync("src/index.ts", "utf8");

  assert.match(source, /\/api\/outreach/);
  assert.match(source, /\/api\\\/channels\\\/\(\[\^\/\]\+\)\\\/outreach/);
  assert.match(source, /function logOutreach/);
  assert.match(source, /INSERT INTO outreach_log/);
  assert.match(source, /parseOutreachStatusFilter/);
  assert.match(source, /c\.outreach_stage = \?/);
  assert.match(source, /LIVE_OUTREACH_SQL/);
  assert.match(source, /CLOSED_OUTREACH_SQL/);
  assert.match(source, /status = 'shortlisted' AND outreach_stage = 'none' AND is_active = 0/);
  assert.match(source, /c\.last_touch_at ASC/);
  assert.match(source, /working: working\.map/);
  assert.match(source, /is_active = 1/);
  assert.match(source, /c\.is_active = 0 AND c\.outreach_stage IN/);
  assert.match(source, /WHERE is_active = 0\s+AND outreach_stage IN/);
});

test("ui includes ACTIVE, LIVE, and CLOSED outreach groups with explicit status chips", () => {
  const source = readFileSync("ui/src/App.tsx", "utf8");
  const seedFreshness = readFileSync("ui/src/seed-freshness.ts", "utf8");

  assert.match(source, /"outreach"/);
  assert.match(source, /Active \/ working with/i);
  assert.match(source, /<strong>Live<\/strong>/);
  assert.match(source, /"pitched"/);
  assert.match(source, /active-relationship-chip/);
  assert.match(source, /channel\.is_active && <span className="chip badge-attribute active-relationship-chip">ACTIVE<\/span>/);
  assert.match(source, /channel\.outreach_status && channel\.outreach_status !== "none"/);
  assert.match(source, /Mark ACTIVE \/ working with/);
  assert.match(source, /Log outreach/);
  assert.match(source, /Update status/);
  assert.match(source, /latest_outreach_note/);
  assert.match(source, /Promote to seed/);
  assert.match(seedFreshness, /STALE/);
  assert.match(source, /import \{ seedFreshnessPacingMs, seedOrePresentation \} from "\.\/seed-freshness"/);
  assert.match(source, /seedOrePresentation\(freshness\)/);
  assert.match(source, /next_followup_at: nextFollowup \|\| null/);
  assert.doesNotMatch(source, /daysFromNowInput/);
  assert.match(source, /Closed — \{closed\.length\}/);
  assert.match(source, /Signed \{closedCounts\.signed\} · Passed \{closedCounts\.passed\}/);
  assert.doesNotMatch(source, /ghosted/);
});

test("ui card actions use one primary action and overflow for secondary actions", () => {
  const source = readFileSync("ui/src/App.tsx", "utf8");
  const styles = readFileSync("ui/src/styles.css", "utf8");

  assert.match(source, /primary: tab === "pool"/);
  assert.match(source, /primary: tab === "shortlist" \|\| tab === "outreach"/);
  assert.match(source, /updateOutreach/);
  assert.match(source, /visibleSecondary: tab === "pool" \|\| tab === "shortlist" \|\| tab === "snoozed"/);
  assert.match(source, /secondary-action/);
  assert.match(source, /onEnrich=\{stage !== "rejected" && stage !== "snoozed" \? \(\) => void enrichCard\(channel\) : undefined\}/);
  assert.match(source, /onEnrich=.*enrichCard\(channel\)/);
  assert.match(source, /enrichFreshDays: enrichmentFreshDays\(channel\)/);
  assert.match(source, /title: disabled \? `enriched \$\{enrichFreshDays\}d ago` : "Enrich activity"/);
  assert.match(source, /className="action-overflow"/);
  assert.match(source, /createPortal/);
  assert.match(source, /closeOnOutside/);
  assert.match(source, /closeOnEscape/);
  assert.match(source, /overflow-trigger/);
  assert.match(source, /overflow-portal/);
  assert.doesNotMatch(source, /statusRedundantForTab/);
  assert.match(source, /tab === "outreach" && channel\.outreach_status/);
  assert.match(source, /provenanceText/);
  assert.match(styles, /\.action-overflow/);
  assert.match(styles, /\.overflow-portal/);
  assert.match(styles, /\.toggle-chip\.active/);
  assert.match(styles, /\.outreach-field/);
  assert.match(styles, /\.outreach-control/);
});
