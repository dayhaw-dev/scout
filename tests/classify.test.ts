import assert from "node:assert/strict";
import test from "node:test";
import { classifyChannel } from "../src/lib/classify.js";

const seeds = [
  {
    channel_id: "seed-daniel",
    title: "Daniel Thrasher",
    handle: "danielthrasher",
    raw_json: JSON.stringify({ channel: "https://www.youtube.com/@danielthrasher" }),
  },
  {
    channel_id: "seed-merle",
    title: "Merle O'Neal",
    handle: "merleoneal",
    raw_json: JSON.stringify({ channel: "https://www.youtube.com/@merleoneal" }),
  },
];

test("classifies a genuine adjacent creator", () => {
  const result = classifyChannel(
    {
      channel_id: "internet-shaquille",
      title: "Internet Shaquille",
      handle: "internetshaquille",
      description: "I make cooking videos and teach people how to cook better at home.",
      raw_json: JSON.stringify({
        links: ["https://www.instagram.com/internetshaquille"],
      }),
    },
    seeds,
  );

  assert.equal(result.kind, "creator");
});

test("classifies a corporate sponsor channel as brand", () => {
  const result = classifyChannel(
    {
      channel_id: "hexclad",
      title: "HexClad Cookware",
      handle: "hexclad",
      description: "Premium cookware for your kitchen. Shop our products and offers.",
      raw_json: JSON.stringify({
        links: ["https://hexclad.com/shop", "https://www.amazon.com/hexclad"],
      }),
    },
    seeds,
  );

  assert.equal(result.kind, "brand");
});

test("classifies storefront and product brand channel names as brand", () => {
  const recteq = classifyChannel(
    {
      channel_id: "recteq",
      title: "recteq",
      handle: "recteq",
      description: "Wood pellet grills, smokers, recipes, and product demos.",
      raw_json: JSON.stringify({ links: ["https://www.recteq.com"] }),
    },
    seeds,
  );
  const ace = classifyChannel(
    {
      channel_id: "ace-hardware",
      title: "Ace Hardware",
      handle: "acehardware",
      description: "Helpful hardware store tips, tools, products, and outdoor living ideas.",
      raw_json: JSON.stringify({ links: ["https://www.acehardware.com"] }),
    },
    seeds,
  );

  assert.equal(recteq.kind, "brand");
  assert.equal(ace.kind, "brand");
});

test("classifies a seed alternate channel as alt", () => {
  const result = classifyChannel(
    {
      channel_id: "daniel-plus",
      title: "Daniel Thrasher Plus",
      handle: "danielthrasherplus",
      description: "Extra clips from Daniel.",
      raw_json: JSON.stringify({
        links: ["https://www.youtube.com/@danielthrasher"],
      }),
    },
    seeds,
  );

  assert.equal(result.kind, "alt");
});

test("defaults mega-celebrity name drops to creator when no brand signal is strong", () => {
  const result = classifyChannel(
    {
      channel_id: "billie",
      title: "Billie Eilish",
      handle: "billieeilish",
      subscriber_count: 58_000_000,
      description: "Music videos and live performances.",
      raw_json: JSON.stringify({ links: ["https://www.billieeilish.com"] }),
    },
    seeds,
  );

  assert.equal(result.kind, "creator");
});
