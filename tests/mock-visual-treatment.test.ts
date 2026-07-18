import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const styles = readFileSync("ui/src/styles.css", "utf8");
const app = readFileSync("ui/src/App.tsx", "utf8");

test("mock treatment keeps tabs flat and containers hairline", () => {
  assert.match(styles, /\.tabs button \{[\s\S]*?border-bottom: 2px solid transparent;[\s\S]*?clip-path: none;/);
  assert.match(styles, /\.tabs button\.active \{[\s\S]*?background: transparent;[\s\S]*?border-bottom-color: #22d3ee;/);
  assert.match(styles, /\.stat-module \{[\s\S]*?background: transparent;[\s\S]*?border: 1px solid/);
  assert.match(styles, /\.discovery-console-folded \{[\s\S]*?background: transparent;/);
});

test("prospect treatment stays compact and flat", () => {
  assert.match(styles, /\.prospect-card \{[\s\S]*?min-height: 0;[\s\S]*?align-self: start;[\s\S]*?padding: 9px 11px 10px;[\s\S]*?gap: 4px;/);
  assert.match(styles, /\.prospect-card::before,[\s\S]*?calc\(100% - 7px\)/);
  assert.match(styles, /\.prospect-card \.score \{[\s\S]*?width: 46px;[\s\S]*?box-shadow: none;/);
  assert.match(styles, /\.prospect-card \.status-chip-row:empty \{[\s\S]*?display: none;/);
  assert.match(styles, /\.prospect-card \.provenance-line \{[\s\S]*?min-height: 0;/);
  assert.match(styles, /\.prospect-card \.card-actions \{[\s\S]*?padding-top: 0;/);
});

test("Pool cards emphasize stat values and restore contained thumbnails", () => {
  assert.match(app, /tab === "pool" \? "pool-card"/);
  assert.match(app, /src=\{tab === "pool" \? channel\.thumbnail_url : null\}/);
  assert.match(styles, /\.prospect-card\.pool-card \.prospect-stat-grid \.stat-block strong \{[\s\S]*?color: #f4fbff;[\s\S]*?font-size: 17px;[\s\S]*?font-weight: 800;/);
  assert.match(styles, /\.prospect-card\.pool-card \.prospect-stat-grid \.stat-block span \{[\s\S]*?color: #587888;[\s\S]*?font-size: 9px;/);
  assert.match(styles, /\.prospect-card\.pool-card \.prospect-stat-grid \.stat-block\.signal-stat strong \{[\s\S]*?color: #22d3ee;/);
  assert.match(styles, /\.prospect-card \.card-head img,[\s\S]*?width: 30px;[\s\S]*?height: 30px;[\s\S]*?border-radius: 50%;/);
});
