import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  classifyPendingSeedLiveEntries,
  classifyPendingSeedRssEntries,
  classifyYouTubeLiveVod,
  classifyYouTubeShort,
  deriveSeedFreshness,
  fetchYouTubeRssUploads,
  PersistedSeedRssEntry,
  SEED_CLASSIFICATION_REQUEST_CAP,
  SEED_LIVE_CLASSIFICATION_DELAY_MS,
  SEED_LIVE_CLASSIFICATION_MAX_BYTES,
  SEED_LIVE_CLASSIFICATION_REQUEST_CAP,
  SEED_LIVE_CLASSIFICATION_TIMEOUT_MS,
  SEED_LIVE_CLASSIFICATION_VERSION,
  SEED_RSS_ENTRY_UPSERT_SQL,
  SEED_SHORTS_CLASSIFICATION_REQUEST_CAP,
  seedFreshnessCacheIsFresh,
  seedFreshnessCacheIsUsable,
  seedFreshnessIsFullyMined,
  seedRssSnapshotAggregates,
  YOUTUBE_RSS_ENTRY_LIMIT,
} from "../src/lib/seed-freshness.js";
import { RecentVideo } from "../src/lib/sponsor-scan.js";
import {
  SEED_FRESHNESS_PACING_MAX_MS,
  SEED_FRESHNESS_PACING_MIN_MS,
  SEED_RSS_WINDOW_TOOLTIP,
  seedFreshnessPacingMs,
  seedFreshnessSecondaryNote,
  seedOrePresentation,
} from "../ui/src/seed-freshness.js";
import type { SeedMiningFreshness } from "../ui/src/api.js";

const CHECKED_AT = "2026-07-23T12:00:00.000Z";

function uiFreshness(overrides: Partial<SeedMiningFreshness> = {}): SeedMiningFreshness {
  return {
    latest_upload_at: "2026-07-23T12:00:00.000Z",
    newest_stored_video_at: "2026-07-22T12:00:00.000Z",
    stored_video_count: 30,
    unmined_count: 0,
    unmined_is_lower_bound: false,
    never_mined: false,
    rss_entry_count: 15,
    shorts_count: 0,
    pending_classification_count: 0,
    live_count: 0,
    pending_live_classification_count: 0,
    fully_mined: true,
    status: "ok",
    error: null,
    checked_at: CHECKED_AT,
    stale: false,
    ...overrides,
  };
}

function classifiedRssEntry(
  videoId: string,
  isShort: 0 | 1 | null,
  feedPosition: number,
  publishedAt = new Date(Date.UTC(2026, 6, 23, 12 - feedPosition)).toISOString(),
  isLive: 0 | 1 | null = isShort === 0 ? 0 : null,
): PersistedSeedRssEntry {
  return {
    channel_id: "seed",
    video_id: videoId,
    title: videoId,
    published_at: publishedAt,
    feed_position: feedPosition,
    is_short: isShort,
    classification_attempted_at: CHECKED_AT,
    classified_at: isShort === null ? null : CHECKED_AT,
    classification_error: isShort === null ? "pending" : null,
    is_live: isLive,
    live_classification_attempted_at: isLive === null ? null : CHECKED_AT,
    live_classified_at: isLive === null ? null : CHECKED_AT,
    live_classification_error: null,
    first_seen_at: CHECKED_AT,
    last_seen_at: CHECKED_AT,
  };
}

function rawRssEntries(entries: PersistedSeedRssEntry[]): RecentVideo[] {
  return entries.map((entry) => ({
    video_id: entry.video_id,
    video_title: entry.title,
    published_at: entry.published_at,
  }));
}

function watchPage(videoId: string, isLiveContent: boolean): string {
  return `<html><script>var ytInitialPlayerResponse = ${JSON.stringify({
    videoDetails: {
      videoId,
      isLiveContent,
      title: "A title with { balanced } braces",
      thumbnail: { thumbnails: [] },
    },
  })};</script></html>`;
}

function pendingLiveEntry(videoId: string, feedPosition: number): PersistedSeedRssEntry {
  return classifiedRssEntry(videoId, 0, feedPosition, undefined, null);
}

