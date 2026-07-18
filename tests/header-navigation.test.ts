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

test("library counts stay quiet while active tabs use the cyan baseline event", () => {
  assert.match(styles, /\.tab-shelf\.tab-shelf-library \{[\s\S]*?margin-left: auto/);
  assert.match(styles, /\.tab-shelf-library button strong \{[\s\S]*?color: #55717c/);
  assert.match(styles, /\.tabs button\.active \{[\s\S]*?background: #081321;[\s\S]*?border: 1px solid #16435f;[\s\S]*?border-bottom: 2px solid #17d9ff/);
  assert.match(styles, /\.tab-shelf-library button\.active strong \{[\s\S]*?color: #22d3ee/);
});
