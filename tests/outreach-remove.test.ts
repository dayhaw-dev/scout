import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";

import type { Env } from "../src/lib/scrapecreators.js";

const ADMIN_KEY = "remove-outreach-test-key";
const CHANNEL_ID = "UCRtsZ5Iak9wSLsQLQ3XOAeA";
const NOTE = "Removed from Outreach — existing roster talent.";

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

test("Remove from Outreach requires both explicit confirmation and a note", async () => {
  const worker = await workerPromise;
  for (const body of [
    { confirmed: false, note: NOTE },
    { confirmed: true, note: "   " },
  ]) {
    const state = fakeRemoveD1();
    const response = await worker.fetch(apiRequest(body), testEnv(state.db));
    assert.equal(response.status, 400);
    assert.equal(state.batchCalls, 0);
  }
});

test("Remove from Outreach atomically clears routing, records history, and dismisses watcher state", async () => {
  const worker = await workerPromise;
  const state = fakeRemoveD1();
  const before = { ...state.channel };
  const response = await worker.fetch(
    apiRequest({ confirmed: true, note: NOTE }),
    testEnv(state.db),
  );

  assert.equal(response.status, 200);
  const body = await response.json() as {
    sponsor_watchers_deactivated: number;
    trigger_events_dismissed: number;
  };
  assert.equal(body.sponsor_watchers_deactivated, 1);
  assert.equal(body.trigger_events_dismissed, 1);
  assert.equal(state.batchCalls, 1, "all four mutations use one D1 batch transaction");
  assert.equal(state.batchStatementCount, 4);

  assert.equal(state.channel.outreach_stage, "none");
  assert.equal(state.channel.is_active, 0);
  assert.equal(state.channel.close_disposition, null);
  assert.equal(state.channel.next_followup_at, null);
  assert.equal(state.channel.is_seed, before.is_seed);
  assert.equal(state.channel.status, before.status);
  assert.equal(state.channel.subscriber_count, before.subscriber_count);

  assert.deepEqual(state.logs[0], {
    id: 1,
    channel_id: CHANNEL_ID,
    note: NOTE,
    event_type: "stage_changed",
    from_stage: "replied",
    to_stage: "none",
    close_disposition: null,
  });
  assert.equal(state.watcher.active, 0);
  assert.ok(state.watcher.deactivated_at);
  assert.ok(state.trigger.resolved_at);
  assert.match(state.trigger.resolution ?? "", /^dismissed — Removed from Outreach/);
});

test("shared Outreach cards expose the confirmed removal dialog in every section", () => {
  const app = readFileSync("ui/src/App.tsx", "utf8");
  const api = readFileSync("ui/src/api.ts", "utf8");
  const worker = readFileSync("src/index.ts", "utf8");

  assert.equal((app.match(/onRemoveFromOutreach=\{/g) ?? []).length, 3);
  assert.match(app, /label: "Remove from Outreach"/);
  assert.match(app, /<span>Required note<\/span>[\s\S]*?<textarea[\s\S]*?required/);
  assert.match(app, /<strong>Confirm removal from Outreach<\/strong>/);
  assert.match(app, /!note\.trim\(\) \|\| !confirmed \|\| busy/);
  assert.match(app, /Any active sponsor watcher will stop, and any unresolved trigger will be dismissed with this note/);
  assert.match(api, /\/outreach\/remove/);
  assert.match(worker, /await env\.SCOUT_DB\.batch\(\[[\s\S]*outreach_stage = 'none'[\s\S]*is_active = 0[\s\S]*event_type[\s\S]*deactivated_at[\s\S]*resolved_at/);
  assert.match(worker, /async function setChannelActive[\s\S]*UPDATE channels SET is_active = \?/);
});

function apiRequest(body: Record<string, unknown>): Request {
  return new Request(`https://scout.test/api/channels/${CHANNEL_ID}/outreach/remove`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-scout-key": ADMIN_KEY,
      "cf-connecting-ip": "203.0.113.30",
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

function fakeRemoveD1() {
  const channel: Record<string, unknown> & {
    outreach_stage: string;
    is_active: number;
    close_disposition: string | null;
    next_followup_at: string | null;
    is_seed: number;
    status: string;
    subscriber_count: number;
  } = {
    channel_id: CHANNEL_ID,
    handle: "SciManDan",
    title: "SciManDan",
    outreach_stage: "replied",
    outreach_status: "none",
    is_active: 1,
    close_disposition: "no_reply",
    next_followup_at: "2026-08-01T00:00:00Z",
    is_seed: 1,
    seed_locked: 0,
    status: "candidate",
    subscriber_count: 670000,
  };
  const logs: Array<Record<string, unknown>> = [];
  const watcher = { id: 7, channel_id: CHANNEL_ID, active: 1, deactivated_at: null as string | null };
  const trigger = { watcher_id: 7, resolved_at: null as string | null, resolution: null as string | null };
  let batchCalls = 0;
  let batchStatementCount = 0;

  class FakeStatement {
    private bindings: unknown[] = [];

    constructor(private readonly query: string) {}

    bind(...values: unknown[]): D1PreparedStatement {
      this.bindings = values;
      return this as D1PreparedStatement;
    }

    async first<T = Record<string, unknown>>(): Promise<T | null> {
      if (this.query.includes("FROM auth_failures")) return null;
      if (this.query.includes("FROM channels WHERE channel_id = ?")) {
        return this.bindings[0] === CHANNEL_ID ? channel as T : null;
      }
      throw new Error(`Unexpected first() query: ${this.query}`);
    }

    async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
      if (this.query.startsWith("DELETE FROM auth_failures")) return d1Result<T>([], 0);
      if (this.query.includes("UPDATE channels") && this.query.includes("outreach_stage = 'none'")) {
        channel.outreach_stage = "none";
        channel.is_active = 0;
        channel.close_disposition = null;
        channel.next_followup_at = null;
        return d1Result<T>([], 1);
      }
      if (this.query.includes("INSERT INTO outreach_log")) {
        logs.push({
          id: 1,
          channel_id: this.bindings[0],
          note: this.bindings[1],
          event_type: this.bindings[2],
          from_stage: this.bindings[3],
          to_stage: "none",
          close_disposition: null,
        });
        return d1Result<T>([], 1);
      }
      if (this.query.includes("UPDATE outreach_watchers")) {
        watcher.active = 0;
        watcher.deactivated_at = String(this.bindings[0]);
        return d1Result<T>([], 1);
      }
      if (this.query.includes("UPDATE outreach_trigger_events")) {
        trigger.resolved_at = String(this.bindings[0]);
        trigger.resolution = String(this.bindings[1]);
        return d1Result<T>([], 1);
      }
      throw new Error(`Unexpected run() query: ${this.query}`);
    }

    async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
      if (this.query.includes("FROM outreach_log")) return d1Result(logs as T[], 0);
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
      batchCalls += 1;
      batchStatementCount = statements.length;
      const results: D1Result<T>[] = [];
      for (const statement of statements) results.push(await statement.run<T>());
      return results;
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
    channel,
    logs,
    watcher,
    trigger,
    get batchCalls() { return batchCalls; },
    get batchStatementCount() { return batchStatementCount; },
  };
}

function d1Result<T>(results: T[], changes: number): D1Result<T> {
  return {
    success: true,
    results,
    meta: {
      duration: 0,
      size_after: 0,
      rows_read: 0,
      rows_written: changes,
      last_row_id: 0,
      changed_db: changes > 0,
      changes,
    },
  };
}
