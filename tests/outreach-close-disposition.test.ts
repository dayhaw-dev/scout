import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  OUTREACH_EVENT_TYPES,
  OutreachValidationError,
  planOutreachStageEvent,
  validateOutreachEventType,
} from "../src/lib/outreach.js";

test("passed requires an explicit evidenced close disposition", () => {
  assert.throws(
    () => planOutreachStageEvent("pitched", "passed", null),
    (error: unknown) => error instanceof OutreachValidationError
      && error.message === "close_disposition is required when outreach_status is passed",
  );
  assert.throws(() => planOutreachStageEvent("pitched", "passed", "went_dark"));

  assert.deepEqual(planOutreachStageEvent("pitched", "passed", "no_reply"), {
    eventType: "closed",
    fromStage: "pitched",
    toStage: "passed",
    logCloseDisposition: "no_reply",
    channelCloseDisposition: "no_reply",
  });
});

test("reopening and every non-passed target clear close disposition", () => {
  assert.deepEqual(planOutreachStageEvent("passed", "replied", "no_reply"), {
    eventType: "stage_changed",
    fromStage: "passed",
    toStage: "replied",
    logCloseDisposition: null,
    channelCloseDisposition: null,
  });
  assert.equal(planOutreachStageEvent("pitched", "signed", "no_reply").channelCloseDisposition, null);
  assert.equal(planOutreachStageEvent("sent", "pitched", "declined").channelCloseDisposition, null);
});

test("structured event fields distinguish stage changes, closes, and plain notes", () => {
  assert.deepEqual(planOutreachStageEvent("sent", "replied", null), {
    eventType: "stage_changed",
    fromStage: "sent",
    toStage: "replied",
    logCloseDisposition: null,
    channelCloseDisposition: null,
  });
  assert.deepEqual(planOutreachStageEvent("signed", "signed", null), {
    eventType: "note",
    fromStage: null,
    toStage: null,
    logCloseDisposition: null,
    channelCloseDisposition: null,
  });
});

test("outreach event_type validation is exhaustive", () => {
  assert.deepEqual(OUTREACH_EVENT_TYPES, [
    "note",
    "stage_changed",
    "closed",
    "reopened",
    "trigger_dismissed",
  ]);
  assert.equal(validateOutreachEventType("closed"), "closed");
  assert.throws(
    () => validateOutreachEventType("mystery"),
    (error: unknown) => error instanceof OutreachValidationError
      && error.message === "Invalid outreach event_type",
  );
});

test("UI requires close reason and renders unknown legacy pass reasons honestly", () => {
  const app = readFileSync("ui/src/App.tsx", "utf8");
  assert.match(app, /<span>Why closed\?<\/span>/);
  assert.match(app, /<option value="" disabled>Select a reason<\/option>/);
  assert.match(app, /<option value="declined">DECLINED<\/option>/);
  assert.match(app, /<option value="no_reply">NO REPLY \/ WENT DARK<\/option>/);
  assert.match(app, /outreachStatus === "passed" && !closeDisposition/);
  assert.match(app, /PASS REASON UNKNOWN/);
});