test("all-Shorts RSS window reports zero long-form unmined for a mined seed", () => {
  const classified = Array.from(
    { length: YOUTUBE_RSS_ENTRY_LIMIT },
    (_, index) => classifiedRssEntry(`short-${index}`, 1, index),
  );
  const result = deriveSeedFreshness(
    rawRssEntries(classified),
    classified,
    CHECKED_AT,
    [{ video_id: "stored-long-form", published_at: "2026-07-01T00:00:00Z" }],
    30,
  );

  assert.equal(result.latest_upload_at, classified[0]?.published_at);
  assert.equal(result.unmined_count, 0);
  assert.equal(result.shorts_count, 15);
  assert.equal(result.pending_classification_count, 0);
  assert.equal(result.unmined_is_lower_bound, false);
  assert.equal(
    seedFreshnessIsFullyMined(
      result.never_mined,
      result.unmined_count,
      result.pending_classification_count,
      result.pending_live_classification_count,
      SEED_LIVE_CLASSIFICATION_VERSION,
    ),
    true,
  );
});

test("mixed RSS window counts only unstored classified long-form entries", () => {
  const classified = [
    classifiedRssEntry("stored-long-form", 0, 0),
    classifiedRssEntry("short-new", 1, 1),
    classifiedRssEntry("long-form-new", 0, 2),
    classifiedRssEntry("pending-new", null, 3),
  ];
  const result = deriveSeedFreshness(
    rawRssEntries(classified),
    classified,
    CHECKED_AT,
    [{ video_id: "stored-long-form", published_at: classified[0]?.published_at ?? null }],
    30,
  );

  assert.equal(result.unmined_count, 1);
  assert.equal(result.shorts_count, 1);
  assert.equal(result.pending_classification_count, 1);
  assert.equal(result.unmined_is_lower_bound, false);
});

test("pending-only RSS window is zero unmined but never fully mined", () => {
  const classified = [
    classifiedRssEntry("pending-one", null, 0),
    classifiedRssEntry("pending-two", null, 1),
  ];
  const result = deriveSeedFreshness(
    rawRssEntries(classified),
    classified,
    CHECKED_AT,
    [{ video_id: "stored-long-form", published_at: "2026-07-01T00:00:00Z" }],
    30,
  );

  assert.equal(result.unmined_count, 0);
  assert.equal(result.shorts_count, 0);
  assert.equal(result.pending_classification_count, 2);
  assert.equal(
    seedFreshnessIsFullyMined(
      result.never_mined,
      result.unmined_count,
      result.pending_classification_count,
      result.pending_live_classification_count,
      SEED_LIVE_CLASSIFICATION_VERSION,
    ),
    false,
  );
});

test("zero stored videos remains never mined without inventing an unmined count", () => {
  const classified = [
    classifiedRssEntry("latest-short", 1, 0),
    classifiedRssEntry("latest-long-form", 0, 1),
    classifiedRssEntry("latest-pending", null, 2),
  ];
  const result = deriveSeedFreshness(
    rawRssEntries(classified),
    classified,
    CHECKED_AT,
    [],
    0,
  );

  assert.equal(result.never_mined, true);
  assert.equal(result.unmined_count, null);
  assert.equal(result.latest_upload_at, classified[0]?.published_at);
  assert.equal(result.shorts_count, 1);
  assert.equal(result.pending_classification_count, 1);
  assert.equal(
    seedFreshnessIsFullyMined(
      result.never_mined,
      result.unmined_count,
      result.pending_classification_count,
      result.pending_live_classification_count,
      SEED_LIVE_CLASSIFICATION_VERSION,
    ),
    false,
  );
});

test("lower-bound flag requires a full feed, unmined long-form, and no stored boundary", () => {
  const noBoundary = [
    classifiedRssEntry("unmined-long-form", 0, 0),
    ...Array.from(
      { length: YOUTUBE_RSS_ENTRY_LIMIT - 1 },
      (_, index) => classifiedRssEntry(`short-${index}`, 1, index + 1),
    ),
  ];
  const withBoundary = [
    ...noBoundary.slice(0, YOUTUBE_RSS_ENTRY_LIMIT - 1),
    classifiedRssEntry("stored-boundary", 0, YOUTUBE_RSS_ENTRY_LIMIT - 1),
  ];
  const stored = [{ video_id: "stored-boundary", published_at: "2026-07-01T00:00:00Z" }];

  const lowerBound = deriveSeedFreshness(
    rawRssEntries(noBoundary),
    noBoundary,
    CHECKED_AT,
    stored,
    30,
  );
  const bounded = deriveSeedFreshness(
    rawRssEntries(withBoundary),
    withBoundary,
    CHECKED_AT,
    stored,
    30,
  );
  const shortFeed = deriveSeedFreshness(
    rawRssEntries(noBoundary.slice(0, 14)),
    noBoundary.slice(0, 14),
    CHECKED_AT,
    stored,
    30,
  );

  assert.equal(lowerBound.unmined_count, 1);
  assert.equal(lowerBound.unmined_is_lower_bound, true);
  assert.equal(bounded.unmined_count, 1);
  assert.equal(bounded.unmined_is_lower_bound, false);
  assert.equal(shortFeed.unmined_count, 1);
  assert.equal(shortFeed.unmined_is_lower_bound, false);
});

