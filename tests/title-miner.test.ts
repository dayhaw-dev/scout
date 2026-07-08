import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateTitleQuerySuggestions,
  mineSeedTitlePhrases,
  TitleMiningSeed,
} from "../src/lib/title-miner.js";

const bbq: TitleMiningSeed = {
  channel_id: "bbq",
  title: "ArnieTex",
  handle: "ArnieTex",
  videos: [
    "Smoked brisket burnt ends on the offset smoker",
    "Brisket burnt ends tacos - WOW",
    "Pellet grill review after 90 days",
    "Texas smoked brisket tips episode 12",
  ],
};

const science: TitleMiningSeed = {
  channel_id: "science",
  title: "Kitchen Science",
  handle: "kitchenscience",
  videos: [
    "Why superconductors float above magnets",
    "Quantum levitation explained with magnets",
    "The physics of induction heating",
  ],
};

const gaming: TitleMiningSeed = {
  channel_id: "gaming",
  title: "Pixel Lab",
  handle: "pixellab",
  videos: [
    "Hardcore minecraft base tour part 7",
    "Minecraft redstone door tutorial",
    "Cozy survival base ideas",
  ],
};

test("title miner extracts specific BBQ content phrases", () => {
  const phrases = mineSeedTitlePhrases(bbq, [bbq, science, gaming], 10).map((item) => item.term);
  assert.ok(phrases.includes("brisket burnt ends"));
  assert.ok(phrases.includes("smoked brisket"));
  assert.ok(phrases.includes("pellet grill"));
  assert.ok(!phrases.some((phrase) => phrase.includes("wow")));
  assert.ok(!phrases.some((phrase) => phrase.includes("episode")));
});

test("title miner keeps phrases distinctive across seeds", () => {
  const phrases = aggregateTitleQuerySuggestions([bbq, science, gaming], 20).map((item) => item.term);
  assert.ok(phrases.includes("quantum levitation explained"));
  assert.ok(phrases.includes("minecraft redstone door"));
  assert.ok(!phrases.includes("the physics"));
});

test("title miner honors the shared blocklist", () => {
  const phrases = aggregateTitleQuerySuggestions(
    [bbq, science],
    10,
    new Set(["brisket burnt ends"]),
  ).map((item) => item.term);
  assert.ok(!phrases.includes("brisket burnt ends"));
});

test("title miner fallback drops channel-meta glue and weights recent titles", () => {
  const seed: TitleMiningSeed = {
    channel_id: "cook",
    title: "ThatDudeCanCook",
    handle: "ThatDudeCanCook",
    videos: [
      { title: "Special announcement book tour behind the scenes", published_at: "2026-07-01T00:00:00Z" },
      { title: "Carne asada tacos with salsa roja", published_at: "2026-06-20T00:00:00Z" },
      { title: "Carne asada tacos you'll ever need", published_at: "2026-06-10T00:00:00Z" },
      { title: "Full send merch giveaway", published_at: "2026-05-01T00:00:00Z" },
      { title: "Old garlic bread recipe", published_at: "2020-01-01T00:00:00Z" },
      { title: "Old garlic bread recipe", published_at: "2020-02-01T00:00:00Z" },
    ],
  };

  const phrases = mineSeedTitlePhrases(seed, [seed], 10).map((item) => item.term);
  assert.ok(phrases.includes("carne asada tacos"));
  assert.ok(!phrases.some((phrase) => phrase.includes("book tour")));
  assert.ok(!phrases.some((phrase) => phrase.includes("full send")));
  assert.ok(!phrases.includes("garlic bread") || phrases.indexOf("carne asada tacos") < phrases.indexOf("garlic bread"));
});
