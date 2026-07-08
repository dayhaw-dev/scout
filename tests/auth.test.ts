import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTH_FAILURE_LIMIT,
  AUTH_WINDOW_MS,
  constantTimeEqual,
  currentFailureWindow,
  evaluateAdminAuth,
} from "../src/lib/auth.js";

test("constantTimeEqual compares full strings without plain equality", () => {
  assert.equal(constantTimeEqual("alpha", "alpha"), true);
  assert.equal(constantTimeEqual("alpha", "alpHa"), false);
  assert.equal(constantTimeEqual("alpha", "alpha-longer"), false);
  assert.equal(constantTimeEqual("", ""), true);
});

test("auth failure counter blocks after window limit and resets", async () => {
  const db = new MemoryD1();
  const now = new Date("2026-07-07T12:00:00Z");
  const request = new Request("https://scout.test/api/status", {
    headers: {
      "cf-connecting-ip": "203.0.113.10",
      "x-scout-key": "wrong",
    },
  });

  for (let index = 0; index < AUTH_FAILURE_LIMIT; index += 1) {
    const decision = await evaluateAdminAuth(db as unknown as D1Database, request, "correct", now);
    assert.equal(decision.status, 401);
  }

  const blocked = await evaluateAdminAuth(db as unknown as D1Database, request, "correct", now);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.retryAfterSeconds, AUTH_WINDOW_MS / 1000);

  const resetAt = new Date(now.getTime() + AUTH_WINDOW_MS + 1);
  const reset = await currentFailureWindow(db as unknown as D1Database, "203.0.113.10", resetAt);
  assert.equal(reset.blocked, false);
  assert.equal(reset.count, 0);
});

test("client IP ignores spoofable x-forwarded-for and fails into strict shared bucket", async () => {
  const db = new MemoryD1();
  const now = new Date("2026-07-07T12:00:00Z");
  const request = new Request("https://scout.test/api/status", {
    headers: {
      "x-forwarded-for": "198.51.100.222",
      "x-scout-key": "wrong",
    },
  });

  await evaluateAdminAuth(db as unknown as D1Database, request, "correct", now);
  assert.equal((await currentFailureWindow(db as unknown as D1Database, "unidentifiable", now)).count, 1);
  assert.equal((await currentFailureWindow(db as unknown as D1Database, "198.51.100.222", now)).count, 0);
});

test("successful auth clears existing failure count", async () => {
  const db = new MemoryD1();
  const now = new Date("2026-07-07T12:00:00Z");
  const bad = new Request("https://scout.test/api/status", {
    headers: {
      "cf-connecting-ip": "198.51.100.9",
      "x-scout-key": "bad",
    },
  });
  const good = new Request("https://scout.test/api/status", {
    headers: {
      "cf-connecting-ip": "198.51.100.9",
      "x-scout-key": "correct",
    },
  });

  await evaluateAdminAuth(db as unknown as D1Database, bad, "correct", now);
  await evaluateAdminAuth(db as unknown as D1Database, bad, "correct", now);
  assert.equal((await currentFailureWindow(db as unknown as D1Database, "198.51.100.9", now)).count, 2);

  const decision = await evaluateAdminAuth(db as unknown as D1Database, good, "correct", now);
  assert.equal(decision.ok, true);
  assert.equal((await currentFailureWindow(db as unknown as D1Database, "198.51.100.9", now)).count, 0);
});

class MemoryD1 {
  rows = new Map<string, { count: number; window_start: string }>();

  prepare(sql: string) {
    const db = this;
    const statement = {
      values: [] as unknown[],
      bind(...values: unknown[]) {
        this.values = values;
        return this;
      },
      async first<T>() {
        const ip = String(this.values[0]);
        if (sql.startsWith("SELECT count, window_start")) {
          return (db.rows.get(ip) ?? null) as T | null;
        }
        return null as T | null;
      },
      async run() {
        const ip = String(this.values[0]);
        if (sql.startsWith("DELETE")) {
          db.rows.delete(ip);
        } else if (sql.startsWith("UPDATE auth_failures SET count = count + 1")) {
          const row = db.rows.get(ip);
          if (row) db.rows.set(ip, { ...row, count: row.count + 1 });
        } else if (sql.includes("INSERT INTO auth_failures")) {
          db.rows.set(ip, {
            count: 1,
            window_start: String(this.values[1]),
          });
        }
        return { success: true };
      },
    };

    return statement;
  }
}
