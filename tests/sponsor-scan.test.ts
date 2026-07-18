import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Env } from "../src/lib/scrapecreators.js";
import {
  enrichVideosWithSponsorBlock,
  getRecentVideoIds,
  mergeSponsorVideoCoverage,
  parseYouTubeVideoFeed,
  RecentVideosError,
  sponsorCoverageLabel,
  sponsorBlockTotalDurationSeconds,
} from "../src/lib/sponsor-scan.js";

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015">
  <entry>
    <yt:videoId>abc123</yt:videoId>
    <title>Carne Asada &amp; Salsa Roja</title>
    <published>2026-07-01T12:00:00+00:00</published>
  </entry>
  <entry>
    <yt:videoId>def456</yt:videoId>
    <title>Smoked Brisket Burnt Ends</title>
    <published>2026-06-20T12:00:00+00:00</published>
  </entry>
</feed>`;

test("parses YouTube RSS video ids, titles, and publish dates", () => {
  const videos = parseYouTubeVideoFeed(FEED);

  assert.deepEqual(videos, [
    {
      video_id: "abc123",
      video_title: "Carne Asada & Salsa Roja",
      published_at: "2026-07-01T12:00:00+00:00",
    },
    {
      video_id: "def456",
      video_title: "Smoked Brisket Burnt Ends",
      published_at: "2026-06-20T12:00:00+00:00",
    },
  ]);
});

test("uses stored videos when at least five are available", async () => {
  const env = mockEnv([
    { video_id: "v1", video_title: "One", published_at: "2026-07-01T00:00:00Z" },
    { video_id: "v2", video_title: "Two", published_at: "2026-06-01T00:00:00Z" },
    { video_id: "v3", video_title: "Three", published_at: "2026-05-01T00:00:00Z" },
    { video_id: "v4", video_title: "Four", published_at: "2026-04-01T00:00:00Z" },
    { video_id: "v5", video_title: "Five", published_at: "2026-03-01T00:00:00Z" },
  ]);
  let fetched = false;

  const result = await getRecentVideoIds(env, "channel", 15, async () => {
    fetched = true;
    return new Response(FEED);
  });

  assert.equal(result.source, "stored");
  assert.equal(result.videos.length, 5);
  assert.equal(fetched, false);
});

test("falls back to RSS and throws loudly on empty feed", async () => {
  const env = mockEnv([]);

  await assert.rejects(
    () =>
      getRecentVideoIds(
        env,
        "channel",
        15,
        async () => new Response("<feed></feed>"),
      ),
    RecentVideosError,
  );
});

test("SponsorBlock enrichment maps 200, 404, and errors without inventing no-sponsor proof", async () => {
  const result = await enrichVideosWithSponsorBlock(
    [
      { video_id: "sponsored", video_title: "Sponsored", published_at: "2026-07-01T00:00:00Z" },
      { video_id: "unknown", video_title: "Unknown", published_at: "2026-07-02T00:00:00Z" },
      { video_id: "error", video_title: "Error", published_at: "2026-07-03T00:00:00Z" },
    ],
    async (url) => {
      const videoId = new URL(String(url)).searchParams.get("videoID");
      if (videoId === "sponsored") {
        return Response.json([{ segment: [10, 25], category: "sponsor" }]);
      }
      if (videoId === "unknown") {
        return new Response("Not found", { status: 404 });
      }
      return new Response("Nope", { status: 503 });
    },
  );

  assert.equal(result[0].sponsorblock_has_sponsor, 1);
  assert.equal(sponsorBlockTotalDurationSeconds(result[0].sponsorblock_segments_json), 15);
  assert.equal(result[1].sponsorblock_has_sponsor, 0);
  assert.equal(result[1].sponsorblock_segments_json, null);
  assert.equal(result[2].sponsorblock_has_sponsor, null);
  assert.match(result[2].error ?? "", /503/);
});

test("SponsorBlock enrichment caps concurrency at five requests", async () => {
  let active = 0;
  let maxActive = 0;
  const videos = Array.from({ length: 12 }, (_, index) => ({
    video_id: `video-${index}`,
    video_title: `Video ${index}`,
    published_at: null,
  }));

  const result = await enrichVideosWithSponsorBlock(videos, async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return new Response("Not found", { status: 404 });
  });

  assert.equal(result.length, 12);
  assert.equal(result.every((video) => video.sponsorblock_has_sponsor === 0), true);
  assert.equal(maxActive <= 5, true);
});

test("deep sponsor coverage cannot become narrower than the prior recent scan", () => {
  const prior = Array.from({ length: 15 }, (_, index) => ({
    video_id: `recent-${index}`,
    video_title: `Recent ${index}`,
    published_at: new Date(Date.UTC(2026, 6 - index, 1)).toISOString(),
  }));
  const deepPage = prior.slice(0, 10).map((video) => ({ ...video }));

  const merged = mergeSponsorVideoCoverage(prior, deepPage);

  assert.equal(merged.length, 15);
  assert.equal(new Set(merged.map((video) => video.video_id)).size, 15);
  assert.equal(merged.some((video) => video.video_id === "recent-14"), true);
});

test("deep sponsor coverage adds new page videos and reports the real span", () => {
  const merged = mergeSponsorVideoCoverage(
    [{ video_id: "older", video_title: "Older", published_at: "2025-01-04T00:00:00Z" }],
    [{ video_id: "newer", video_title: "Newer", published_at: "2026-07-03T00:00:00Z" }],
  );

  assert.deepEqual(merged.map((video) => video.video_id), ["newer", "older"]);
  assert.equal(
    sponsorCoverageLabel(merged, Date.parse("2026-07-13T00:00:00Z")),
    "2 videos / 19 months",
  );
});

test("sponsor scan migration creates video_scans table and indexes", () => {
  const migration = readFileSync("migrations/0018_sponsor_scan.sql", "utf8");

  assert.match(migration, /CREATE TABLE IF NOT EXISTS video_scans/);
  assert.match(migration, /sponsorblock_has_sponsor INTEGER/);
  assert.match(migration, /idx_video_scans_channel_scanned_at/);
});

test("frontend exposes sponsor scan action, modal, and result chip", () => {
  const app = readFileSync("ui/src/App.tsx", "utf8");
  const api = readFileSync("ui/src/api.ts", "utf8");
  const styles = readFileSync("ui/src/styles.css", "utf8");
  const worker = readFileSync("src/index.ts", "utf8");

  assert.match(api, /sponsorScan\(channelId: string\)/);
  assert.match(api, /sponsorScanDeepHistory\(channelId: string\)/);
  assert.match(api, /sponsorship_rate: number \| null/);
  assert.match(api, /last_sponsored_date: string \| null/);
  assert.match(api, /sponsor_scan_scanned_at: string \| null/);
  assert.match(app, /Scan sponsors/);
  assert.match(app, /AUTO-SCAN/);
  assert.match(app, /autoScanArrivals/);
  assert.match(app, /Deep history \(1 credit\)/);
  assert.match(app, /Open \{sponsoredVideos\.length\} sponsored/);
  assert.match(app, /window\.confirm\(`Open \$\{sponsoredVideos\.length\} sponsored videos in new tabs\?`\)/);
  assert.match(app, /window\.open\("about:blank", "_blank"\)/);
  assert.match(app, /opened\.opener = null/);
  assert.match(app, /setBlockedSponsoredUrls\(blocked\)/);
  assert.match(app, /scan-open-fallback/);
  assert.match(app, /rel="noopener noreferrer"/);
  assert.match(app, /SponsorScanDialog/);
  assert.match(app, /sponsorStatsForCard/);
  assert.match(app, /sponsorStatsFromRollup\(brand\)/);
  assert.match(app, /label="sponsors"/);
  assert.match(app, /sponsor_scan_scanned_at && channel\.sponsorship_rate !== null/);
  assert.match(app, /type SponsorCardState = "found" \| "none" \| "unscanned"/);
  assert.match(app, /return "NONE FOUND \(SB\)"/);
  assert.match(app, /return "\?"/);
  assert.match(app, /function compactSponsorStatValue[\s\S]*?state === "none"\) return "\\u2014";[\s\S]*?return "\?";/);
  assert.match(app, /Absence is not proof of no sponsors/);
  assert.match(app, /No sponsor scan batch exists yet/);
  assert.match(app, /muted-stat/);
  assert.match(app, /No signals found\. Unconfirmed, not unsponsored/);
  assert.match(worker, /sponsorRollupMapForChannels/);
  assert.match(worker, /sponsorScanDeepHistory/);
  assert.match(worker, /DEEP_SPONSOR_SCAN_VIDEO_CAP = 45/);
  assert.match(worker, /latestDistinctSponsorScanVideos/);
  assert.match(worker, /mergeSponsorVideoCoverage/);
  assert.match(worker, /sponsorshipRate/);
  assert.match(styles, /\.sponsor-dialog/);
  assert.match(styles, /\.scan-open-fallback/);
  assert.match(styles, /\.stat-block/);
  assert.match(styles, /\.stat-block\.sponsor-none strong/);
}
);

test("channel list payloads include persisted sponsor rollup fields from video_scans", () => {
  const worker = readFileSync("src/index.ts", "utf8");

  assert.match(worker, /function sponsorRollupFields/);
  assert.match(worker, /sponsor_scan_total: total/);
  assert.match(worker, /sponsor_scan_sponsored: sponsored/);
  assert.match(worker, /sponsorship_rate: rate/);
  assert.match(worker, /sponsor_scan_scanned_at: scannedAt/);
  assert.match(worker, /results\.map\(\(row\) => \(\{[\s\S]*sponsorRollupFields\(sponsorRollups\.get\(row\.channel_id\)\)/);
  assert.match(worker, /async function brands[\s\S]*sponsor_rollups[\s\S]*sponsorRollupFields/);
});

function mockEnv(
  videos: Array<{ video_id: string; video_title: string; published_at: string | null }>,
): Env {
  return {
    SCOUT_DB: {
      prepare() {
        return {
          bind() {
            return {
              async all() {
                return { results: videos };
              },
            };
          },
        };
      },
    },
    SCRAPECREATORS_API_KEY: "",
    SCOUT_ADMIN_KEY: "",
  } as unknown as Env;
}
