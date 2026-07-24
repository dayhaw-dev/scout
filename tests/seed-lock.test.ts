import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";

import type { Env } from "../src/lib/scrapecreators.js";
import {
  hasExplicitEmptySeedTargets,
  MIN_SEED_QUERY_VIDEOS,
} from "../src/lib/seed-targets.js";

const LOCKED_CHANNEL_ID = "UCn5fhcGRrCvrmFibPbT6q1A";
const ADMIN_KEY = "seed-lock-test-key";
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (/^\.{1,2}\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)) {
        return nextResolve(`${specifier}.js`, context);
      }
      throw error;
    }
  },
});
const workerPromise = import("../src/index.js").then((module) => module.default);

test("seed locking migration is additive and locks the two verified channel IDs", () => {
  const migration = readFileSync("migrations/0021_seed_locking.sql", "utf8");

  assert.match(migration, /ALTER TABLE channels ADD COLUMN seed_locked INTEGER NOT NULL DEFAULT 0/);
  assert.match(migration, /CHECK \(seed_locked IN \(0, 1\)\)/);
  assert.match(migration, /UCn5fhcGRrCvrmFibPbT6q1A/);
  assert.match(migration, /UCyEA3vUnlpg0xzkECEq1rOA/);
  assert.doesNotMatch(migration, /CREATE TABLE\s+channels/i);
  assert.doesNotMatch(migration, /DROP TABLE\s+channels/i);
  assert.doesNotMatch(migration, /ALTER TABLE\s+channels\s+RENAME/i);
});

test("seed lock reasons are additive and make demo reserves authoritative", () => {
  const migration = readFileSync("migrations/0024_seed_lock_reasons.sql", "utf8");

  assert.match(migration, /ALTER TABLE channels ADD COLUMN seed_lock_reason TEXT/);
  assert.match(migration, /DEMO FENCE/);
  assert.match(migration, /DEMO RESERVE/);
  assert.match(migration, /UCGEDbg1EKT7HCqbT7OAsLKA/);
  assert.match(migration, /UCpnuadQ_w3r6f4Q_NRlqd-w/);
  assert.doesNotMatch(migration, /CREATE TABLE\s+channels/i);
  assert.doesNotMatch(migration, /DROP TABLE\s+channels/i);
  assert.doesNotMatch(migration, /ALTER TABLE\s+channels\s+RENAME/i);
});

test("empty explicit seed target arrays mean no targets, never all seeds", () => {
  assert.equal(hasExplicitEmptySeedTargets([]), true);
  assert.equal(hasExplicitEmptySeedTargets(undefined), false);
  assert.equal(hasExplicitEmptySeedTargets([LOCKED_CHANNEL_ID]), false);
  assert.equal(MIN_SEED_QUERY_VIDEOS, 5);
});