test("an empty successful YouTube feed is preserved as zero RSS entries", async () => {
  const uploads = await fetchYouTubeRssUploads(
    "channel",
    async () => new Response("<feed></feed>", { status: 200 }),
  );

  assert.deepEqual(uploads, []);
});

test("transient YouTube RSS 404 is retried once", async () => {
  let calls = 0;
  const uploads = await fetchYouTubeRssUploads("channel", async () => {
    calls += 1;
    if (calls === 1) return new Response("Not found", { status: 404 });
    return new Response(`
      <feed xmlns:yt="http://www.youtube.com/xml/schemas/2015">
        <entry>
          <yt:videoId>after-retry</yt:videoId>
          <title>After retry</title>
          <published>2026-07-17T12:00:00Z</published>
        </entry>
      </feed>
    `);
  });

  assert.equal(calls, 2);
  assert.equal(uploads[0]?.video_id, "after-retry");
});

test("persistent retryable RSS failures stop after three attempts", async () => {
  let calls = 0;
  await assert.rejects(
    () => fetchYouTubeRssUploads("channel", async () => {
      calls += 1;
      return new Response("Server error", { status: 500 });
    }),
    /failed with 500/,
  );
  assert.equal(calls, 3);
});

test("strict Shorts classifier accepts only validated response patterns", async () => {
  const seenOptions: RequestInit[] = [];
  const short = await classifyYouTubeShort("short-id", async (_input, options) => {
    seenOptions.push(options ?? {});
    return new Response(null, { status: 200 });
  });
  const longForm = await classifyYouTubeShort("long-id", async (_input, options) => {
    seenOptions.push(options ?? {});
    return new Response(null, {
      status: 303,
      headers: { location: "/watch?v=long-id&feature=share" },
    });
  });
  const ambiguous = await classifyYouTubeShort("unknown-id", async (_input, options) => {
    seenOptions.push(options ?? {});
    return new Response(null, {
      status: 302,
      headers: { location: "/watch?v=some-other-id" },
    });
  });

  assert.deepEqual(short, { is_short: 1, error: null });
  assert.deepEqual(longForm, { is_short: 0, error: null });
  assert.equal(ambiguous.is_short, null);
  assert.match(ambiguous.error ?? "", /Ambiguous Shorts response/);
  assert.deepEqual(
    seenOptions.map(({ method, redirect }) => ({ method, redirect })),
    Array.from({ length: 3 }, () => ({ method: "HEAD", redirect: "manual" })),
  );
});

test("Shorts classification is capped at 30 requests per invocation", async () => {
  const checkedAt = "2026-07-23T12:00:00.000Z";
  const entries = Array.from({ length: 35 }, (_, index): PersistedSeedRssEntry => ({
    channel_id: "seed",
    video_id: `video-${index}`,
    title: `Video ${index}`,
    published_at: checkedAt,
    feed_position: index % YOUTUBE_RSS_ENTRY_LIMIT,
    is_short: null,
    classification_attempted_at: null,
    classified_at: null,
    classification_error: null,
    is_live: null,
    live_classification_attempted_at: null,
    live_classified_at: null,
    live_classification_error: null,
    first_seen_at: checkedAt,
    last_seen_at: checkedAt,
  }));
  let requests = 0;
  let pauses = 0;
  const attempts = await classifyPendingSeedRssEntries(entries, {
    fetcher: async () => {
      requests += 1;
      return new Response(null, { status: 200 });
    },
    pause: async () => {
      pauses += 1;
    },
    now: () => checkedAt,
    limit: 100,
  });

  assert.equal(SEED_SHORTS_CLASSIFICATION_REQUEST_CAP, 30);
  assert.equal(attempts.length, 30);
  assert.equal(requests, 30);
  assert.equal(pauses, 29);
  assert.equal(attempts.every((attempt) => attempt.is_short === 1), true);
});

