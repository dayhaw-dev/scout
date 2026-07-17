import assert from "node:assert/strict";
import test from "node:test";
import { shortlistStageClause } from "../src/lib/stage-query.js";

test("shortlist stage clause filters each pipeline status exactly", () => {
  const candidate = shortlistStageClause("candidate", null);
  assert.equal(candidate.sql, "(c.status = ?) AND (c.outreach_stage = 'none') AND (c.is_active = 0)");
  assert.deepEqual(candidate.bindings, ["candidate"]);

  const shortlisted = shortlistStageClause("shortlisted", null);
  assert.equal(shortlisted.sql, "(c.status = ?) AND (c.outreach_stage = 'none') AND (c.is_active = 0)");
  assert.deepEqual(shortlisted.bindings, ["shortlisted"]);

  const watchlist = shortlistStageClause("watchlist", null);
  assert.equal(watchlist.sql, "(c.status = ?) AND (c.outreach_stage = 'none') AND (c.is_active = 0)");
  assert.deepEqual(watchlist.bindings, ["watchlist"]);

  const snoozed = shortlistStageClause("snoozed", null);
  assert.equal(snoozed.sql, "(c.status = ?) AND (c.outreach_stage = 'none') AND (c.is_active = 0)");
  assert.deepEqual(snoozed.bindings, ["snoozed"]);

  const rejected = shortlistStageClause("rejected", null);
  assert.equal(rejected.sql, "(c.status = ?) AND (c.outreach_stage = 'none') AND (c.is_active = 0)");
  assert.deepEqual(rejected.bindings, ["rejected"]);
});

test("shortlist stage clause supports pool and seed stage queries", () => {
  const pool = shortlistStageClause("candidate", false);
  assert.equal(pool.sql, "(c.status = ?) AND (c.outreach_stage = 'none') AND (c.is_active = 0) AND (c.is_seed = ?)");
  assert.deepEqual(pool.bindings, ["candidate", 0]);

  const seeds = shortlistStageClause("all", true);
  assert.equal(seeds.sql, "(c.is_seed = ?)");
  assert.deepEqual(seeds.bindings, [1]);
});

test("shortlist default excludes rejected while all leaves status unrestricted", () => {
  const defaultClause = shortlistStageClause(null, null);
  assert.equal(defaultClause.sql, "(c.status IN ('candidate', 'shortlisted', 'watchlist', 'snoozed')) AND (c.outreach_stage = 'none') AND (c.is_active = 0)");
  assert.deepEqual(defaultClause.bindings, []);

  const all = shortlistStageClause("all", null);
  assert.equal(all.sql, "1 = 1");
  assert.deepEqual(all.bindings, []);
});
