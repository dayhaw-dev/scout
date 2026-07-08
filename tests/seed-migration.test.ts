import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("seed flag migration preserves pipeline status independently", () => {
  const migration = readFileSync("migrations/0007_seed_flag.sql", "utf8");

  assert.match(migration, /ADD COLUMN is_seed INTEGER NOT NULL DEFAULT 0/);
  assert.match(migration, /SET is_seed = 1,\s*status = 'candidate'/);
  assert.match(migration, /WHERE status = 'seed'/);
  assert.match(migration, /idx_channels_is_seed/);
});