test("direct API calls cannot expand, regenerate, unseed, or patch a locked seed", async () => {
  const worker = await workerPromise;
  const state = createFakeD1State({
    lockedSeed: {
      channel_id: LOCKED_CHANNEL_ID,
      title: "Brian Lagerstrom",
      handle: "BrianLagerstrom",
      is_seed: 1,
      seed_locked: 1,
    },
  });
  const env = testEnv(state.db);
  const originalFetch = globalThis.fetch;
  let outboundFetches = 0;
  globalThis.fetch = async () => {
    outboundFetches += 1;
    throw new Error("Locked seed attempted an outbound request.");
  };

  try {
    const requests = [
      apiRequest(`/api/seeds/${LOCKED_CHANNEL_ID}/expand`, "POST", { maxPages: 1, maxResolves: 1 }),
      apiRequest("/api/admin/mine-queries", "POST", { channel_id: LOCKED_CHANNEL_ID, force: true }),
      apiRequest(`/api/channels/${LOCKED_CHANNEL_ID}`, "PATCH", { is_seed: false }),
      apiRequest(`/api/channels/${LOCKED_CHANNEL_ID}`, "PATCH", { status: "rejected" }),
      apiRequest(`/api/channels/${LOCKED_CHANNEL_ID}/active`, "PATCH", { is_active: true }),
      apiRequest(`/api/channels/${LOCKED_CHANNEL_ID}/outreach`, "POST", {
        outreach_status: "sent",
        note: "must not mutate",
        next_followup_at: null,
      }),
    ];

    for (const request of requests) {
      const response = await worker.fetch(request, env);
      assert.equal(response.status, 423);
      assert.deepEqual(await response.json(), {
        error: "Seed is locked and cannot be modified.",
      });
    }
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(outboundFetches, 0);
  assert.deepEqual(state.seedMutations, []);
});

test("locked seeds can refresh read-only RSS freshness without unlocking", async () => {
  const worker = await workerPromise;
  const state = createFakeD1State({
    lockedSeed: {
      channel_id: LOCKED_CHANNEL_ID,
      title: "Brian Lagerstrom",
      handle: "BrianLagerstrom",
      is_seed: 1,
      seed_locked: 1,
    },
  });
  const originalFetch = globalThis.fetch;
  let outboundFetches = 0;
  globalThis.fetch = async (input, init) => {
    outboundFetches += 1;
    if (String(input).includes("/feeds/videos.xml")) {
      return new Response(`
        <feed xmlns:yt="http://www.youtube.com/xml/schemas/2015">
          <entry>
            <yt:videoId>new-upload</yt:videoId>
            <title>New upload</title>
            <published>2026-07-17T12:00:00Z</published>
          </entry>
        </feed>
      `);
    }
    assert.match(String(input), /youtube\.com\/shorts\/new-upload/);
    assert.equal(init?.method, "HEAD");
    assert.equal(init?.redirect, "manual");
    return new Response(null, { status: 200 });
  };

  try {
    const response = await worker.fetch(
      apiRequest(`/api/seeds/${LOCKED_CHANNEL_ID}/freshness`, "POST", { force: true }),
      testEnv(state.db),
    );
    assert.equal(response.status, 200);
    const body = await response.json() as { never_mined: boolean; unmined_count: number | null; status: string };
    assert.deepEqual(body, {
      ...body,
      never_mined: true,
      unmined_count: null,
      status: "ok",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(outboundFetches, 2);
  assert.equal(state.freshnessMutations.length, 1);
  assert.equal(state.rssRows.length, 1);
  assert.equal(state.rssRows[0]?.is_short, 1);
  assert.deepEqual(state.seedMutations, []);
});

test("failed forced freshness preserves the last good row and marks it stale", async () => {
  const worker = await workerPromise;
  const priorGood = {
    channel_id: LOCKED_CHANNEL_ID,
    latest_upload_at: "2026-07-16T12:00:00Z",
    newest_stored_video_at: null,
    stored_video_count: 0,
    unmined_count: null,
    unmined_is_lower_bound: 0,
    never_mined: 1,
    rss_entry_count: 15,
    status: "ok",
    error: null,
    checked_at: "2026-07-16T12:05:00Z",
  };
  const state = createFakeD1State({
    lockedSeed: {
      channel_id: LOCKED_CHANNEL_ID,
      title: "Brian Lagerstrom",
      handle: "BrianLagerstrom",
      is_seed: 1,
      seed_locked: 1,
    },
    freshnessRow: priorGood,
  });
  const originalFetch = globalThis.fetch;
  let outboundFetches = 0;
  globalThis.fetch = async () => {
    outboundFetches += 1;
    return new Response("YouTube unavailable", { status: 500 });
  };

  try {
    const response = await worker.fetch(
      apiRequest(`/api/seeds/${LOCKED_CHANNEL_ID}/freshness`, "POST", { force: true }),
      testEnv(state.db),
    );
    assert.equal(response.status, 200);
    const body = await response.json() as {
      latest_upload_at: string | null;
      status: string;
      error: string | null;
      stale: boolean;
      checked_at: string;
    };
    assert.equal(body.latest_upload_at, priorGood.latest_upload_at);
    assert.equal(body.status, "ok");
    assert.match(body.error ?? "", /failed with 500/);
    assert.equal(body.stale, true);
    assert.equal(body.checked_at, priorGood.checked_at);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(outboundFetches, 3);
  assert.equal(state.freshnessMutations.length, 1);
  assert.match(state.freshnessMutations[0], /UPDATE seed_mining_freshness/);
  assert.doesNotMatch(state.freshnessMutations[0], /INSERT INTO seed_mining_freshness/);
});

test("failed freshness without a good row is not cached", async () => {
  const worker = await workerPromise;
  const state = createFakeD1State({
    lockedSeed: {
      channel_id: LOCKED_CHANNEL_ID,
      title: "Brian Lagerstrom",
      handle: "BrianLagerstrom",
      is_seed: 1,
      seed_locked: 1,
    },
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("YouTube unavailable", { status: 404 });

  try {
    const response = await worker.fetch(
      apiRequest(`/api/seeds/${LOCKED_CHANNEL_ID}/freshness`, "POST", { force: true }),
      testEnv(state.db),
    );
    const body = await response.json() as { status: string; stale: boolean };
    assert.equal(body.status, "error");
    assert.equal(body.stale, true);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(state.freshnessMutations, []);
});

test("global regen with an empty server target set performs no seed computation", async () => {
  const worker = await workerPromise;
  const state = createFakeD1State({ operationTargets: [] });
  const response = await worker.fetch(
    apiRequest("/api/admin/mine-queries", "POST", { force: true }),
    testEnv(state.db),
  );

  assert.equal(response.status, 200);
  const body = await response.json() as { seeds_considered: number; phrases_written: number; topics_written: number };
  assert.deepEqual(body, {
    ...body,
    seeds_considered: 0,
    phrases_written: 0,
    topics_written: 0,
  });
  assert.equal(state.operationTargetReads, 1);
  assert.deepEqual(state.seedMutations, []);
});

function apiRequest(
  path: string,
  method: "POST" | "PATCH",
  body: Record<string, unknown>,
): Request {
  return new Request(`https://scout.test${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-scout-key": ADMIN_KEY,
      "cf-connecting-ip": "203.0.113.10",
    },
    body: JSON.stringify(body),
  });
}

function testEnv(db: D1Database): Env {
  return {
    SCOUT_DB: db,
    SCOUT_ADMIN_KEY: ADMIN_KEY,
    SCRAPECREATORS_API_KEY: "must-not-be-used",
    ANTHROPIC_API_KEY: "must-not-be-used",
  };
}

interface FakeSeedRow {
  channel_id: string;
  title: string | null;
  handle: string | null;
  is_seed: number;
  seed_locked: number;
}

interface FakeRssRow {
  channel_id: string;
  video_id: string;
  title: string | null;
  published_at: string | null;
  feed_position: number;
  is_short: 0 | 1 | null;
  classification_attempted_at: string | null;
  classified_at: string | null;
  classification_error: string | null;
  first_seen_at: string;
  last_seen_at: string;
}

interface FakeState {
  db: D1Database;
  seedMutations: string[];
  freshnessMutations: string[];
  rssRows: FakeRssRow[];
  operationTargetReads: number;
}

function createFakeD1State({
  lockedSeed = null,
  operationTargets = [],
  freshnessRow = null,
}: {
  lockedSeed?: FakeSeedRow | null;
  operationTargets?: FakeSeedRow[];
  freshnessRow?: Record<string, unknown> | null;
}): FakeState {
  const seedMutations: string[] = [];
  const freshnessMutations: string[] = [];
  const rssRows: FakeRssRow[] = [];
  let operationTargetReads = 0;

  class FakeStatement {
    private bindings: unknown[] = [];

    constructor(private readonly query: string) {}

    bind(...values: unknown[]): D1PreparedStatement {
      this.bindings = values;
      return this as D1PreparedStatement;
    }

    async first<T = Record<string, unknown>>(_columnName?: string): Promise<T | null> {
      if (this.query.includes("FROM auth_failures")) return null;
      if (this.query.includes("COUNT(*) AS stored_video_count")) {
        return {
          stored_video_count: 0,
          newest_stored_video_at: null,
        } as T;
      }
      if (this.query.includes("FROM seed_mining_freshness")) return freshnessRow as T | null;
      if (this.query.includes("FROM channels WHERE channel_id = ?")) {
        assert.equal(this.bindings[0], LOCKED_CHANNEL_ID);
        return lockedSeed as T | null;
      }
      throw new Error(`Unexpected first() query: ${this.query}`);
    }

    async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
      if (this.query.startsWith("DELETE FROM auth_failures")) return d1Result<T>([]);
      if (this.query.includes("INSERT INTO seed_rss_entries")) {
        const [
          channelId,
          videoId,
          title,
          publishedAt,
          feedPosition,
          firstSeenAt,
          lastSeenAt,
        ] = this.bindings as [string, string, string | null, string | null, number, string, string];
        const existing = rssRows.find(
          (row) => row.channel_id === channelId && row.video_id === videoId,
        );
        if (existing) {
          existing.title = title;
          existing.published_at = publishedAt;
          existing.feed_position = feedPosition;
          existing.last_seen_at = lastSeenAt;
        } else {
          rssRows.push({
            channel_id: channelId,
            video_id: videoId,
            title,
            published_at: publishedAt,
            feed_position: feedPosition,
            is_short: null,
            classification_attempted_at: null,
            classified_at: null,
            classification_error: null,
            first_seen_at: firstSeenAt,
            last_seen_at: lastSeenAt,
          });
        }
        return d1Result<T>([]);
      }
      if (this.query.includes("UPDATE seed_rss_entries")) {
        const [
          isShort,
          attemptedAt,
          classifiedAt,
          classificationError,
          channelId,
          videoId,
          lastSeenAt,
        ] = this.bindings as [
          0 | 1 | null,
          string,
          string | null,
          string | null,
          string,
          string,
          string,
        ];
        const existing = rssRows.find(
          (row) => row.channel_id === channelId
            && row.video_id === videoId
            && row.last_seen_at === lastSeenAt
            && row.is_short === null,
        );
        if (existing) {
          existing.is_short = isShort;
          existing.classification_attempted_at = attemptedAt;
          existing.classified_at = classifiedAt;
          existing.classification_error = classificationError;
        }
        return d1Result<T>([]);
      }
      if (
        this.query.includes("INSERT INTO seed_mining_freshness")
        || this.query.includes("UPDATE seed_mining_freshness")
        || this.query.includes("DELETE FROM seed_mining_freshness")
      ) {
        freshnessMutations.push(this.query);
        return d1Result<T>([]);
      }
      seedMutations.push(this.query);
      throw new Error(`Unexpected seed mutation: ${this.query}`);
    }

    async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
      if (this.query.includes("FROM seed_rss_entries")) {
        const [channelId, lastSeenAt] = this.bindings as [string, string];
        return d1Result(
          rssRows.filter(
            (row) => row.channel_id === channelId && row.last_seen_at === lastSeenAt,
          ) as T[],
        );
      }
      if (this.query.includes("SELECT video_id, published_at") && this.query.includes("FROM videos")) {
        return d1Result<T>([]);
      }
      if (this.query.includes("COUNT(v.video_id) AS stored_video_count")) {
        operationTargetReads += 1;
        return d1Result(operationTargets.map((target) => ({
          ...target,
          stored_video_count: 0,
        })) as T[]);
      }
      throw new Error(`Unexpected all() query: ${this.query}`);
    }

    raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
    raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
    async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[] | [string[], ...T[]]> {
      return options?.columnNames ? [[]] : [];
    }
  }

  const db: D1Database = {
    prepare(query: string): D1PreparedStatement {
      return new FakeStatement(query) as D1PreparedStatement;
    },
    async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      return await Promise.all(statements.map((statement) => statement.run<T>()));
    },
    async exec(): Promise<D1ExecResult> {
      throw new Error("Unexpected exec().");
    },
    withSession(): D1DatabaseSession {
      throw new Error("Unexpected withSession().");
    },
    async dump(): Promise<ArrayBuffer> {
      throw new Error("Unexpected dump().");
    },
  };

  return {
    db,
    seedMutations,
    freshnessMutations,
    rssRows,
    get operationTargetReads() {
      return operationTargetReads;
    },
  };
}

function d1Result<T>(results: T[]): D1Result<T> {
  return {
    success: true,
    results,
    meta: {
      duration: 0,
      size_after: 0,
      rows_read: 0,
      rows_written: 0,
      last_row_id: 0,
      changed_db: false,
      changes: 0,
    },
  };
}
