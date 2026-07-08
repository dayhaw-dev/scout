import assert from "node:assert/strict";
import test from "node:test";
import { mineChannelRefs } from "../src/lib/mine.js";

test("extracts mentions from a realistic sponsor-heavy description", () => {
  const description = `
Thanks to Brilliant for sponsoring this episode: https://brilliant.org/scout

Featuring @minutephysics and @3blue1brown on the blackboard.
More reading:
00:00 Intro
01:12 Model
10:40 Credits
`;

  assert.deepEqual(mineChannelRefs(description, { seedHandle: "veritasium" }), [
    { type: "handle", ref: "minutephysics", collab: true },
    { type: "handle", ref: "3blue1brown", collab: true },
  ]);
});

test("extracts channel URLs and custom URLs while skipping video links", () => {
  const description = `
With @standupmaths today.
Guest channel: https://www.youtube.com/@numberphile
Archive: https://youtube.com/channel/UCYO_jab_esuFRV4b17AJtAw
Old URL: https://www.youtube.com/c/Computerphile
Watch this clip: https://youtu.be/dQw4w9WgXcQ
`;

  assert.deepEqual(mineChannelRefs(description), [
    { type: "handle", ref: "numberphile", collab: false },
    { type: "channelId", ref: "UCYO_jab_esuFRV4b17AJtAw", collab: false },
    {
      type: "customUrl",
      ref: "https://www.youtube.com/c/Computerphile",
      collab: false,
    },
    { type: "handle", ref: "standupmaths", collab: true },
  ]);
});

test("dedupes refs and preserves collab signal", () => {
  const description = `
collab with @practicalengineering
More from @practicalengineering: https://youtube.com/@practicalengineering
`;

  assert.deepEqual(mineChannelRefs(description), [
    { type: "handle", ref: "practicalengineering", collab: true },
  ]);
});

test("excludes seed self links and mentions", () => {
  const description = `
Main channel @veritasium
Subscribe https://www.youtube.com/@veritasium
Also @smartereveryday
`;

  assert.deepEqual(
    mineChannelRefs(description, {
      seedHandle: "veritasium",
      seedChannelId: "UCHnyfMqiRRG1u-2MsSQLbXA",
    }),
    [{ type: "handle", ref: "smartereveryday", collab: false }],
  );
});

test("does not treat an email address as a channel mention", () => {
  const description = "Contact science@example.com or follow @kurzgesagt.";

  assert.deepEqual(mineChannelRefs(description), [
    { type: "handle", ref: "kurzgesagt", collab: false },
  ]);
});
