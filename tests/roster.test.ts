import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";

import type { Env } from "../src/lib/scrapecreators.js";
import {
  normalizeRosterInput,
  RosterInputError,
} from "../src/lib/roster.js";

const ADMIN_KEY = "roster-test-key";
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

test("roster input accepts channel URLs and @handles but rejects non-channel inputs", () => {
  assert.deepEqual(normalizeRosterInput("@AdamRagusea"), {
    kind: "handle",
    value: "adamragusea",
    resolveInput: "@AdamRagusea",
  });
  assert.deepEqual(normalizeRosterInput("https://www.youtube.com/@AdamRagusea?sub_confirmation=1"), {
    kind: "handle",
    value: "adamragusea",
    resolveInput: "@AdamRagusea",
  });
  assert.deepEqual(normalizeRosterInput("https://youtube.com/channel/UC9_p50tH3WmMslWRWKnM7dQ"), {
    kind: "channel_id",
    value: "UC9_p50tH3WmMslWRWKnM7dQ",
    resolveInput: "UC9_p50tH3WmMslWRWKnM7dQ",
  });
  assert.deepEqual(normalizeRosterInput("https://youtube.com/c/ExampleCreator"), {
    kind: "url",
    value: "https://www.youtube.com/c/ExampleCreator",
    resolveInput: "https://www.youtube.com/c/ExampleCreator",
  });

  for (const input of [
    "AdamRagusea",
    "https://example.com/@AdamRagusea",
    "https://youtube.com/watch?v=abc123",
    "https://youtube.com/shorts/abc123",
  ]) {
    assert.throws(() => normalizeRosterInput(input), RosterInputError, input);
  }
});

