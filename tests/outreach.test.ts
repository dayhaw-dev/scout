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
  assert.match(source, /parseOutreachStatusFilter/);
  assert.match(source, /c\.outreach_status = \?/);
  assert.match(source, /outreach_status IN \('sent', 'replied', 'in_talks'\)/);
  assert.match(source, /outreach_status IN \('signed', 'passed', 'ghosted'\)/);
  assert.match(source, /status = 'shortlisted' AND outreach_status = 'none'/);
  assert.match(source, /c\.last_touch_at ASC/);
});

test("ui includes outreach tab, shortlist funnel filter, optional follow-up, stale flag, and signed seed prompt", () => {
  const source = readFileSync("ui/src/App.tsx", "utf8");

  assert.match(source, /"outreach"/);
  assert.match(source, /outreach_status: stage === "shortlist" \? "none" : null/);
  assert.match(source, /Log outreach/);
  assert.match(source, /Update status/);
  assert.match(source, /latest_outreach_note/);
  assert.match(source, /Promote to seed/);
  assert.match(source, /STALE/);
  assert.match(source, /next_followup_at: nextFollowup \|\| null/);
  assert.doesNotMatch(source, /daysFromNowInput/);
  assert.match(source, /Closed \(\{closed\.length\}\)/);
});

test("ui card actions use one primary action and overflow for secondary actions", () => {
  const source = readFileSync("ui/src/App.tsx", "utf8");
  const styles = readFileSync("ui/src/styles.css", "utf8");

  assert.match(source, /primary: tab === "pool"/);
  assert.match(source, /primary: tab === "shortlist" \|\| tab === "outreach"/);
  assert.match(source, /updateOutreach/);
  assert.match(source, /visibleSecondary: tab === "pool" \|\| tab === "shortlist"/);
  assert.match(source, /secondary-action/);
  assert.match(source, /onEnrich=\{stage !== "rejected" \? \(\) => void enrichCard\(channel\) : undefined\}/);
  assert.match(source, /onEnrich=\{\(\) => void enrichCard\(channel\)\}/);
  assert.match(source, /enrichFreshDays: enrichmentFreshDays\(channel\)/);
  assert.match(source, /title: disabled \? `enriched \$\{enrichFreshDays\}d ago` : "Enrich activity"/);
  assert.match(source, /className="action-overflow"/);
  assert.match(source, /createPortal/);
  assert.match(source, /closeOnOutside/);
  assert.match(source, /closeOnEscape/);
  assert.match(source, /overflow-trigger/);
  assert.match(source, /overflow-portal/);
  assert.match(source, /statusRedundantForTab/);
  assert.match(source, /provenanceText/);
  assert.match(styles, /\.action-overflow/);
  assert.match(styles, /\.overflow-portal/);
  assert.match(styles, /\.toggle-chip\.active/);
  assert.match(styles, /\.outreach-field/);
  assert.match(styles, /\.outreach-control/);
});
