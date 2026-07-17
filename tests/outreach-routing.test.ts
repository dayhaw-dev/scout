import assert from "node:assert/strict";
import test from "node:test";
import {
  CLOSED_OUTREACH_STATUSES,
  LIVE_OUTREACH_STATUSES,
  OUTREACH_STATUSES,
  outreachRoute,
  outreachSection,
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

test("active precedence assigns every channel to at most one Outreach section", () => {
  const cases = [
    { name: "active plus live", status: "pitched", isActive: true, expected: "working" },
    { name: "active plus closed", status: "signed", isActive: true, expected: "working" },
    { name: "plain live", status: "in_talks", isActive: false, expected: "live" },
    { name: "plain closed", status: "passed", isActive: false, expected: "closed" },
    { name: "plain pipeline", status: "none", isActive: false, expected: null },
  ] as const;
  const liveStatuses = new Set<string>(LIVE_OUTREACH_STATUSES);
  const closedStatuses = new Set<string>(CLOSED_OUTREACH_STATUSES);
  for (const entry of cases) {
    const assigned = outreachSection(entry.status, entry.isActive);
    const rendered = [
      entry.isActive ? "working" : null,
      !entry.isActive && liveStatuses.has(entry.status) ? "live" : null,
      !entry.isActive && closedStatuses.has(entry.status) ? "closed" : null,
    ].filter((section): section is "working" | "live" | "closed" => section !== null);

    assert.equal(assigned, entry.expected, entry.name);
    assert.ok(rendered.length <= 1, `${entry.name} rendered in more than one section`);
    assert.deepEqual(rendered, entry.expected === null ? [] : [entry.expected], entry.name);
  }
});
