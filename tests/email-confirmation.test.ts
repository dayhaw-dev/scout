import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("email confirmation migration adds a constrained flag and audit timestamp", () => {
  const migration = readFileSync("migrations/0020_email_confirmation.sql", "utf8");

  assert.match(migration, /email_confirmed INTEGER NOT NULL DEFAULT 0/);
  assert.match(migration, /CHECK \(email_confirmed IN \(0, 1\)\)/);
  assert.match(migration, /email_confirmed_at TEXT/);
});

test("channel patch toggles confirmation, timestamps it, and scores the next state", () => {
  const source = readFileSync("src/index.ts", "utf8");

  assert.match(source, /email_confirmed must be boolean/);
  assert.match(source, /email_confirmed_at = CURRENT_TIMESTAMP/);
  assert.match(source, /email_confirmed_at = NULL/);
  assert.match(source, /email_confirmed: nextEmailConfirmed \? 1 : 0/);
  assert.match(source, /email_confirmed: row\.email_confirmed === 1/);
});

test("shared channel card exposes the manual indicator and overflow toggle", () => {
  const source = readFileSync("ui/src/App.tsx", "utf8");

  assert.match(source, /Mark business email exists/);
  assert.match(source, /Unmark business email/);
  assert.match(source, /EMAIL \(CONFIRMED\) - manual confirmation/);
  assert.match(source, /showConfirmedEmail = channel\.email_confirmed && !channel\.email_present/);
});
