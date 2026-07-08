import assert from "node:assert/strict";
import test from "node:test";
import { normalizeUnicodeText, parseCountText } from "../src/lib/text.js";

test("parseCountText always stores integer counts", () => {
  assert.equal(parseCountText(8060000.000000001), 8_060_000);
  assert.equal(parseCountText("4,380,165,975 views"), 4_380_165_975);
  assert.equal(parseCountText("8.06M subscribers"), 8_060_000);
});

test("normalizeUnicodeText preserves UTF-8 and repairs common mojibake", () => {
  assert.equal(normalizeUnicodeText("Creaky Blinder™ and café"), "Creaky Blinder™ and café");
  assert.equal(normalizeUnicodeText("Creaky Blinderâ„¢"), "Creaky Blinder™");
});
