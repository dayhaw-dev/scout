import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  AnthropicClient,
  parseAnthropicQueries,
} from "../src/lib/anthropic.js";
import { Env } from "../src/lib/scrapecreators.js";

test("parseAnthropicQueries strips fences and validates useful query arrays", () => {
  const queries = parseAnthropicQueries(
    "```json\n[\"pagani huayra review\", \"bmw m5 review\", \"amg gt track\", \"stig lap\", \"supercar road trip\", \"electric hypercar\"]\n```",
    new Set(["stig lap"]),
  );

  assert.deepEqual(queries, [
    "pagani huayra review",
    "bmw m5 review",
    "amg gt track",
    "supercar road trip",
    "electric hypercar",
  ]);
});

test("parseAnthropicQueries rejects malformed responses", () => {
  assert.throws(() => parseAnthropicQueries("not json"));
  assert.throws(() => parseAnthropicQueries("{\"queries\":[]}"));
  assert.throws(() => parseAnthropicQueries("[\"one\"]"));
});

test("parseAnthropicQueries can reject lazy deep-search suffix variants", () => {
  const queries = parseAnthropicQueries(
    JSON.stringify([
      "korean short ribs grilled review",
      "galbi marinade recipe",
      "la galbi charcoal",
      "ssamjang grilled beef",
      "korean bbq banchan",
    ]),
    new Set(),
    {
      maxQueries: 4,
      rejectLazySuffixBase: "korean short ribs grilled",
    },
  );

  assert.deepEqual(queries, [
    "galbi marinade recipe",
    "la galbi charcoal",
    "ssamjang grilled beef",
    "korean bbq banchan",
  ]);
});

test("AnthropicClient logs zero-credit calls and retries one server error", async () => {
  const originalFetch = globalThis.fetch;
  const db = new MemoryD1();
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    if (calls === 1) return new Response("temporary", { status: 500 });
    return Response.json({
      content: [{
        type: "text",
        text: JSON.stringify([
          "pagani huayra review",
          "bmw m5 review",
          "amg gt track",
          "supercar road trip",
          "electric hypercar",
          "rally car test",
        ]),
      }],
      usage: {
        input_tokens: 321,
        output_tokens: 44,
      },
    });
  }) as typeof fetch;

  try {
    const client = new AnthropicClient({
      SCOUT_DB: db as unknown as D1Database,
      ANTHROPIC_API_KEY: "test-key",
      SCRAPECREATORS_API_KEY: "unused",
      SCOUT_ADMIN_KEY: "admin",
    } satisfies Env);
    const result = await client.generateSeedQueries({
      title: "Ben Collins Drives",
      handle: "BenCollinsDrives",
      description: "Car reviews and track tests.",
      videoTitles: ["Pagani Huayra review"],
    });

    assert.equal(calls, 2);
    assert.equal(db.logs.length, 2);
    assert.deepEqual(db.logs, [
      { endpoint: "anthropic", credits: 0 },
      { endpoint: "anthropic", credits: 0 },
    ]);
    assert.equal(result.inputTokens, 321);
    assert.equal(result.outputTokens, 44);
    assert.equal(result.queries[0], "pagani huayra review");
    assert.match(result.rawResponseText, /pagani huayra review/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("AnthropicClient generates deep variants with token accounting", async () => {
  const originalFetch = globalThis.fetch;
  const db = new MemoryD1();
  globalThis.fetch = (async () => Response.json({
    content: [{
      type: "text",
      text: JSON.stringify([
        "xi'an lamb paomo",
        "uyghur lamb skewers",
        "shaanxi flatbread soup",
        "cumin lamb noodles",
      ]),
    }],
    usage: {
      input_tokens: 111,
      output_tokens: 33,
    },
  })) as typeof fetch;

  try {
    const client = new AnthropicClient({
      SCOUT_DB: db as unknown as D1Database,
      ANTHROPIC_API_KEY: "test-key",
      SCRAPECREATORS_API_KEY: "unused",
      SCOUT_ADMIN_KEY: "admin",
    } satisfies Env);
    const result = await client.generateDeepVariants({
      baseQuery: "chinese lamb flatbread soup",
    });

    assert.equal(db.logs.length, 1);
    assert.equal(result.inputTokens, 111);
    assert.equal(result.outputTokens, 33);
    assert.deepEqual(result.queries, [
      "xi'an lamb paomo",
      "uyghur lamb skewers",
      "shaanxi flatbread soup",
      "cumin lamb noodles",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("AnthropicClient missing key fails cleanly for fallback callers", async () => {
  const client = new AnthropicClient({
    SCOUT_DB: new MemoryD1() as unknown as D1Database,
    SCRAPECREATORS_API_KEY: "unused",
    SCOUT_ADMIN_KEY: "admin",
  } satisfies Env);

  await assert.rejects(
    () => client.generateSeedQueries({
      title: "ThatDudeCanCook",
      handle: "ThatDudeCanCook",
      description: null,
      videoTitles: ["Carne asada tacos"],
    }),
    /ANTHROPIC_API_KEY/,
  );
});

test("seed query stale guard always retries ngram fallback rows", () => {
  const source = readSourceIndex();

  assert.match(source, /MAX\(CASE WHEN source = 'ngram' THEN 1 ELSE 0 END\) AS has_ngram/);
  assert.match(source, /if \(Number\(row\.has_ngram \?\? 0\) > 0\) return true;/);
});

test("mine query job notes include truncated raw LLM responses", () => {
  const source = readSourceIndex();

  assert.match(source, /raw_llm_responses: details\.rawLlmResponses/);
  assert.match(source, /function truncateJobText\(value: string, maxLength = 2000\): string/);
  assert.match(source, /raw_response_text: truncateJobText\(generated\.rawResponseText\)/);
});

class MemoryD1 {
  logs: Array<{ endpoint: string; credits: number }> = [];

  prepare(sql: string) {
    const db = this;
    return {
      values: [] as unknown[],
      bind(...values: unknown[]) {
        this.values = values;
        return this;
      },
      async run() {
        if (sql.includes("INSERT INTO api_log")) {
          db.logs.push({
            endpoint: String(this.values[0] ?? "anthropic"),
            credits: Number(this.values[1] ?? 0),
          });
        }
        return { success: true };
      },
    };
  }
}

function readSourceIndex(): string {
  return readFileSync("src/index.ts", "utf8");
}
