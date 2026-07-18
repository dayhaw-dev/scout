import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync("ui/src/App.tsx", "utf8");
const styles = readFileSync("ui/src/styles.css", "utf8");

test("header groups all eight views into WORK, WATCH, and LIBRARY shelves", () => {
  assert.match(app, /label: "Work".*tabs: \["pool", "shortlist", "outreach"\]/);
  assert.match(app, /label: "Watch".*tabs: \["watchlist", "snoozed"\]/);
  assert.match(app, /label: "Library".*tabs: \["seeds", "brands", "rejected"\]/);
  assert.match(app, /role="group"/);
  assert.match(app, /aria-label=\{`\$\{shelf\.label\} views`\}/);
  assert.match(app, /shelf\.tabs\.map/);
});

test("inactive tab labels and counts recede while the active tab keeps the cyan baseline event", () => {
  assert.match(styles, /\.tab-shelf\.tab-shelf-library \{[\s\S]*?margin-left: auto/);
  assert.match(styles, /\.tabs button \{[\s\S]*?color: #7fa5c2;[\s\S]*?background: transparent/);
  assert.match(styles, /\.tabs button strong \{[\s\S]*?color: #587888/);
  assert.match(styles, /\.tab-shelf-library \.tab-shelf-label \{[\s\S]*?color: #496a79/);
  assert.match(styles, /\.tab-shelf-library button strong \{[\s\S]*?color: #496a79/);
  assert.match(styles, /\.tabs button\.active \{[\s\S]*?background: var\(--surface-strong\);[\s\S]*?border: 1px solid #16435f;[\s\S]*?border-bottom: 2px solid #17d9ff/);
  assert.match(styles, /\.tabs button\.active strong \{[\s\S]*?color: #7fa5c2/);
  assert.match(styles, /\.tab-shelf-library button\.active strong \{[\s\S]*?color: #7fa5c2/);
  assert.match(styles, /\.stat-module span \{[\s\S]*?color: #7fa5c2/);
  assert.match(styles, /\.stat-module strong \{[\s\S]*?color: #22d3ee/);
});