test("strict streamed live classifier accepts only validated videoDetails objects", async () => {
  const seenOptions: RequestInit[] = [];
  const live = await classifyYouTubeLiveVod("live-id", async (_input, options) => {
    seenOptions.push(options ?? {});
    return new Response(watchPage("live-id", true), { status: 200 });
  });
  const ordinary = await classifyYouTubeLiveVod("ordinary-id", async (_input, options) => {
    seenOptions.push(options ?? {});
    return new Response(watchPage("ordinary-id", false), { status: 200 });
  });

  assert.deepEqual(live, { is_live: 1, error: null });
  assert.deepEqual(ordinary, { is_live: 0, error: null });
  assert.deepEqual(
    seenOptions.map(({ method, redirect, headers, signal }) => ({
      method,
      redirect,
      headers,
      hasSignal: signal instanceof AbortSignal,
    })),
    Array.from({ length: 2 }, () => ({
      method: "GET",
      redirect: "follow",
      headers: { accept: "text/html" },
      hasSignal: true,
    })),
  );
});

test("live classifier leaves mismatched, malformed, and truncated details pending with exact errors", async () => {
  const mismatch = await classifyYouTubeLiveVod(
    "requested-id",
    async () => new Response(watchPage("different-id", true)),
  );
  const malformed = await classifyYouTubeLiveVod(
    "malformed-id",
    async () => new Response('<script>{"videoDetails":{"videoId":"malformed-id","isLiveContent":tru}}</script>'),
  );
  const truncated = await classifyYouTubeLiveVod(
    "truncated-id",
    async () => new Response('<script>{"videoDetails":{"videoId":"truncated-id","isLiveContent":true'),
  );
  const missingBoolean = await classifyYouTubeLiveVod(
    "missing-boolean",
    async () => new Response('<script>{"videoDetails":{"videoId":"missing-boolean"}}</script>'),
  );

  assert.deepEqual(mismatch, {
    is_live: null,
    error: "Live classification videoId mismatch: expected requested-id.",
  });
  assert.deepEqual(malformed, {
    is_live: null,
    error: "Live classification videoDetails object was malformed or truncated.",
  });
  assert.deepEqual(truncated, {
    is_live: null,
    error: "Live classification videoDetails object was malformed or truncated.",
  });
  assert.deepEqual(missingBoolean, {
    is_live: null,
    error: "Live classification isLiveContent was not boolean.",
  });
});

test("live classifier stops at the hard one-MiB streamed body limit", async () => {
  const result = await classifyYouTubeLiveVod(
    "after-limit",
    async () => new Response(
      `${"x".repeat(SEED_LIVE_CLASSIFICATION_MAX_BYTES)}${watchPage("after-limit", true)}`,
    ),
  );

  assert.equal(SEED_LIVE_CLASSIFICATION_MAX_BYTES, 1024 * 1024);
  assert.deepEqual(result, {
    is_live: null,
    error: `Live classification response exceeded ${SEED_LIVE_CLASSIFICATION_MAX_BYTES}-byte limit.`,
  });
});

test("live classifier records unexpected status, consent, and timeout as non-definitive", async () => {
  const unexpectedStatus = await classifyYouTubeLiveVod(
    "status-id",
    async () => new Response("unavailable", { status: 503 }),
  );
  const consent = await classifyYouTubeLiveVod(
    "consent-id",
    async () => new Response(
      "<title>Before you continue to YouTube</title><a href='https://consent.youtube.com/'>continue</a>",
    ),
  );
  const timeout = await classifyYouTubeLiveVod(
    "timeout-id",
    async () => {
      throw new DOMException("aborted", "AbortError");
    },
  );

  assert.deepEqual(unexpectedStatus, {
    is_live: null,
    error: "Live classification request failed with 503.",
  });
  assert.deepEqual(consent, {
    is_live: null,
    error: "Live classification reached YouTube consent page.",
  });
  assert.deepEqual(timeout, {
    is_live: null,
    error: "Live classification request timed out.",
  });
  assert.equal(SEED_LIVE_CLASSIFICATION_TIMEOUT_MS, 8_000);
});

test("live GET eligibility excludes Shorts, stored IDs, known live state, and never-mined seeds", async () => {
  const entries = [
    pendingLiveEntry("eligible-long", 0),
    classifiedRssEntry("short", 1, 1),
    classifiedRssEntry("short-pending", null, 2),
    pendingLiveEntry("stored-long", 3),
    classifiedRssEntry("known-non-live", 0, 4),
    classifiedRssEntry("known-live", 0, 5, undefined, 1),
  ];
  const stored = [
    { video_id: "stored-long", published_at: CHECKED_AT },
    { video_id: "stored-boundary", published_at: CHECKED_AT },
  ];
  const requested: string[] = [];
  const attempts = await classifyPendingSeedLiveEntries(entries, stored, stored.length, {
    fetcher: async (input) => {
      const videoId = new URL(String(input)).searchParams.get("v") ?? "";
      requested.push(videoId);
      return new Response(watchPage(videoId, false));
    },
    pause: async () => undefined,
    now: () => CHECKED_AT,
  });
  const neverMined = await classifyPendingSeedLiveEntries(entries, [], 0, {
    fetcher: async () => {
      throw new Error("never-mined seed must not fetch watch pages");
    },
  });

  assert.deepEqual(requested, ["eligible-long"]);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0]?.is_live, 0);
  assert.deepEqual(neverMined, []);
});

