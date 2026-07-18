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

test("library counts are quieter while active tabs retain the cyan event state", () => {
  assert.match(styles, /\.tab-shelf\.tab-shelf-library \{[\s\S]*?margin-left: auto/);
  assert.match(styles, /\.tab-shelf-library button strong \{[\s\S]*?color: #55717c/);
  assert.match(styles, /\.tabs button\.active,[\s\S]*?background: #22d3ee/);
  assert.match(styles, /\.tab-shelf-library button\.active strong \{[\s\S]*?color: #07111f/);
});
