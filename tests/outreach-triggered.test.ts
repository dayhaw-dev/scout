import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";

import type { Env } from "../src/lib/scrapecreators.js";
import {
  SPONSOR_APPEARED_LABEL,
  SPONSOR_CONFIRMED_COPY,
  SPONSOR_TRIGGER_CARD_NOTE,
  WATCHING_FOR_SPONSOR_LABEL,
  sponsorWatcherStateLabel,
} from "../ui/src/outreach-trigger-presentation.js";

const ADMIN_KEY = "triggered-outreach-test-key";
const CHANNEL_ID = "UC-triggered-fixture";

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

test("triggered outreach vocabulary stays honest and non-ready watchers are explicit", () => {
  const app = readFileSync("ui/src/App.tsx", "utf8");
  assert.equal(SPONSOR_APPEARED_LABEL, "SPONSOR APPEARED");
  assert.equal(
    SPONSOR_CONFIRMED_COPY,
    "SPONSOR CONFIRMED — SponsorBlock has a community-submitted sponsor segment for this upload. Advertiser identity is unknown.",
  );
  assert.equal(
    SPONSOR_TRIGGER_CARD_NOTE,
    "Detected on a video published after this watch began. Brand identity is not available from SponsorBlock.",
  );
  assert.equal(WATCHING_FOR_SPONSOR_LABEL, "WATCHING FOR SPONSOR");
  assert.equal(sponsorWatcherStateLabel("ready"), "WATCHING FOR SPONSOR");
  assert.equal(sponsorWatcherStateLabel("pending"), "WATCHER PENDING · NOT ARMED");
  assert.equal(sponsorWatcherStateLabel("error"), "WATCHER ERROR · NOT ARMED");
  assert.match(app, /SPONSOR_CONFIRMED_COPY/);
  assert.match(app, /SPONSOR_TRIGGER_CARD_NOTE/);
  assert.match(app, /sponsorWatcherStateLabel\(channel\.sponsor_watcher\.baseline_state\)/);
  assert.doesNotMatch(SPONSOR_CONFIRMED_COPY + SPONSOR_TRIGGER_CARD_NOTE, /not sponsored|brand name|sponsor category/i);
});

test("TRIGGERED is conditional, pinned before ACTIVE, and unresolved channels are removed from CLOSED", () => {
  const app = readFileSync("ui/src/App.tsx", "utf8");
  const worker = readFileSync("src/index.ts", "utf8");
  const triggeredIndex = app.indexOf("triggered.length > 0");
  const activeIndex = app.indexOf("Active / working with");
  assert.ok(triggeredIndex >= 0 && activeIndex > triggeredIndex);
  assert.match(app, /<strong>Triggered<\/strong>/);
  assert.match(worker, /WHERE ote\.resolved_at IS NULL/);
  assert.match(worker, /const triggered = \[\.\.\.workingCandidates, \.\.\.liveCandidates, \.\.\.closedCandidates\][\s\S]*?triggerByChannel\.has\(row\.channel_id\)/);
  assert.match(worker, /const working = workingCandidates\.filter\(\(row\) => !triggerByChannel\.has\(row\.channel_id\)\)/);
  assert.match(worker, /const live = liveCandidates\.filter\(\(row\) => !triggerByChannel\.has\(row\.channel_id\)\)/);
  assert.match(worker, /const closed = closedCandidates\.filter\(\(row\) => !triggerByChannel\.has\(row\.channel_id\)\)/);
});

test("trigger actions cannot submit without explicit confirmation", async () => {
  const worker = await workerPromise;
  for (const [path, body] of [
    ["reopen", { confirmed: false, outreach_status: "sent", note: "Reply now", next_followup_at: null }],
    ["dismiss", { confirmed: false }],
  ] as const) {
    const state = fakeTriggerD1();
    const response = await worker.fetch(apiRequest(path, body), testEnv(state.db));
    assert.equal(response.status, 400);
    assert.equal(state.batchCalls, 0);
  }
});

test("re-open atomically resolves the event, moves the funnel, stops the watcher, and logs reopened", async () => {
  const worker = await workerPromise;
  const state = fakeTriggerD1();
  const response = await worker.fetch(apiRequest("reopen", {
    confirmed: true,
    outreach_status: "replied",
    note: "Sponsor signal makes this worth another conversation.",
    next_followup_at: "2026-08-05",
  }), testEnv(state.db));
  assert.equal(response.status, 200);
  assert.equal(state.batchCalls, 1);
  assert.equal(state.batchStatementCount, 4);
  assert.equal(state.channel.outreach_stage, "replied");
  assert.equal(state.channel.close_disposition, null);
  assert.equal(state.channel.next_followup_at, "2026-08-05");
  assert.equal(state.event.resolution, "reopened");
  assert.ok(state.event.resolved_at);
  assert.equal(state.watcher.active, 0);
  assert.ok(state.watcher.deactivated_at);
  assert.deepEqual(state.logs[0], {
    event_type: "reopened",
    from_stage: "passed",
    to_stage: "replied",
    close_disposition: null,
    note: "Sponsor signal makes this worth another conversation.",
  });
});

