import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { planSnoozeTransition, SnoozeValidationError } from "../src/lib/snooze.js";

const now = new Date("2026-07-16T12:00:00.000Z");

function state(status: string) {
  return {
    status,
    snoozed_until: null,
    snooze_reason: null,
    snoozed_at: null,
    snoozed_from_status: null,
    woke_at: null,
  };
}

test("plans a snooze from Pool and preserves its prior status", () => {
  assert.deepEqual(
    planSnoozeTransition(state("candidate"), {
      status: "snoozed",
      snoozed_until: "2026-10-16T12:00:00.000Z",
      snooze_reason: "  No matching brand yet  ",
    }, now),
    {
      kind: "snooze",
      until: "2026-10-16T12:00:00.000Z",
      reason: "No matching brand yet",
      fromStatus: "candidate",
      preserveStartedAt: false,
    },
  );
});

test("editing a snooze keeps its original start and prior stage", () => {
  assert.deepEqual(
    planSnoozeTransition({
      ...state("snoozed"),
      snoozed_at: "2026-07-01T00:00:00.000Z",
      snoozed_from_status: "watchlist",
    }, {
      snoozed_until: "2027-01-16T12:00:00.000Z",
      snooze_reason: "Inventory mismatch",
    }, now),
    {
      kind: "snooze",
      until: "2027-01-16T12:00:00.000Z",
      reason: "Inventory mismatch",
      fromStatus: "watchlist",
      preserveStartedAt: true,
    },
  );
});

test("wake and later status changes retain then clear snooze context", () => {
  const snoozed = { ...state("snoozed"), snooze_reason: "B2B infra", snoozed_until: "2026-10-01T00:00:00.000Z" };
  assert.deepEqual(planSnoozeTransition(snoozed, { status: "candidate" }, now), { kind: "wake" });

  const woken = { ...state("candidate"), snooze_reason: "B2B infra", woke_at: "2026-07-16T12:00:00.000Z" };
  assert.deepEqual(planSnoozeTransition(woken, { status: "shortlisted" }, now), { kind: "clear" });
});

test("snooze requires a future date and a reason", () => {
  assert.throws(
    () => planSnoozeTransition(state("watchlist"), {
      status: "snoozed",
      snoozed_until: "2026-07-15T12:00:00.000Z",
      snooze_reason: "",
    }, now),
    SnoozeValidationError,
  );
});

test("migration, snapshot target, and UI stage carry snooze end to end", () => {
  const migration = readFileSync("migrations/0019_snooze_status.sql", "utf8");
  const worker = readFileSync("src/index.ts", "utf8");
  const ui = readFileSync("ui/src/App.tsx", "utf8");

  assert.match(migration, /status IN \('candidate', 'shortlisted', 'watchlist', 'snoozed', 'rejected'\)/);
  assert.match(migration, /snoozed_until TEXT/);
  assert.match(migration, /snooze_reason TEXT/);
  assert.match(migration, /snoozed_from_status TEXT/);
  assert.match(migration, /woke_at TEXT/);
  assert.match(worker, /c\.status IN \('watchlist', 'snoozed'\)/);
  assert.match(worker, /datetime\(snoozed_until\) <= CURRENT_TIMESTAMP/);
  assert.match(ui, /label: "Watch".*tabs: \["watchlist", "snoozed"\]/);
  assert.match(ui, /label: "Library".*"seeds"/);
  assert.match(ui, /\{snoozedCount\} snoozed - wake or reject something/);
  assert.match(ui, />WOKE</);
});
