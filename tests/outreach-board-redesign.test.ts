import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync("ui/src/App.tsx", "utf8");
const styles = readFileSync("ui/src/styles.css", "utf8");

test("Outreach renders ACTIVE then LIVE then collapsed CLOSED", () => {
  const activeIndex = app.indexOf("Active / working with");
  const liveIndex = app.indexOf("<strong>Live</strong>");
  const closedIndex = app.indexOf('className="closed-section clipped"');
  assert.ok(activeIndex >= 0 && liveIndex > activeIndex && closedIndex > liveIndex);
  assert.match(app, /<details className="closed-section clipped">/);
  assert.doesNotMatch(app, /<details className="closed-section clipped" open/);
  assert.match(app, /Signed \{closedCounts\.signed\} · Passed \{closedCounts\.passed\}/);
  assert.match(styles, /\.closed-section summary\s*\{[^}]*grid-template-columns: auto 1fr auto/s);
});

test("Add to roster states the zero-credit existing path and confirmed new lookup", () => {
  assert.match(app, /Existing SCOUT channels 0 CR · New channels need a confirmed lookup/);
  assert.match(app, /className="primary" type="submit"/);
  assert.match(app, /Expected cost: \{rosterConfirmation\.expectedCredits\} credit/);
  assert.match(app, /Confirm spend & add/);
});

test("Outreach stage is the first card chip while ACTIVE remains visible", () => {
  const brandChipIndex = app.indexOf('{channel.kind === "brand" && <span className="chip badge-attribute kind-brand">');
  const chipRowStart = app.lastIndexOf('<div className="status-chip-row">', brandChipIndex);
  const chipRow = app.slice(chipRowStart, app.indexOf("<GrowthChipItems", chipRowStart));
  assert.ok(chipRow.indexOf("badge-stage outreach-chip") < chipRow.indexOf("kind-brand"));
  assert.ok(chipRow.indexOf("badge-stage outreach-chip") < chipRow.indexOf("active-relationship-chip"));
  assert.match(app, /SENT, REPLIED, IN TALKS, and PITCHED — stalest touch first/);
});