test("dismiss resolves and logs the event while leaving PASSED and resuming its watcher", async () => {
  const worker = await workerPromise;
  const state = fakeTriggerD1();
  state.watcher.active = 0;
  state.watcher.deactivated_at = "2026-07-30T00:00:00.000Z";
  const response = await worker.fetch(apiRequest("dismiss", { confirmed: true }), testEnv(state.db));
  assert.equal(response.status, 200);
  assert.equal(state.batchCalls, 1);
  assert.equal(state.batchStatementCount, 3);
  assert.equal(state.channel.outreach_stage, "passed");
  assert.equal(state.channel.close_disposition, "no_reply");
  assert.equal(state.event.resolution, "dismissed");
  assert.ok(state.event.resolved_at);
  assert.equal(state.watcher.active, 1);
  assert.equal(state.watcher.deactivated_at, null);
  assert.deepEqual(state.logs[0], {
    event_type: "trigger_dismissed",
    from_stage: "passed",
    to_stage: "passed",
    close_disposition: "no_reply",
    note: "Dismissed sponsor appearance trigger for A new sponsored upload.",
  });
});

function apiRequest(path: "reopen" | "dismiss", body: Record<string, unknown>): Request {
  return new Request(`https://scout.test/api/outreach/triggers/12/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-scout-key": ADMIN_KEY,
      "cf-connecting-ip": "203.0.113.31",
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

function fakeTriggerD1() {
  const channel = {
    channel_id: CHANNEL_ID,
    title: "Triggered Creator",
    outreach_stage: "passed",
    close_disposition: "no_reply" as string | null,
    next_followup_at: null as string | null,
    is_active: 0,
    is_seed: 0,
    seed_locked: 0,
    status: "shortlisted",
  };
  const watcher = {
    id: 4,
    channel_id: CHANNEL_ID,
    active: 1,
    deactivated_at: null as string | null,
  };
  const event = {
    id: 12,
    watcher_id: 4,
    channel_id: CHANNEL_ID,
    trigger_type: "sponsor_appears",
    fired_at: "2026-07-30T12:00:00.000Z",
    fire_reason: "SponsorBlock confirmed sponsor segments on a post-attachment upload; brand identity unknown.",
    video_id: "video-12",
    video_title: "A new sponsored upload",
    video_published_at: "2026-07-29T12:00:00.000Z",
    original_close_at: "2026-07-20T12:00:00.000Z",
    original_close_note: "No reply after follow-up.",
    resolved_at: null as string | null,
    resolution: null as string | null,
  };
  const logs: Array<Record<string, unknown>> = [];
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
      if (this.query.includes("FROM outreach_trigger_events ote")) return event as T;
      if (this.query.includes("FROM channels WHERE channel_id = ?")) return channel as T;
      if (this.query.includes("FROM outreach_watchers") && this.query.includes("id <> ?")) return null;
      throw new Error(`Unexpected first() query: ${this.query}`);
    }
    async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
      if (this.query.startsWith("DELETE FROM auth_failures")) return d1Result<T>([], 0);
      if (this.query.includes("UPDATE outreach_trigger_events")) {
        event.resolved_at = String(this.bindings[0]);
        event.resolution = this.query.includes("'reopened'") ? "reopened" : "dismissed";
        return d1Result<T>([], 1);
      }
      if (this.query.includes("UPDATE outreach_watchers") && this.query.includes("active = 0")) {
        watcher.active = 0;
        watcher.deactivated_at = String(this.bindings[0]);
        return d1Result<T>([], 1);
      }
      if (this.query.includes("UPDATE outreach_watchers") && this.query.includes("active = 1")) {
        watcher.active = 1;
        watcher.deactivated_at = null;
        return d1Result<T>([], 1);
      }
      if (this.query.includes("UPDATE channels")) {
        channel.outreach_stage = String(this.bindings[0]);
        channel.close_disposition = null;
        channel.next_followup_at = this.bindings[1] as string | null;
        return d1Result<T>([], 1);
      }
      if (this.query.includes("INSERT INTO outreach_log")) {
        const reopened = this.query.includes("'passed', ?, NULL");
        logs.push(reopened ? {
          event_type: this.bindings[2],
          from_stage: "passed",
          to_stage: this.bindings[3],
          close_disposition: null,
          note: this.bindings[1],
        } : {
          event_type: this.bindings[2],
          from_stage: "passed",
          to_stage: "passed",
          close_disposition: this.bindings[3],
          note: this.bindings[1],
        });
        return d1Result<T>([], 1);
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
    async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      batchCalls += 1;
      batchStatementCount = statements.length;
      const results: D1Result<T>[] = [];
      for (const statement of statements) results.push(await statement.run<T>());
      return results;
    },
    async exec(): Promise<D1ExecResult> { throw new Error("Unexpected exec()."); },
    withSession(): D1DatabaseSession { throw new Error("Unexpected withSession()."); },
    async dump(): Promise<ArrayBuffer> { throw new Error("Unexpected dump()."); },
  };

  return {
    db,
    channel,
    watcher,
    event,
    logs,
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