test("live GETs are capped at six and also respect the shared 30-attempt ceiling", async () => {
  const entries = Array.from({ length: 8 }, (_, index) => pendingLiveEntry(`live-${index}`, index));
  const stored = [{ video_id: "stored-boundary", published_at: CHECKED_AT }];
  let requests = 0;
  let pauses = 0;
  const classify = async (classificationAttemptsUsed: number) => classifyPendingSeedLiveEntries(
    entries,
    stored,
    30,
    {
      classificationAttemptsUsed,
      limit: 100,
      fetcher: async (input) => {
        requests += 1;
        const videoId = new URL(String(input)).searchParams.get("v") ?? "";
        return new Response(watchPage(videoId, false));
      },
      pause: async (ms) => {
        assert.equal(ms, SEED_LIVE_CLASSIFICATION_DELAY_MS);
        pauses += 1;
      },
      now: () => CHECKED_AT,
    },
  );

  const liveCap = await classify(0);
  assert.equal(SEED_CLASSIFICATION_REQUEST_CAP, 30);
  assert.equal(SEED_LIVE_CLASSIFICATION_REQUEST_CAP, 6);
  assert.equal(SEED_LIVE_CLASSIFICATION_DELAY_MS, 350);
  assert.equal(liveCap.length, 6);
  assert.equal(requests, 6);
  assert.equal(pauses, 5);

  requests = 0;
  pauses = 0;
  const sharedCap = await classify(28);
  assert.equal(sharedCap.length, 2);
  assert.equal(requests, 2);
  assert.equal(pauses, 1);
});

test("current-snapshot live aggregates count definitive live and only eligible pending rows", () => {
  const priorCheckedAt = "2026-07-23T06:00:00.000Z";
  const currentLive = classifiedRssEntry("current-live", 0, 0, undefined, 1);
  const currentPending = pendingLiveEntry("current-pending", 1);
  const storedPending = pendingLiveEntry("stored-pending", 2);
  const priorLive = classifiedRssEntry("prior-live", 0, 3, undefined, 1);
  priorLive.last_seen_at = priorCheckedAt;

  assert.deepEqual(
    seedRssSnapshotAggregates(
      [currentLive, currentPending, storedPending, priorLive],
      CHECKED_AT,
      [{ video_id: "stored-pending", published_at: CHECKED_AT }],
    ),
    {
      shorts_count: 0,
      pending_classification_count: 0,
      live_count: 1,
      pending_live_classification_count: 1,
    },
  );
});

test("classified live VODs are excluded from fetchable unmined ore", () => {
  const live = classifiedRssEntry("missing-live", 0, 0, undefined, 1);
  const result = deriveSeedFreshness(
    rawRssEntries([live]),
    [live],
    CHECKED_AT,
    [{ video_id: "stored-boundary", published_at: CHECKED_AT }],
    30,
  );
  const worker = readFileSync("src/index.ts", "utf8");

  assert.equal(result.unmined_count, 0);
  assert.equal(result.live_count, 1);
  assert.equal(result.pending_live_classification_count, 0);
  assert.equal(SEED_LIVE_CLASSIFICATION_VERSION, 1);
  assert.match(worker, /live_classification_version: SEED_LIVE_CLASSIFICATION_VERSION/);
  assert.match(worker, /live_count = excluded\.live_count/);
  assert.match(
    worker,
    /pending_live_classification_count = excluded\.pending_live_classification_count/,
  );
});

test("City Planner-shaped live window is fully mined after six VODs classify", () => {
  const liveVods = Array.from(
    { length: 6 },
    (_, index) => classifiedRssEntry(`live-vod-${index}`, 0, index, undefined, 1),
  );
  const result = deriveSeedFreshness(
    rawRssEntries(liveVods),
    liveVods,
    CHECKED_AT,
    [{ video_id: "stored-long-form", published_at: "2026-07-01T00:00:00Z" }],
    90,
  );

  assert.equal(result.unmined_count, 0);
  assert.equal(result.live_count, 6);
  assert.equal(result.pending_live_classification_count, 0);
  assert.equal(
    seedFreshnessIsFullyMined(
      result.never_mined,
      result.unmined_count,
      result.pending_classification_count,
      result.pending_live_classification_count,
      SEED_LIVE_CLASSIFICATION_VERSION,
    ),
    true,
  );
});

