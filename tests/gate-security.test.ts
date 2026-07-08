import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("SPA gate is served through Worker with strict security headers", () => {
  const wrangler = readFileSync("wrangler.jsonc", "utf8");
  const worker = readFileSync("src/index.ts", "utf8");
  const app = readFileSync("ui/src/App.tsx", "utf8");

  assert.match(wrangler, /"run_worker_first": true/);
  assert.match(worker, /script-src 'self'/);
  assert.match(worker, /frame-ancestors 'none'/);
  assert.match(worker, /assetResponse\(request, env\)/);
  assert.doesNotMatch(app, /style=\{\{/);
  assert.match(app, /rel="noopener noreferrer"/);
});
