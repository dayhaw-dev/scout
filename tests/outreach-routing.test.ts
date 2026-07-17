import assert from "node:assert/strict";
import test from "node:test";
import {
  CLOSED_OUTREACH_STATUSES,
  LIVE_OUTREACH_STATUSES,
  OUTREACH_STATUSES,
  outreachRoute,
} from "../src/lib/outreach.js";

test("every outreach status has exactly one explicit route", () => {
  const expected = new Map([
    ["none", "pipeline"],
    ["sent", "live"],
    ["replied", "live"],
    ["in_talks", "live"],
    ["pitched", "live"],
    ["signed", "closed"],
    ["passed", "closed"],
  ] as const);

  assert.equal(expected.size, OUTREACH_STATUSES.length);
  for (const status of OUTREACH_STATUSES) {
    assert.equal(outreachRoute(status), expected.get(status));
  }
  assert.deepEqual(LIVE_OUTREACH_STATUSES, ["sent", "replied", "in_talks", "pitched"]);
  assert.deepEqual(CLOSED_OUTREACH_STATUSES, ["signed", "passed"]);
});
