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

interface FakeState {
  db: D1Database;
  seedMutations: string[];
  operationTargetReads: number;
}

function createFakeD1State({
  lockedSeed = null,
  operationTargets = [],
}: {
  lockedSeed?: FakeSeedRow | null;
  operationTargets?: FakeSeedRow[];
}): FakeState {
  const seedMutations: string[] = [];
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
      if (this.query.includes("FROM channels WHERE channel_id = ?")) {
        assert.equal(this.bindings[0], LOCKED_CHANNEL_ID);
        return lockedSeed as T | null;
      }
      throw new Error(`Unexpected first() query: ${this.query}`);
    }

    async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
      if (this.query.startsWith("DELETE FROM auth_failures")) return d1Result<T>([]);
      seedMutations.push(this.query);
      throw new Error(`Unexpected seed mutation: ${this.query}`);
    }

    async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
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
    async batch<T = unknown>(): Promise<D1Result<T>[]> {
      throw new Error("Unexpected batch().");
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
