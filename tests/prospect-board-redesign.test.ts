import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync("ui/src/App.tsx", "utf8");
const api = readFileSync("ui/src/api.ts", "utf8");
const scorer = readFileSync("src/lib/score.ts", "utf8");
const styles = readFileSync("ui/src/styles.css", "utf8");

test("V1 prospect tiles expose four fixed stats and temporal signal colors", () => {
  assert.match(app, /className="stat-grid prospect-stat-grid"/);
  assert.match(app, /label="subs"/);
  assert.match(app, /label="v\/vid"/);
  assert.match(app, /label="reach"/);
  assert.match(app, /label="spons"/);
  assert.match(app, /reach >= 0\.3 \? "signal-stat"/);
  assert.match(app, /daysAgo\(lastUploadAt\) > 30 \? "last-upload-stale"/);
  assert.match(app, /provenanceItems\.join\(" · "\)/);
  assert.match(styles, /\.prospect-stat-grid\s*\{[^}]*repeat\(4,/s);
  assert.match(styles, /\.footer-dates\.last-upload-stale\s*\{[^}]*#fbbf24/s);
});

test("discovery console folds to one line and restores controls plus query sources", () => {
  assert.match(app, /discovery-console-folded/);
  assert.match(app, /searchParameterEcho\(/);
  assert.match(app, /aria-expanded=\{discoveryOpen\}/);
  assert.match(app, /<SuggestionRows/);
  assert.match(app, /Saved queries \{recentOpen \? "hide" : "show"\}/);
  assert.match(styles, /\.discovery-summary-row/);
  assert.match(styles, /\.discovery-expanded/);
});

test("Pool density toggle provides 40px rows and guarded S-X triage", () => {
  assert.match(app, /type PoolDensity = "cards" \| "rows"/);
  assert.match(app, /aria-label="Pool density"/);
  assert.match(app, /density === "rows"/);
  assert.match(app, /<ProspectRows/);
  assert.match(app, /if \(key !== "s" && key !== "x"\) return/);
  assert.match(app, /isEditableTarget\(event\.target\)/);
  assert.match(app, /key === "s" \? "shortlisted" : "rejected"/);
  assert.match(styles, /\.prospect-row\s*\{[^}]*min-height: 40px/s);
});

test("score popover renders the persisted real scorer components without formula changes", () => {
  assert.match(api, /score_breakdown: ScoreBreakdown \| null/);
  assert.match(app, /<ScoreBreakdownPopover channel=\{channel\}/);
  assert.match(app, /component\.points\?\.toFixed\(1\).*component\.weight/s);
  assert.match(app, /<progress max=\{component\.weight \?\? 1\} value=\{component\.points \?\? 0\}/);
  assert.match(app, /scoreComponentLabel\(name\)/);
  assert.match(styles, /\.score-popover-anchor:hover \.score-popover/);
  assert.match(styles, /\.score-popover-anchor\.pinned \.score-popover/);
  assert.match(scorer, /subRangeFit: 20/);
  assert.match(scorer, /engagementReach: 45/);
  assert.match(scorer, /mentionStrength: 20/);
  assert.match(scorer, /contactability: 15/);
});

test("Commit 2 leaves the existing flat tab header intact", () => {
  assert.match(app, /const TABS: Tab\[\]/);
  assert.doesNotMatch(app, /WORK \/ WATCH \/ LIBRARY|header-shelf|tab-shelf/);
});
