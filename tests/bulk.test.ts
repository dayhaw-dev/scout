import assert from "node:assert/strict";
import test from "node:test";

import { runBulkOperation } from "../ui/src/bulk.js";

test("bulk orchestrator cancels without dispatching remaining items", async () => {
  const controller = { cancelled: false };
  const dispatched: string[] = [];

  const result = await runBulkOperation({
    action: "Enriching",
    items: ["a", "b", "c"].map((value) => ({ id: value, label: value, value })),
    controller,
    runItem: async (value) => {
      dispatched.push(value);
      return { credits: 1 };
    },
    getCredits: (item) => item.credits,
    getErrorMessage: (error) => String(error),
    onItemComplete: (_result, index) => {
      if (index === 0) controller.cancelled = true;
    },
  });

  assert.deepEqual(dispatched, ["a"]);
  assert.equal(result.cancelled, true);
  assert.equal(result.done, 1);
  assert.equal(result.creditsSpent, 1);
});

test("bulk orchestrator records failures and continues", async () => {
  const result = await runBulkOperation({
    action: "Snapshotting",
    items: ["one", "two", "three"].map((value) => ({ id: value, label: value, value })),
    controller: { cancelled: false },
    runItem: async (value) => {
      if (value === "two") throw new Error("boom");
      return { credits: 2 };
    },
    getCredits: (item) => item.credits,
    getErrorMessage: (error) => error instanceof Error ? error.message : String(error),
  });

  assert.equal(result.done, 2);
  assert.equal(result.creditsSpent, 4);
  assert.deepEqual(result.failures, [{ id: "two", label: "two", error: "boom" }]);
});