test("roster preflight never spends before confirmation", async () => {
  const worker = await workerPromise;
  const state = fakeRosterD1(null);
  const originalFetch = globalThis.fetch;
  let outboundFetches = 0;
  globalThis.fetch = async () => {
    outboundFetches += 1;
    throw new Error("Preflight attempted a paid lookup.");
  };

  try {
    const response = await worker.fetch(
      apiRequest("/api/outreach/roster", "POST", { input: "@NotStored" }),
      testEnv(state.db),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      outcome: "confirmation_required",
      input: "@NotStored",
      expected_credits: 1,
      max_credits: 2,
      message: "This channel is not in SCOUT. Confirm before using ScrapeCreators channel lookup.",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(outboundFetches, 0);
  assert.equal(state.mutations.length, 0);
});

test("existing roster adds activate in place for zero credits", async () => {
  const worker = await workerPromise;
  const channel = fakeChannel();
  const state = fakeRosterD1(channel);
  const originalFetch = globalThis.fetch;
  let outboundFetches = 0;
  globalThis.fetch = async () => {
    outboundFetches += 1;
    throw new Error("Existing channel attempted a paid lookup.");
  };

  try {
    const response = await worker.fetch(
      apiRequest("/api/outreach/roster", "POST", { input: "@ExistingCreator" }),
      testEnv(state.db),
    );
    assert.equal(response.status, 200);
    const body = await response.json() as {
      outcome: string;
      credits_spent: number;
      channel: { channel_id: string; is_active: boolean };
    };
    assert.equal(body.outcome, "activated_existing");
    assert.equal(body.credits_spent, 0);
    assert.equal(body.channel.channel_id, channel.channel_id);
    assert.equal(body.channel.is_active, true);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(outboundFetches, 0);
  assert.equal(state.mutations.length, 1);
});

test("generic channel PATCH cannot bypass Outreach-scoped active controls", async () => {
  const worker = await workerPromise;
  const state = fakeRosterD1(fakeChannel());
  const response = await worker.fetch(
    apiRequest(`/api/channels/${fakeChannel().channel_id}`, "PATCH", { is_active: true }),
    testEnv(state.db),
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Active status can only be changed through the Outreach roster controls.",
  });
  assert.equal(state.mutations.length, 0);
});

test("dedicated active mutation is limited to Outreach rows", async () => {
  const worker = await workerPromise;
  const pipelineState = fakeRosterD1(fakeChannel());
  const blocked = await worker.fetch(
    apiRequest(`/api/channels/${fakeChannel().channel_id}/active`, "PATCH", { is_active: true }),
    testEnv(pipelineState.db),
  );
  assert.equal(blocked.status, 409);
  assert.deepEqual(await blocked.json(), {
    error: "Use Add to roster for channels that do not have an outreach status.",
  });
  assert.equal(pipelineState.mutations.length, 0);

  const outreachChannel = fakeChannel();
  outreachChannel.outreach_stage = "pitched";
  const outreachState = fakeRosterD1(outreachChannel);
  const activated = await worker.fetch(
    apiRequest(`/api/channels/${outreachChannel.channel_id}/active`, "PATCH", { is_active: true }),
    testEnv(outreachState.db),
  );
  assert.equal(activated.status, 200);
  const body = await activated.json() as { is_active: boolean };
  assert.equal(body.is_active, true);
  assert.equal(outreachState.mutations.length, 1);
});

test("UI exposes active controls only through Outreach and keeps badges everywhere", () => {
  const source = readFileSync("ui/src/App.tsx", "utf8");
  const activeProps = source.match(/onToggleActive=\{/g) ?? [];

  assert.equal(activeProps.length, 3, "only ACTIVE, LIVE, and CLOSED Outreach card lists pass the control");
  assert.match(source, /if \(onToggleActive && tab === "outreach"\)/);
  assert.doesNotMatch(source, /toggleSeedActive/);
  assert.doesNotMatch(source, /onToggleActive=\{stage/);
  assert.match(source, /seed\.is_active && <span className="chip active-relationship-chip">ACTIVE<\/span>/);
  assert.match(source, /channel\.is_active && <span className="chip active-relationship-chip">ACTIVE<\/span>/);
  assert.match(source, /brand\.is_active && <span className="chip active-relationship-chip">ACTIVE<\/span>/);
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
      "cf-connecting-ip": "203.0.113.20",
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

function fakeChannel(): Record<string, unknown> & {
  channel_id: string;
  handle: string;
  is_active: number;
} {
  return {
    channel_id: "UC9_p50tH3WmMslWRWKnM7dQ",
    handle: "ExistingCreator",
    title: "Existing Creator",
    is_active: 0,
    is_seed: 0,
    seed_locked: 0,
    outreach_stage: "none",
    status: "candidate",
    kind: "creator",
    email_confirmed: 0,
  };
}

function fakeRosterD1(initialChannel: ReturnType<typeof fakeChannel> | null): {
  db: D1Database;
  mutations: string[];
} {
  let channel = initialChannel ? { ...initialChannel } : null;
  const mutations: string[] = [];

  class FakeStatement {
    private bindings: unknown[] = [];

    constructor(private readonly query: string) {}

    bind(...values: unknown[]): D1PreparedStatement {
      this.bindings = values;
      return this as D1PreparedStatement;
    }

    async first<T = Record<string, unknown>>(): Promise<T | null> {
      if (this.query.includes("FROM auth_failures")) return null;
      if (this.query.includes("LOWER(CASE WHEN SUBSTR(handle")) {
        const wanted = String(this.bindings[0]);
        return channel && channel.handle.toLowerCase() === wanted ? channel as T : null;
      }
      if (this.query.includes("FROM channels WHERE channel_id = ?")) {
        return channel && channel.channel_id === this.bindings[0] ? channel as T : null;
      }
      throw new Error(`Unexpected first() query: ${this.query}`);
    }

    async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
      if (this.query.startsWith("DELETE FROM auth_failures")) return d1Result<T>([]);
      if (this.query.includes("UPDATE channels SET is_active =")) {
        mutations.push(this.query);
        if (channel) {
          const isActive = this.query.includes("SET is_active = 1")
            ? 1
            : Number(this.bindings[0]);
          channel = { ...channel, is_active: isActive };
        }
        return d1Result<T>([]);
      }
      throw new Error(`Unexpected run() query: ${this.query}`);
    }

    async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
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

  return { db, mutations };
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
