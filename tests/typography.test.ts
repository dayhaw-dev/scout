import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const styles = readFileSync("ui/src/styles.css", "utf8");

test("SCOUT uses the same Bahnschrift UI and display stacks as GENEOS.SYS", () => {
  assert.match(styles, /--font-display: "Bahnschrift Condensed", "Arial Narrow", "Aptos Display", "Segoe UI", sans-serif/);
  assert.match(styles, /--font-ui: "Bahnschrift", "Segoe UI", system-ui, sans-serif/);
  assert.match(styles, /font-family: var\(--font-ui\)/);
  assert.match(styles, /\.wordmark,[\s\S]*?\.channel-title,[\s\S]*?\.chip,[\s\S]*?font-family: var\(--font-display\)/);
  assert.doesNotMatch(styles, /DIN Alternate/);
});