test("version-zero cache rows cannot qualify as fully mined", () => {
  assert.equal(seedFreshnessIsFullyMined(false, 0, 0, 0, 0), false);
  assert.equal(
    seedFreshnessIsFullyMined(false, 0, 0, 0, SEED_LIVE_CLASSIFICATION_VERSION),
    true,
  );
});

test("mixed Shorts, live VODs, and pending classifications stay out of known ore counts", () => {
  const entries = [
    classifiedRssEntry("stored-fetchable", 0, 0, undefined, 0),
    classifiedRssEntry("missing-fetchable", 0, 1, undefined, 0),
    classifiedRssEntry("missing-live", 0, 2, undefined, 1),
    pendingLiveEntry("pending-live", 3),
    classifiedRssEntry("known-short", 1, 4),
    classifiedRssEntry("pending-short", null, 5),
  ];
  const result = deriveSeedFreshness(
    rawRssEntries(entries),
    entries,
    CHECKED_AT,
    [{ video_id: "stored-fetchable", published_at: entries[0]?.published_at ?? null }],
    30,
  );

  assert.equal(result.unmined_count, 1);
  assert.equal(result.live_count, 1);
  assert.equal(result.shorts_count, 1);
  assert.equal(result.pending_classification_count, 1);
  assert.equal(result.pending_live_classification_count, 1);
  assert.equal(
    seedFreshnessIsFullyMined(
      result.never_mined,
      result.unmined_count,
      result.pending_classification_count,
      result.pending_live_classification_count,
      SEED_LIVE_CLASSIFICATION_VERSION,
    ),
    false,
  );
});

test("live-pending entries block MINED even when known fetchable ore is zero", () => {
  const pending = pendingLiveEntry("pending-live", 0);
  const result = deriveSeedFreshness(
    rawRssEntries([pending]),
    [pending],
    CHECKED_AT,
    [{ video_id: "stored-long-form", published_at: "2026-07-01T00:00:00Z" }],
    30,
  );

  assert.equal(result.unmined_count, 0);
  assert.equal(result.pending_live_classification_count, 1);
  assert.equal(
    seedFreshnessIsFullyMined(
      result.never_mined,
      result.unmined_count,
      result.pending_classification_count,
      result.pending_live_classification_count,
      SEED_LIVE_CLASSIFICATION_VERSION,
    ),
    false,
  );
});

test("RSS snapshot aggregates exclude rows not seen in the current pass", () => {
  const checkedAt = "2026-07-23T12:00:00.000Z";
  const priorCheckedAt = "2026-07-23T06:00:00.000Z";
  const entry = (
    videoId: string,
    isShort: 0 | 1 | null,
    lastSeenAt = checkedAt,
  ): PersistedSeedRssEntry => ({
    channel_id: "seed",
    video_id: videoId,
    title: videoId,
    published_at: checkedAt,
    feed_position: 0,
    is_short: isShort,
    classification_attempted_at: null,
    classified_at: isShort === null ? null : checkedAt,
    classification_error: null,
    is_live: isShort === 0 ? 0 : null,
    live_classification_attempted_at: isShort === 0 ? checkedAt : null,
    live_classified_at: isShort === 0 ? checkedAt : null,
    live_classification_error: null,
    first_seen_at: priorCheckedAt,
    last_seen_at: lastSeenAt,
  });

  assert.deepEqual(
    seedRssSnapshotAggregates([
      entry("current-short", 1),
      entry("current-long", 0),
      entry("current-pending", null),
      entry("prior-short", 1, priorCheckedAt),
      entry("prior-pending", null, priorCheckedAt),
    ], checkedAt),
    {
      shorts_count: 1,
      pending_classification_count: 1,
      live_count: 0,
      pending_live_classification_count: 0,
    },
  );
});

test("RSS entry upsert preserves first-seen and all prior classification fields", () => {
  const updateClause = SEED_RSS_ENTRY_UPSERT_SQL.split("DO UPDATE SET")[1] ?? "";

  assert.match(SEED_RSS_ENTRY_UPSERT_SQL, /first_seen_at/);
  assert.match(updateClause, /title = excluded\.title/);
  assert.match(updateClause, /published_at = excluded\.published_at/);
  assert.match(updateClause, /feed_position = excluded\.feed_position/);
  assert.match(updateClause, /last_seen_at = excluded\.last_seen_at/);
  assert.doesNotMatch(updateClause, /first_seen_at/);
  assert.doesNotMatch(updateClause, /is_short/);
  assert.doesNotMatch(updateClause, /classification_attempted_at|classified_at|classification_error/);
  assert.doesNotMatch(updateClause, /is_live|live_classification/);
});

