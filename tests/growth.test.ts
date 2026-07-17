import assert from "node:assert/strict";
import test from "node:test";
import { computeGrowthMetrics, isMover } from "../src/lib/growth.js";

const now = new Date("2026-07-07T09:00:00.000Z");

test("growth metrics return null while tracking span is too short", () => {
  const metrics = computeGrowthMetrics(
    [
      { subscriber_count: 1_000, view_count: 10_000, taken_at: "2026-07-04T09:00:00.000Z" },
      { subscriber_count: 1_100, view_count: 11_000, taken_at: "2026-07-07T09:00:00.000Z" },
    ],
    now,
  );

  assert.equal(metrics.tracking_days, 3);
  assert.equal(metrics.subs_growth_7d, null);
  assert.equal(metrics.subs_growth_7d_days, null);
  assert.equal(metrics.subs_growth_30d, null);
  assert.equal(metrics.subs_growth_30d_days, null);
});

test("growth metrics handle flat, growing, and shrinking snapshot series", () => {
  const flat = computeGrowthMetrics(
    [
      { subscriber_count: 1_000, view_count: 10_000, taken_at: "2026-06-07T09:00:00.000Z" },
      { subscriber_count: 1_000, view_count: 10_000, taken_at: "2026-06-30T09:00:00.000Z" },
      { subscriber_count: 1_000, view_count: 10_000, taken_at: "2026-07-07T09:00:00.000Z" },
    ],
    now,
  );
  const growing = computeGrowthMetrics(
    [
      { subscriber_count: 1_000, view_count: 10_000, taken_at: "2026-06-07T09:00:00.000Z" },
      { subscriber_count: 1_100, view_count: 12_000, taken_at: "2026-06-30T09:00:00.000Z" },
      { subscriber_count: 1_300, view_count: 15_000, taken_at: "2026-07-07T09:00:00.000Z" },
    ],
    now,
  );
  const shrinking = computeGrowthMetrics(
    [
      { subscriber_count: 1_000, view_count: 10_000, taken_at: "2026-06-07T09:00:00.000Z" },
      { subscriber_count: 950, view_count: 9_900, taken_at: "2026-07-07T09:00:00.000Z" },
    ],
    now,
  );

  assert.equal(flat.subs_growth_30d, 0);
  assert.equal(Math.round(growing.subs_growth_30d ?? 0), 30);
  assert.equal(Math.round(growing.subs_growth_7d ?? 0), 18);
  assert.equal(growing.subs_growth_7d_days, 7);
  assert.equal(Math.round(growing.views_growth_30d ?? 0), 50);
  assert.equal(growing.views_growth_30d_days, 30);
  assert.equal(shrinking.subs_growth_30d, -5);
  assert.equal(isMover(growing), true);
  assert.equal(isMover(flat), false);
});

test("growth metrics use nearest sparse snapshot to the requested horizon", () => {
  const metrics = computeGrowthMetrics(
    [
      { subscriber_count: 2_000, view_count: 10_000, taken_at: "2026-06-05T09:00:00.000Z" },
      { subscriber_count: 2_400, view_count: 12_000, taken_at: "2026-07-07T09:00:00.000Z" },
    ],
    now,
  );

  assert.equal(metrics.tracking_days, 32);
  assert.equal(metrics.subs_growth_30d, 20);
  assert.equal(metrics.subs_growth_30d_days, 30);
});

test("growth metrics expose the honest span when history is shorter than a window", () => {
  const metrics = computeGrowthMetrics(
    [
      { subscriber_count: 1_000, view_count: 10_000, taken_at: "2026-07-01T09:00:00.000Z" },
      { subscriber_count: 1_009, view_count: 10_200, taken_at: "2026-07-07T09:00:00.000Z" },
    ],
    now,
  );

  assert.equal(metrics.tracking_days, 6);
  assert.equal(metrics.subs_growth_7d_days, 6);
  assert.equal(metrics.subs_growth_30d_days, 6);
  assert.equal(metrics.views_growth_30d_days, 6);
  assert.ok(Math.abs((metrics.subs_growth_30d ?? 0) - 0.9) < 0.001);
});
