import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync("ui/src/App.tsx", "utf8");
const seedFreshness = readFileSync("ui/src/seed-freshness.ts", "utf8");
const styles = readFileSync("ui/src/styles.css", "utf8");

test("channel cards use the three-tier badge vocabulary", () => {
  assert.match(app, /channel\.kind === "brand" && <span className="chip badge-attribute kind-brand">BRAND<\/span>/);
  assert.doesNotMatch(app, /kind-\$\{channel\.kind\}/);
  assert.doesNotMatch(app, />\{channel\.kind\}<\/span>/);
  assert.doesNotMatch(app, /statusRedundantForTab|className="chip status-chip"/);
  assert.doesNotMatch(app, />MOVER<|>STALE</);

  assert.match(app, /badge-alert hot-chip">HOT/);
  assert.match(app, /badge-alert new-chip">NEW/);
  assert.match(app, /badge-alert woke-chip">WOKE/);
  assert.match(app, /badge-alert locked-chip/);

  assert.match(app, /badge-attribute active-relationship-chip">ACTIVE/);
  assert.match(seedFreshness, /count >= 8 \? "high"/);
  assert.match(app, /className=\{`seed-ore-tile ore-\$\{presentation\.tone\}`\}/);
  assert.match(styles, /\.seed-ore-tile\.ore-high/);
  assert.match(seedFreshness, /tone: fullyMined \? "mined"/);
  assert.match(app, /className=\{`seed-ore-tile ore-\$\{presentation\.tone\}`\}/);
  assert.match(app, /badge-attribute no-trend-chip">NO TREND/);
  assert.doesNotMatch(app, />TRACKING/);
});

test("stage badges render only on the mixed-stage Outreach board", () => {
  assert.match(app, /tab === "outreach" && channel\.outreach_status/);
  assert.match(app, /badge-stage outreach-chip/);
  assert.doesNotMatch(app, /showStatus/);
  assert.doesNotMatch(app, /seed\.status}<\/span>|>seed<\/span>/i);
});

test("badge styling makes attributes quieter than stages and alerts", () => {
  assert.match(styles, /\.chip\.badge-stage\s*\{[^}]*font-weight: 700/s);
  assert.match(styles, /\.chip\.badge-alert\s*\{[^}]*font-weight: 800/s);
  assert.match(styles, /\.chip\.badge-attribute\s*\{[^}]*border-color: rgba\(143, 180, 196, 0\.18\)[^}]*background: rgba\(10, 18, 32, 0\.42\)[^}]*font-weight: 500/s);
  assert.match(styles, /\.chip\.locked-chip\s*\{[^}]*rgba\(250, 204, 21,/s);
});

test("score fill thresholds are 70 filled, 55 outlined, and below 55 muted", () => {
  assert.match(app, /if \(score >= 70\) return "high";\s*if \(score >= 55\) return "mid";/);
  assert.match(styles, /--signal-cyan: #17d9ff;/);
  assert.match(styles, /\.score-high\s*\{[^}]*background: var\(--signal-cyan\);[^}]*border-color: var\(--signal-cyan\);/s);
  assert.match(styles, /\.score-mid\s*\{[^}]*color: #67e8f9;[^}]*background: rgba\(7, 17, 31, 0\.44\);[^}]*border-color: rgba\(34, 211, 238, 0\.72\);[^}]*box-shadow: none/s);
  assert.match(styles, /\.score-low\s*\{[^}]*color: #9bc4d2;[^}]*background: rgba\(10, 18, 32, 0\.4\);[^}]*border-color: rgba\(143, 180, 196, 0\.16\);[^}]*box-shadow: none/s);
});