test("six-hour cache also invalidates immediately when stored coverage changes", () => {
  const now = Date.parse("2026-07-17T12:00:00Z");
  assert.equal(
    seedFreshnessCacheIsFresh(
      "2026-07-17T07:00:00Z",
      30,
      "2026-07-16T00:00:00Z",
      30,
      "2026-07-16T00:00:00Z",
      now,
    ),
    true,
  );
  assert.equal(
    seedFreshnessCacheIsFresh(
      "2026-07-17T07:00:00Z",
      30,
      "2026-07-16T00:00:00Z",
      31,
      "2026-07-17T00:00:00Z",
      now,
    ),
    false,
  );
  assert.equal(
    seedFreshnessCacheIsFresh(
      "2026-07-17T05:59:59Z",
      30,
      "2026-07-16T00:00:00Z",
      30,
      "2026-07-16T00:00:00Z",
      now,
    ),
    false,
  );
});

test("errored freshness rows and failed refresh markers are never usable cache hits", () => {
  const now = Date.parse("2026-07-17T12:00:00Z");
  const args = [
    "2026-07-17T11:59:00Z",
    30,
    "2026-07-16T00:00:00Z",
    30,
    "2026-07-16T00:00:00Z",
    now,
  ] as const;

  assert.equal(seedFreshnessCacheIsUsable("ok", null, ...args), true);
  assert.equal(seedFreshnessCacheIsUsable("error", "RSS 500", ...args), false);
  assert.equal(seedFreshnessCacheIsUsable("ok", "RSS 500", ...args), false);
});

test("seed freshness client pacing adds bounded jitter between sequential requests", () => {
  assert.equal(seedFreshnessPacingMs(0), SEED_FRESHNESS_PACING_MIN_MS);
  assert.equal(seedFreshnessPacingMs(1), SEED_FRESHNESS_PACING_MAX_MS);
  assert.ok(seedFreshnessPacingMs(0.5) > SEED_FRESHNESS_PACING_MIN_MS);
  assert.ok(seedFreshnessPacingMs(0.5) < SEED_FRESHNESS_PACING_MAX_MS);
});

test("seed ore UI distinguishes mined, pending, lower-bound, Shorts, and live states honestly", () => {
  const simone = seedOrePresentation(uiFreshness({ shorts_count: 15 }));
  assert.equal(simone.value, "0");
  assert.equal(simone.label, "MINED");
  assert.equal(simone.note, "+15 SHORTS · NOT MINED");
  assert.equal(simone.tone, "mined");

  const cityPlanner = seedOrePresentation(uiFreshness({ live_count: 6 }));
  assert.equal(cityPlanner.value, "0");
  assert.equal(cityPlanner.label, "MINED");
  assert.equal(cityPlanner.note, "+6 LIVE · NOT MINED");
  assert.equal(cityPlanner.tone, "mined");

  assert.equal(
    seedFreshnessSecondaryNote(uiFreshness({ shorts_count: 4, live_count: 6 })),
    "+4 SHORTS · +6 LIVE · NOT MINED",
  );

  const pending = seedOrePresentation(uiFreshness({
    fully_mined: false,
    pending_classification_count: 3,
  }));
  assert.equal(pending.value, "0");
  assert.equal(pending.label, "UNMINED");
  assert.equal(pending.note, "3 PENDING CLASSIFICATION");
  assert.equal(pending.tone, "pending");

  const livePending = seedOrePresentation(uiFreshness({
    fully_mined: false,
    pending_live_classification_count: 2,
  }));
  assert.equal(livePending.value, "0");
  assert.equal(livePending.label, "UNMINED");
  assert.equal(livePending.note, "2 LIVE PENDING CLASSIFICATION");
  assert.equal(livePending.tone, "pending");

  assert.equal(
    seedOrePresentation(uiFreshness({ unmined_is_lower_bound: true })).value,
    "0",
  );
  assert.equal(
    seedOrePresentation(uiFreshness({
      fully_mined: false,
      unmined_count: 2,
      unmined_is_lower_bound: true,
    })).value,
    "2+",
  );
  assert.equal(
    seedFreshnessSecondaryNote(uiFreshness({ shorts_count: 4, pending_classification_count: 2 })),
    "+4 SHORTS · NOT MINED · 2 PENDING CLASSIFICATION",
  );
  assert.equal(
    seedFreshnessSecondaryNote(uiFreshness({
      shorts_count: 4,
      live_count: 6,
      pending_classification_count: 2,
      pending_live_classification_count: 3,
    })),
    "+4 SHORTS · +6 LIVE · NOT MINED · 2 PENDING CLASSIFICATION · 3 LIVE PENDING CLASSIFICATION",
  );
});

