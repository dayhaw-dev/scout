import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync("ui/src/App.tsx", "utf8");
const api = readFileSync("ui/src/api.ts", "utf8");
const source = readFileSync("src/index.ts", "utf8");
const styles = readFileSync("ui/src/styles.css", "utf8");

test("Seeds is an ore-first row garden with no score surface", () => {
  assert.match(app, /className="view seeds-garden"/);
  assert.match(app, /className="seed-rows" role="table"/);
  assert.match(app, /function SeedRow/);
  assert.match(app, /function SeedOreTile/);
  assert.match(app, /count >= 8 \? "ore-high" : count > 0 \? "ore-low" : "ore-mined"/);
  assert.match(app, /const \[seedSort, setSeedSort\] = useState<SeedSortMode>\("unmined"\)/);
  assert.doesNotMatch(app, /seed-card/);
  assert.match(styles, /\.seed-row\s*\{[^}]*display: grid/s);
  assert.match(styles, /\.seed-ore-tile\.ore-high\s*\{[^}]*background: #22d3ee/s);
  assert.match(styles, /\.seed-ore-tile\.ore-low\s*\{[^}]*border-color: rgba\(34, 211, 238, 0\.68\)/s);
});

test("Seed garden exposes the requested stats, columns, prices, and mined-out split", () => {
  for (const label of ["Seeds", "Unmined uploads", "Lifetime yield", "Locked"]) {
    assert.match(app, new RegExp(`label="${label}"`));
  }
  for (const label of ["YIELD", "SUBS", "ADDED", "LAST UPLOAD", "QUERIES", "EXPAND", "SNAPSHOT", "UNSEED"]) {
    assert.match(app.toUpperCase(), new RegExp(label));
  }
  assert.match(app, /Expand All ≤\{EXPAND_ALL_CLIENT_CREDIT_CAP\} CR/);
  assert.match(app, /Snapshot All ≤\{Math\.min\(seeds\.length, 60\)\} CR/);
  assert.match(app, /Regen Queries 0 CR/);
  assert.match(app, /RSS COUNTS CAP AT 15\+ PER SEED · INCLUDES SHORTS/);
  assert.match(app, /MINED OUT/);
  assert.match(app, /isMinedOutSeed/);
  assert.match(app, /seed-upload-fresh/);
});

test("Seed lock reason is carried from D1 and shown without weakening API fences", () => {
  assert.match(source, /seed_lock_reason: "DEMO FENCE" \| "DEMO RESERVE" \| null/);
  assert.match(api, /seed_lock_reason: "DEMO FENCE" \| "DEMO RESERVE" \| null/);
  assert.match(app, /title=\{seed\.seed_lock_reason \?\? "LOCK REASON NOT RECORDED"\}/);
  assert.match(app, /disabled=\{seed\.seed_locked\}/);
  assert.match(app, /<button onClick=\{onSnapshot\}>Snapshot<\/button>/);
});

test("individual Expand exposes guarded pending state and inline retry errors", () => {
  assert.match(app, /const \[expandingSeedId, setExpandingSeedId\] = useState<string \| null>\(null\)/);
  assert.match(app, /const expandingSeedRef = useRef<string \| null>\(null\)/);
  assert.match(app, /if \(expandingSeedRef\.current\) return;/);
  assert.match(app, /setExpandingSeedId\(channelId\);[\s\S]*?await api\.expandSeed\(channelId, maxPages, maxResolves\)/);
  assert.match(app, /finally \{[\s\S]*?expandingSeedRef\.current = null;[\s\S]*?setExpandingSeedId\(null\);/);
  assert.match(app, /Fetching videos and resolving up to \{maxResolves\} channels…/);
  assert.match(app, /className="expand-error" role="alert"/);
  assert.match(app, /disabled=\{pending\}/);
  assert.match(app, /pending \? "Expanding…" : error \? "Retry" : "Expand"/);
  assert.match(styles, /\.expand-pending,[\s\S]*?\.expand-error/);
});
