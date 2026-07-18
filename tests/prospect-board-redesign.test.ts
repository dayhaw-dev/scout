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
  assert.match(app, /<SavedSearchesPanel[\s\S]*?searches=\{searches\}[\s\S]*?open=\{openDiscoveryLibrary === "saved"\}/);
  assert.match(app, /label="TOPICS"/);
  assert.match(app, /label="CONTENT"/);
  assert.match(app, /const \[hideSearched, setHideSearched\] = useState\(true\)/);
  assert.match(app, /aria-label=\{`Filter \$\{label\.toLowerCase\(\)\}`\}/);
  assert.match(app, /aria-label="Filter saved searches"/);
  assert.match(styles, /\.discovery-summary-row/);
  assert.match(styles, /\.discovery-expanded/);
  assert.match(styles, /\.discovery-chip-viewport,[\s\S]*?max-height: 176px;[\s\S]*?overflow: auto;/);
  assert.match(styles, /\.discovery-expanded \.discovery-field \{[\s\S]*?border: 1px solid[\s\S]*?background: transparent;/);
});

test("deep variants stay with the keyword and discovery libraries share one accordion", () => {
  const keywordIndex = app.indexOf('className="keyword-control"');
  const variantIndex = app.indexOf('className="variant-row discovery-query-variants"');
  const expandedIndex = app.indexOf('className="discovery-expanded"');
  const controlIndex = app.indexOf('className="discovery-control-row"');
  assert.ok(keywordIndex >= 0 && keywordIndex < variantIndex, "variants render inside the keyword stack");
  assert.ok(variantIndex < expandedIndex && expandedIndex < controlIndex, "variants render before the parameter and library panel");
  assert.match(app, /discovery-query-variants[\s\S]*?aria-label=\{`Remove \$\{variant\}`\}/);
  assert.match(styles, /\.discovery-query-variants \{[\s\S]*?grid-column: 1 \/ -1;/);

  assert.match(app, /type DiscoveryLibraryKey = "topics" \| "content" \| "saved"/);
  assert.match(app, /const \[openDiscoveryLibrary, setOpenDiscoveryLibrary\] = useState<DiscoveryLibraryKey \| null>\(null\)/);
  assert.match(app, /open=\{openPanel === "topics"\}/);
  assert.match(app, /open=\{openPanel === "content"\}/);
  assert.match(app, /open=\{openDiscoveryLibrary === "saved"\}/);
  assert.match(app, /value === "saved" \? null : "saved"/);
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

test("Commit 5 supersedes the deferred flat header without changing the Pool surface", () => {
  assert.match(app, /const TAB_SHELVES:/);
  assert.match(app, /tab-shelves/);
  assert.match(app, /tone: "work"/);
  assert.match(app, /tone: "watch"/);
  assert.match(app, /tone: "library"/);
});