test("seed ore UI tooltip states the long-form RSS window caveat", () => {
  assert.match(SEED_RSS_WINDOW_TOOLTIP, /fetchable, non-live long-form uploads/);
  assert.match(SEED_RSS_WINDOW_TOOLTIP, /latest 15 RSS entries/);
  assert.match(SEED_RSS_WINDOW_TOOLTIP, /Shorts and archived live VODs are not mined/);
  assert.match(SEED_RSS_WINDOW_TOOLTIP, /older fetchable uploads may sit outside visibility/);
});

test("freshness migration adds a dependent cache table without rebuilding channels", () => {
  const migration = readFileSync("migrations/0022_seed_mining_freshness.sql", "utf8");

  assert.match(migration, /CREATE TABLE IF NOT EXISTS seed_mining_freshness/);
  assert.match(migration, /REFERENCES channels\(channel_id\) ON DELETE CASCADE/);
  assert.doesNotMatch(migration, /ALTER TABLE channels|DROP TABLE channels|RENAME TO channels/);
});

test("freshness route is RSS-only and remains available to locked seeds", () => {
  const worker = readFileSync("src/index.ts", "utf8");
  const app = readFileSync("ui/src/App.tsx", "utf8");
  const api = readFileSync("ui/src/api.ts", "utf8");
  const seedFreshnessUi = readFileSync("ui/src/seed-freshness.ts", "utf8");
  const handler = worker.match(
    /async function refreshSeedFreshness[\s\S]*?async function seedStoredVideoStats/,
  )?.[0] ?? "";

  assert.match(worker, /seedFreshnessMatch = url\.pathname\.match/);
  assert.match(handler, /fetchYouTubeRssUploads/);
  assert.doesNotMatch(handler, /FROM videos[\s\S]*?LIMIT 100/);
  assert.doesNotMatch(handler, /ScrapeCreatorsClient|requireUnlockedSeed/);
  assert.match(api, /refreshSeedFreshness\(channelId: string, force = false\)/);
  assert.match(api, /shorts_count: number;/);
  assert.match(api, /pending_classification_count: number;/);
  assert.match(api, /live_count: number;/);
  assert.match(api, /pending_live_classification_count: number;/);
  assert.match(api, /fully_mined: boolean;/);
  assert.match(worker, /freshness\.shorts_count AS freshness_shorts_count/);
  assert.match(
    worker,
    /freshness\.pending_classification_count AS freshness_pending_classification_count/,
  );
  assert.match(worker, /freshness\.live_count AS freshness_live_count/);
  assert.match(
    worker,
    /freshness\.pending_live_classification_count AS freshness_pending_live_classification_count/,
  );
  assert.match(
    worker,
    /freshness\.live_classification_version AS freshness_live_classification_version/,
  );
  assert.match(worker, /fully_mined: seedFreshnessIsFullyMined/);
  assert.match(app, /Check freshness/);
  assert.match(app, /15\+|unmined_is_lower_bound/);
  assert.doesNotMatch(app, /Includes Shorts|upload ore, not a channel count/);
  assert.match(app, /import \{ seedFreshnessPacingMs, seedOrePresentation \} from "\.\/seed-freshness"/);
  assert.match(app, /seedOrePresentation\(freshness\)/);
  assert.match(app, /Unmined desc/);
  assert.match(seedFreshnessUi, /NEVER MINED/);
  assert.match(app, /seedFreshnessPacingMs/);
  assert.match(app, /freshnessQueueRef/);
  assert.match(app, /freshness\.error/);
  assert.match(seedFreshnessUi, /· STALE/);
});

test("individual seed expansion reloads its row so freshness updates", () => {
  const app = readFileSync("ui/src/App.tsx", "utf8");
  const individualExpand = app.match(
    /const result = await api\.expandSeed\(channelId, maxPages, maxResolves\);[\s\S]*?onChanged\(\);/,
  )?.[0] ?? "";

  assert.match(individualExpand, /setSummary\(result\);/);
  assert.match(individualExpand, /setDialogSeed\(null\);/);
  assert.match(individualExpand, /await load\(\);/);
  assert.ok(individualExpand.indexOf("await load();") < individualExpand.indexOf("onChanged();"));
});
