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
  assert.match(styles, /\.prospect-card \{[\s\S]*?min-height: 0;[\s\S]*?align-self: stretch;[\s\S]*?padding: 9px 11px 10px;[\s\S]*?gap: 4px;/);
  assert.match(styles, /\.prospect-card::before,[\s\S]*?calc\(100% - 7px\)/);
  assert.match(styles, /\.prospect-card \.score \{[\s\S]*?width: 46px;[\s\S]*?box-shadow: none;/);
  assert.match(styles, /\.prospect-card \.status-chip-row \{[\s\S]*?min-height: 18px;/);
  assert.match(styles, /\.prospect-card \.provenance-line \{[\s\S]*?min-height: 0;/);
  assert.match(styles, /\.prospect-card \.card-actions \{[\s\S]*?padding-top: 0;/);
});

test("prospect grids fill available width and keep row heights aligned", () => {
  assert.match(styles, /\.card-grid \{[\s\S]*?repeat\(auto-fit, minmax\(min\(300px, 100%\), 1fr\)\)[\s\S]*?align-items: stretch;/);
  assert.match(styles, /\.compact-grid \{[\s\S]*?repeat\(auto-fit, minmax\(min\(280px, 100%\), 1fr\)\)/);
});

test("shared prospect cards emphasize stats and use contained thumbnails on every surface", () => {
  assert.doesNotMatch(app, /tab === "pool" \? "pool-card"/);
  assert.match(app, /<ChannelImage[\s\S]*?src=\{channel\.thumbnail_url\}/);
  assert.doesNotMatch(app, /src=\{tab === "pool" \? channel\.thumbnail_url : null\}/);
  assert.match(styles, /\.prospect-card \.prospect-stat-grid \.stat-block strong \{[\s\S]*?color: #f4fbff;[\s\S]*?font-size: 17px;[\s\S]*?font-weight: 800;/);
  assert.match(styles, /\.prospect-card \.prospect-stat-grid \.stat-block span \{[\s\S]*?color: #587888;[\s\S]*?font-size: 9px;/);
  assert.match(styles, /\.prospect-card \.prospect-stat-grid \.stat-block\.signal-stat strong \{[\s\S]*?color: #22d3ee;/);
  assert.doesNotMatch(styles, /\.prospect-card\.pool-card \.prospect-stat-grid/);
  assert.match(styles, /\.prospect-card \.card-head \{[\s\S]*?grid-template-columns: 52px minmax\(0, 1fr\) auto;/);
  assert.match(styles, /\.prospect-card \.card-head img,[\s\S]*?width: 48px;[\s\S]*?height: 48px;[\s\S]*?border-radius: 50%;/);
});

test("prospect headers truncate uniformly and action baselines ignore optional chips", () => {
  assert.match(app, /className="channel-title"[\s\S]*?title=\{channel\.title \?\? channel\.channel_id\}/);
  assert.match(styles, /\.prospect-card \.channel-title \{[\s\S]*?font-size: 16px;[\s\S]*?white-space: nowrap;[\s\S]*?text-overflow: ellipsis;/);
  assert.match(styles, /\.prospect-card \.card-identity \{[\s\S]*?min-width: 0;[\s\S]*?overflow: hidden;/);
  assert.match(styles, /\.prospect-card \.card-actions \{[\s\S]*?margin-top: auto;[\s\S]*?gap: 6px;[\s\S]*?justify-content: flex-start;/);
  assert.match(styles, /\.prospect-card \.card-actions > \.primary-action,[\s\S]*?flex: 0 0 max-content;[\s\S]*?align-self: flex-start;[\s\S]*?width: max-content;[\s\S]*?white-space: nowrap;/);
  assert.match(styles, /\.prospect-card \.card-actions > \.primary-action \{[\s\S]*?padding-inline: 14px;/);
  assert.match(styles, /\.prospect-card \.card-actions > \.secondary-action \{[\s\S]*?padding-inline: 12px;/);
});

test("every non-Pool primary action uses the same max-content card button", () => {
  assert.match(app, /label: updateOutreach \? "Update status" : "Log outreach"[\s\S]*?primary: tab === "shortlist" \|\| tab === "outreach"/);
  assert.match(app, /label: "Wake now"[\s\S]*?primary: tab === "snoozed"/);
  assert.ok((app.match(/tab="outreach"/g) ?? []).length >= 3, "ACTIVE, LIVE, and CLOSED Outreach cards share the outreach tab contract");
});

test("Eyes Peeled keeps its growth chips, NO TREND state, and sparkline inside the shared card", () => {
  assert.match(app, /<GrowthChipItems row=\{channel\} \/>/);
  assert.match(app, /<Sparkline points=\{channel\.snapshots \?\? \[\]\} \/>/);
  assert.match(app, /className="chip badge-attribute no-trend-chip">NO TREND/);
  assert.match(app, /growthWindowLabel\("SUBS", 7/);
  assert.match(app, /growthWindowLabel\("SUBS", 30/);
  assert.match(app, /growthWindowLabel\("VIEWS", 30/);
});

test("prospect actions and overflow follow the GENEOS hierarchy", () => {
  assert.match(styles, /\.primary-action \{[\s\S]*?background: #17d9ff;[\s\S]*?font-weight: 800;/);
  assert.match(styles, /\.secondary-action \{[\s\S]*?color: #d98994;[\s\S]*?background: transparent;/);
  assert.match(styles, /\.overflow-list \{[\s\S]*?border: 1px solid #16435f;[\s\S]*?background: rgba\(2, 6, 13, 0\.98\);/);
  assert.match(app, /label: "Pipeline"[\s\S]*?label: "Identity"[\s\S]*?label: "Intelligence"/);
  assert.match(app, /action\.disabled && action\.title && <small>\{action\.title\}<\/small>/);
});
