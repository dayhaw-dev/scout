import {
  Env,
  ScrapeCreatorsApiError,
  ScrapeCreatorsChannel,
  ScrapeCreatorsClient,
  ScrapeCreatorsSearch,
  ScrapeCreatorsSearchUploadDate,
  ScrapeCreatorsVideoListItem,
} from "./lib/scrapecreators";
import {
  ChannelKind,
  Classification,
  classifyChannel,
  extractLinks,
  parseRaw,
  SeedIdentity,
} from "./lib/classify";
import { ChannelRef, mineChannelRefs } from "./lib/mine";
import { normalizeSearchChannelRefs, SearchChannelRef } from "./lib/search-normalize";
import { scoreChannel, ScoreResult } from "./lib/score";
import {
  normalizeSuggestionTerm,
  seedSuggestionTerms,
  SuggestionSeed,
} from "./lib/suggestions";
import {
  AnthropicClient,
  AnthropicQueryResult,
  SeedQueryPrompt,
} from "./lib/anthropic";
import {
  mineSeedTitlePhrases,
  TitleMiningSeed,
} from "./lib/title-miner";
import { normalizeUnicodeText, parseCountText, parseJoinedDate } from "./lib/text";
import {
  AUTH_FAILURE_DELAY_MS,
  evaluateAdminAuth,
} from "./lib/auth";
import { ENRICH_CONFIG, QUALITY_GATE_CONFIG } from "./lib/config";
import { activityMetrics } from "./lib/activity";
import { dormantChannelReason, searchQualityGateReason } from "./lib/quality";
import {
  shortlistStageClause,
  StageSeedFilter,
} from "./lib/stage-query";
import { computeGrowthMetrics, GrowthMetrics, SnapshotPoint } from "./lib/growth";
import { planSnapshotRun, SNAPSHOT_CONFIG, SnapshotTargetState } from "./lib/snapshots";
import { sanitizedContactLinks } from "./lib/links";
import {
  enrichVideosWithSponsorBlock,
  getRecentVideoIds,
  mergeSponsorVideoCoverage,
  RecentVideosError,
  sponsorCoverageLabel,
  sponsorBlockTotalDurationSeconds,
  SponsorBlockVideoScan,
} from "./lib/sponsor-scan";
import {
  planSnoozeTransition,
  SnoozeValidationError,
} from "./lib/snooze";
import {
  hasExplicitEmptySeedTargets,
  MIN_SEED_QUERY_VIDEOS,
} from "./lib/seed-targets";
import {
  deriveSeedFreshness,
  fetchYouTubeRssUploads,
  seedFreshnessCacheIsUsable,
  StoredSeedVideo,
} from "./lib/seed-freshness";
import {
  CLOSED_OUTREACH_STATUSES,
  LIVE_OUTREACH_STATUSES,
  OUTREACH_STATUSES,
  outreachSqlList,
  OutreachStatus,
} from "./lib/outreach";

type ChannelStatus = "candidate" | "shortlisted" | "watchlist" | "snoozed" | "rejected";
type DiscoveredVia = "manual" | "mention" | "collab" | "search";
type ShortlistDiscoveryFilter = "mention" | "collab" | "search";
type ShortlistStatusFilter = ChannelStatus | "all";
type SeedFreshnessStatus = "ok" | "empty" | "error";

const SEARCH_FAILED_REF_SOURCE = "__search__";
const SNAPSHOT_JOB_KIND = "snapshot";

const VALID_STATUSES = new Set<ChannelStatus>([
  "candidate",
  "shortlisted",
  "watchlist",
  "snoozed",
  "rejected",
]);

const VALID_OUTREACH_STATUSES = new Set<OutreachStatus>(OUTREACH_STATUSES);
const LIVE_OUTREACH_SQL = outreachSqlList(LIVE_OUTREACH_STATUSES);
const CLOSED_OUTREACH_SQL = outreachSqlList(CLOSED_OUTREACH_STATUSES);

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: https://yt3.googleusercontent.com https://i.ytimg.com",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const SECURITY_HEADERS: Record<string, string> = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      const expandMatch = url.pathname.match(/^\/api\/seeds\/([^/]+)\/expand$/);
      const seedFreshnessMatch = url.pathname.match(/^\/api\/seeds\/([^/]+)\/freshness$/);
      const patchChannelMatch = url.pathname.match(/^\/api\/channels\/([^/]+)$/);
      const outreachChannelMatch = url.pathname.match(/^\/api\/channels\/([^/]+)\/outreach$/);
      const sponsorScanMatch = url.pathname.match(/^\/api\/channels\/([^/]+)\/sponsor-scan$/);
      const sponsorScanDeepMatch = url.pathname.match(/^\/api\/channels\/([^/]+)\/sponsor-scan\/deep-history$/);

      if (url.pathname === "/api/seeds" && request.method === "POST") {
        const auth = await requireAdmin(request, env);
        if (auth) return auth;
        return createSeed(request, env);
      }

      if (url.pathname === "/api/seeds/expand-all" && request.method === "POST") {
        const auth = await requireAdmin(request, env);
        if (auth) return auth;
        return expandAllSeeds();
      }

      if (seedFreshnessMatch && request.method === "POST") {
        const auth = await requireAdmin(request, env);
        if (auth) return auth;
        return await refreshSeedFreshness(
          decodeURIComponent(seedFreshnessMatch[1]),
          request,
          env,
        );
      }

      if (url.pathname === "/api/channels" && request.method === "GET") {
        const auth = await requireAdmin(request, env);
        if (auth) return auth;
        return listChannels(url, env);
      }

      if (url.pathname === "/api/admin/classify-all" && request.method === "POST") {
        const auth = await requireAdmin(request, env);
        if (auth) return auth;
        return classifyAll(env);
      }

      if (url.pathname === "/api/admin/score-all" && request.method === "POST") {
        const auth = await requireAdmin(request, env);
        if (auth) return auth;
        return scoreAll(env);
      }

      if (url.pathname === "/api/admin/enrich" && request.method === "POST") {
        const auth = await requireAdmin(request, env);
        if (auth) return auth;
        return enrich(request, env);
      }

      if (url.pathname === "/api/admin/snapshot" && request.method === "POST") {
        const auth = await requireAdmin(request, env);
        if (auth) return auth;
        return snapshotNow(request, env);
      }

      if (url.pathname === "/api/admin/mine-queries" && request.method === "POST") {
        const auth = await requireAdmin(request, env);
        if (auth) return auth;
        return await mineQueries(request, env);
      }

      if (url.pathname === "/api/admin/mine-queries/plan" && request.method === "GET") {
        const auth = await requireAdmin(request, env);
        if (auth) return auth;
        return await mineQueriesPlan(env);
      }

      if (url.pathname === "/api/admin/repair-yields" && request.method === "POST") {
        const auth = await requireAdmin(request, env);
        if (auth) return auth;
        return repairYields(env);
      }

      if (url.pathname === "/api/discover/search" && request.method === "POST") {
        const auth = await requireAdmin(request, env);
        if (auth) return auth;
        return discoverSearch(request, env);
      }

      if (url.pathname === "/api/discover/search-batch" && request.method === "POST") {
        const auth = await requireAdmin(request, env);
        if (auth) return auth;
        return discoverSearchBatch(request, env);
      }

      if (url.pathname === "/api/searches" && request.method === "GET") {
        const auth = await requireAdmin(request, env);
        if (auth) return auth;
        return listSearches(env);
      }

      if (url.pathname === "/api/search/deep-variants" && request.method === "POST") {
        const auth = await requireAdmin(request, env);
        if (auth) return auth;
        return deepSearchVariants(request, env);
      }

      if (url.pathname === "/api/search/suggestions/blocklist" && request.method === "POST") {
        const auth = await requireAdmin(request, env);
        if (auth) return auth;
        return blockSearchSuggestion(request, env);
      }

      if (url.pathname === "/api/search/suggestions" && request.method === "GET") {
        const auth = await requireAdmin(request, env);
        if (auth) return auth;
        return searchSuggestions(env);
      }

      if (url.pathname === "/api/status" && request.method === "GET") {
        const auth = await requireAdmin(request, env);
        if (auth) return auth;
        return status(env);
      }

      if (url.pathname === "/api/shortlist" && request.method === "GET") {
        const auth = await requireAdmin(request, env);
        if (auth) return auth;
        return shortlist(url, env);
      }

      if (url.pathname === "/api/brands" && request.method === "GET") {
        const auth = await requireAdmin(request, env);
        if (auth) return auth;
        return brands(env);
      }

      if (url.pathname === "/api/outreach" && request.method === "GET") {
        const auth = await requireAdmin(request, env);
        if (auth) return auth;
        return outreach(env);
      }

      if (outreachChannelMatch && request.method === "POST") {
        const auth = await requireAdmin(request, env);
        if (auth) return auth;
        return await logOutreach(decodeURIComponent(outreachChannelMatch[1]), request, env);
      }

      if (sponsorScanMatch && request.method === "POST") {
        const auth = await requireAdmin(request, env);
        if (auth) return auth;
        return sponsorScan(decodeURIComponent(sponsorScanMatch[1]), env);
      }

      if (sponsorScanDeepMatch && request.method === "POST") {
        const auth = await requireAdmin(request, env);
        if (auth) return auth;
        return sponsorScanDeepHistory(decodeURIComponent(sponsorScanDeepMatch[1]), env);
      }

      if (patchChannelMatch && request.method === "PATCH") {
        const auth = await requireAdmin(request, env);
        if (auth) return auth;
        return await patchChannel(decodeURIComponent(patchChannelMatch[1]), request, env);
      }

      if (expandMatch && request.method === "POST") {
        const auth = await requireAdmin(request, env);
        if (auth) return auth;
        return await expandSeed(decodeURIComponent(expandMatch[1]), request, env);
      }

      if (!url.pathname.startsWith("/api/")) {
        return assetResponse(request, env);
      }

      return json({ error: "Not found" }, 404);
    } catch (error) {
      if (error instanceof ScrapeCreatorsApiError) {
        return json(
          {
            error: error.kind,
            message: error.message,
            endpoint: error.endpoint,
          },
          error.status,
        );
      }

      if (error instanceof ResponseError) {
        return json({ error: error.message }, error.status);
      }

      return json(
        {
          error: "internal_error",
          message: error instanceof Error ? error.message : "Unknown error",
        },
        500,
      );
    }
  },

  async scheduled(
    _controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    await wakeDueSnoozed(env);
    await runSnapshotJob(env, `${SNAPSHOT_JOB_KIND}:watchlist:cron`, new Date(), {
      scope: "watchlist",
      includeSnoozed: true,
    });
  },
};

async function createSeed(request: Request, env: Env): Promise<Response> {
  const body = await parseJson<{ handle?: unknown }>(request);
  const handle = typeof body.handle === "string" ? body.handle.trim() : "";

  if (!handle) {
    return json({ error: "handle is required" }, 400);
  }

  const client = new ScrapeCreatorsClient(env);
  const channel = await client.getChannel(handle);

  if (!channel.channelId) {
    return json(
      {
        error: "invalid_scrapecreators_response",
        message: "Channel response did not include channelId.",
      },
      502,
    );
  }

  await upsertSeedChannel(env, channel);
  await computeSeedTopics(env, [channel.channelId]);
  const stored = await getChannel(env, channel.channelId);

  return json(stored, 201);
}

async function listChannels(url: URL, env: Env): Promise<Response> {
  await wakeDueSnoozed(env);
  const requestedStatus = url.searchParams.get("status") ?? "seed";
  const isSeed = url.searchParams.get("is_seed");

  if (requestedStatus === "seed" || isSeed === "1") {
    const { results } = await env.SCOUT_DB.prepare(
      `SELECT
        c.*,
        (
          SELECT COUNT(*)
          FROM channels resolved
          WHERE resolved.source_channel_id = c.channel_id
        ) AS yield_count,
        COALESCE(video_stats.stored_video_count, 0) AS current_stored_video_count,
        video_stats.newest_stored_video_at AS current_newest_stored_video_at,
        freshness.latest_upload_at AS freshness_latest_upload_at,
        freshness.newest_stored_video_at AS freshness_newest_stored_video_at,
        freshness.stored_video_count AS freshness_stored_video_count,
        freshness.unmined_count AS freshness_unmined_count,
        freshness.unmined_is_lower_bound AS freshness_unmined_is_lower_bound,
        freshness.never_mined AS freshness_never_mined,
        freshness.rss_entry_count AS freshness_rss_entry_count,
        freshness.status AS freshness_status,
        freshness.error AS freshness_error,
        freshness.checked_at AS freshness_checked_at
      FROM channels c
      LEFT JOIN (
        SELECT
          channel_id,
          COUNT(*) AS stored_video_count,
          MAX(published_at) AS newest_stored_video_at
        FROM videos
        GROUP BY channel_id
      ) video_stats ON video_stats.channel_id = c.channel_id
      LEFT JOIN seed_mining_freshness freshness
        ON freshness.channel_id = c.channel_id
      WHERE c.is_seed = 1
      ORDER BY yield_count DESC, c.created_at DESC
      LIMIT 100`,
    ).all<SeedListRow>();
    const growth = await growthMapForChannels(env, results.map((row) => row.channel_id));
    const queryPhrases = await storedSeedQueryPhraseMap(env, results.map((row) => row.channel_id));
    const sponsorRollups = await sponsorRollupMapForChannels(env, results.map((row) => row.channel_id));

    return json({
      channels: results.map((row) => ({
        ...row,
        is_seed: row.is_seed === 1,
        seed_locked: row.seed_locked === 1,
        is_active: row.is_active === 1,
        outreach_status: row.outreach_stage,
        ...growthFields(growth.get(row.channel_id)),
        ...sponsorRollupFields(sponsorRollups.get(row.channel_id)),
        query_phrases: queryPhrases.get(row.channel_id) ?? [],
        mining_freshness: seedFreshnessView(row),
      })),
    });
  }

  if (!VALID_STATUSES.has(requestedStatus as ChannelStatus)) {
    return json({ error: "Invalid status" }, 400);
  }

  const { results } = await env.SCOUT_DB.prepare(
    "SELECT * FROM channels WHERE status = ? ORDER BY created_at DESC LIMIT 100",
  )
    .bind(requestedStatus)
    .all<ChannelRow>();
  const growth = await growthMapForChannels(env, results.map((row) => row.channel_id));
  const sponsorRollups = await sponsorRollupMapForChannels(env, results.map((row) => row.channel_id));

  return json({
    channels: results.map((row) => ({
      ...row,
      is_seed: row.is_seed === 1,
      seed_locked: row.seed_locked === 1,
      is_active: row.is_active === 1,
      outreach_status: row.outreach_stage,
      ...growthFields(growth.get(row.channel_id)),
      ...sponsorRollupFields(sponsorRollups.get(row.channel_id)),
    })),
  });
}

async function refreshSeedFreshness(
  channelId: string,
  request: Request,
  env: Env,
): Promise<Response> {
  const seed = await env.SCOUT_DB.prepare(
    "SELECT channel_id FROM channels WHERE channel_id = ? AND is_seed = 1",
  )
    .bind(channelId)
    .first<{ channel_id: string }>();
  if (!seed) throw new ResponseError("Seed channel not found.", 404);

  const body = await parseOptionalJson<{ force?: unknown }>(request);
  if (body.force !== undefined && typeof body.force !== "boolean") {
    throw new ResponseError("force must be a boolean.", 400);
  }
  const force = body.force === true;

  const stats = await seedStoredVideoStats(env, channelId);
  const cached = await env.SCOUT_DB.prepare(
    "SELECT * FROM seed_mining_freshness WHERE channel_id = ?",
  )
    .bind(channelId)
    .first<SeedFreshnessCacheRow>();
  const cachedGood = cached?.status !== "error" ? cached : null;

  if (
    cachedGood
    && !force
    && seedFreshnessCacheIsUsable(
      cachedGood.status,
      cachedGood.error,
      cachedGood.checked_at,
      cachedGood.stored_video_count,
      cachedGood.newest_stored_video_at,
      stats.stored_video_count,
      stats.newest_stored_video_at,
    )
  ) {
    return json({ ...seedFreshnessPayload(cachedGood), cached: true });
  }

  const stored = await env.SCOUT_DB.prepare(
    `SELECT video_id, published_at
    FROM videos
    WHERE channel_id = ?
    ORDER BY
      CASE WHEN published_at IS NULL THEN 1 ELSE 0 END,
      datetime(published_at) DESC,
      created_at DESC
    LIMIT 100`,
  )
    .bind(channelId)
    .all<StoredSeedVideo>();

  const checkedAt = new Date().toISOString();
  let row: SeedFreshnessCacheRow;
  try {
    const rssEntries = await fetchYouTubeRssUploads(channelId);
    const derived = deriveSeedFreshness(
      rssEntries,
      stored.results,
      stats.stored_video_count,
    );
    row = {
      channel_id: channelId,
      ...derived,
      unmined_is_lower_bound: derived.unmined_is_lower_bound ? 1 : 0,
      never_mined: derived.never_mined ? 1 : 0,
      status: rssEntries.length === 0 ? "empty" : "ok",
      error: null,
      checked_at: checkedAt,
    };
  } catch (error) {
    const failureMessage = errorMessage(error);
    if (cachedGood) {
      await env.SCOUT_DB.prepare(
        `UPDATE seed_mining_freshness
        SET error = ?
        WHERE channel_id = ?`,
      )
        .bind(failureMessage, channelId)
        .run();
      return json({
        ...seedFreshnessPayload({ ...cachedGood, error: failureMessage }),
        stale: true,
        cached: true,
      });
    }

    if (cached) {
      await env.SCOUT_DB.prepare(
        "DELETE FROM seed_mining_freshness WHERE channel_id = ?",
      )
        .bind(channelId)
        .run();
    }
    const errorRow: SeedFreshnessCacheRow = {
      channel_id: channelId,
      latest_upload_at: null,
      newest_stored_video_at: stats.newest_stored_video_at,
      stored_video_count: stats.stored_video_count,
      unmined_count: null,
      unmined_is_lower_bound: 0,
      never_mined: stats.stored_video_count === 0 ? 1 : 0,
      rss_entry_count: 0,
      status: "error",
      error: failureMessage,
      checked_at: checkedAt,
    };
    return json({
      ...seedFreshnessPayload(errorRow),
      stale: true,
      cached: false,
    });
  }

  await env.SCOUT_DB.prepare(
    `INSERT INTO seed_mining_freshness (
      channel_id,
      latest_upload_at,
      newest_stored_video_at,
      stored_video_count,
      unmined_count,
      unmined_is_lower_bound,
      never_mined,
      rss_entry_count,
      status,
      error,
      checked_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(channel_id) DO UPDATE SET
      latest_upload_at = excluded.latest_upload_at,
      newest_stored_video_at = excluded.newest_stored_video_at,
      stored_video_count = excluded.stored_video_count,
      unmined_count = excluded.unmined_count,
      unmined_is_lower_bound = excluded.unmined_is_lower_bound,
      never_mined = excluded.never_mined,
      rss_entry_count = excluded.rss_entry_count,
      status = excluded.status,
      error = excluded.error,
      checked_at = excluded.checked_at`,
  )
    .bind(
      row.channel_id,
      row.latest_upload_at,
      row.newest_stored_video_at,
      row.stored_video_count,
      row.unmined_count,
      row.unmined_is_lower_bound,
      row.never_mined,
      row.rss_entry_count,
      row.status,
      row.error,
      row.checked_at,
    )
    .run();

  return json({ ...seedFreshnessPayload(row), cached: false });
}

async function seedStoredVideoStats(
  env: Env,
  channelId: string,
): Promise<SeedStoredVideoStats> {
  const row = await env.SCOUT_DB.prepare(
    `SELECT
      COUNT(*) AS stored_video_count,
      MAX(published_at) AS newest_stored_video_at
    FROM videos
    WHERE channel_id = ?`,
  )
    .bind(channelId)
    .first<SeedStoredVideoStats>();
  return {
    stored_video_count: Number(row?.stored_video_count ?? 0),
    newest_stored_video_at: row?.newest_stored_video_at ?? null,
  };
}

function seedFreshnessPayload(row: SeedFreshnessCacheRow): SeedFreshnessView {
  return {
    latest_upload_at: row.latest_upload_at,
    newest_stored_video_at: row.newest_stored_video_at,
    stored_video_count: Number(row.stored_video_count),
    unmined_count: row.unmined_count === null ? null : Number(row.unmined_count),
    unmined_is_lower_bound: row.unmined_is_lower_bound === 1,
    never_mined: row.never_mined === 1,
    rss_entry_count: Number(row.rss_entry_count),
    status: row.status,
    error: row.error,
    checked_at: row.checked_at,
    stale: false,
  };
}

function seedFreshnessView(row: SeedListRow): SeedFreshnessView | null {
  if (!row.freshness_checked_at || !row.freshness_status) return null;
  const cached: SeedFreshnessCacheRow = {
    channel_id: row.channel_id,
    latest_upload_at: row.freshness_latest_upload_at,
    newest_stored_video_at: row.freshness_newest_stored_video_at,
    stored_video_count: Number(row.freshness_stored_video_count ?? 0),
    unmined_count: row.freshness_unmined_count,
    unmined_is_lower_bound: Number(row.freshness_unmined_is_lower_bound ?? 0),
    never_mined: Number(row.freshness_never_mined ?? 0),
    rss_entry_count: Number(row.freshness_rss_entry_count ?? 0),
    status: row.freshness_status,
    error: row.freshness_error,
    checked_at: row.freshness_checked_at,
  };
  return {
    ...seedFreshnessPayload(cached),
    stale: !seedFreshnessCacheIsUsable(
      cached.status,
      cached.error,
      cached.checked_at,
      cached.stored_video_count,
      cached.newest_stored_video_at,
      Number(row.current_stored_video_count),
      row.current_newest_stored_video_at,
    ),
  };
}

async function classifyAll(env: Env): Promise<Response> {
  const creditsBefore = await totalCreditsUsed(env);
  const seeds = await seedIdentities(env);
  const { results } = await env.SCOUT_DB.prepare(
    "SELECT * FROM channels WHERE kind_locked = 0",
  ).all<ChannelRow>();
  const distribution = initialDistribution();

  for (const row of results) {
    const classification = classifyChannel(row, seeds);
    distribution[classification.kind] += 1;
    await env.SCOUT_DB.prepare(
      `UPDATE channels
      SET kind = ?, kind_reason = ?, updated_at = CURRENT_TIMESTAMP
      WHERE channel_id = ? AND kind_locked = 0`,
    )
      .bind(classification.kind, classification.reason, row.channel_id)
      .run();
  }

  const creditsAfter = await totalCreditsUsed(env);

  return json({
    classified: results.length,
    distribution,
    credits_spent_this_run: creditsAfter - creditsBefore,
  });
}

async function scoreAll(env: Env): Promise<Response> {
  const creditsBefore = await totalCreditsUsed(env);
  const { results } = await env.SCOUT_DB.prepare("SELECT * FROM channels").all<ChannelRow>();
  let scored = 0;
  let nulled = 0;

  for (const row of results) {
    const scoring = scoreFromRow(row);
    if (scoring.score === null) nulled += 1;
    else scored += 1;

    await env.SCOUT_DB.prepare(
      `UPDATE channels
      SET score = ?, score_breakdown = ?, updated_at = CURRENT_TIMESTAMP
      WHERE channel_id = ?`,
    )
      .bind(
        scoring.score,
        scoring.breakdown ? JSON.stringify(scoring.breakdown) : null,
        row.channel_id,
      )
      .run();
  }

  const creditsAfter = await totalCreditsUsed(env);

  return json({
    scored,
    score_null: nulled,
    credits_spent_this_run: creditsAfter - creditsBefore,
  });
}

async function patchChannel(
  channelId: string,
  request: Request,
  env: Env,
): Promise<Response> {
  const existing = await requireMutableChannel(env, channelId);

  const body = await parseJson<{
    kind?: unknown;
    status?: unknown;
    is_seed?: unknown;
    is_active?: unknown;
    email_confirmed?: unknown;
    snoozed_until?: unknown;
    snooze_reason?: unknown;
  }>(request);
  const updates: string[] = [];
  const bindings: unknown[] = [];
  let nextKind = existing.kind;
  let nextEmailConfirmed = existing.email_confirmed === 1;
  let snoozeTransition;

  try {
    snoozeTransition = planSnoozeTransition(existing, body);
  } catch (error) {
    if (error instanceof SnoozeValidationError) {
      return json({ error: error.message }, 400);
    }
    throw error;
  }

  if (body.kind !== undefined) {
    if (!isChannelKind(body.kind)) {
      return json({ error: "Invalid kind" }, 400);
    }
    nextKind = body.kind;
    updates.push("kind = ?", "kind_reason = ?", "kind_locked = 1");
    bindings.push(body.kind, "manual override");
  }

  if (body.status !== undefined) {
    if (!VALID_STATUSES.has(body.status as ChannelStatus)) {
      return json({ error: "Invalid status" }, 400);
    }
    updates.push("status = ?");
    bindings.push(body.status);
  }

  if (snoozeTransition.kind === "snooze") {
    updates.push("snoozed_until = ?", "snooze_reason = ?", "snoozed_from_status = ?", "woke_at = NULL");
    bindings.push(snoozeTransition.until, snoozeTransition.reason, snoozeTransition.fromStatus);
    if (!snoozeTransition.preserveStartedAt) updates.push("snoozed_at = CURRENT_TIMESTAMP");
  } else if (snoozeTransition.kind === "wake") {
    updates.push("woke_at = CURRENT_TIMESTAMP");
  } else if (snoozeTransition.kind === "clear") {
    updates.push(
      "snoozed_until = NULL",
      "snooze_reason = NULL",
      "snoozed_at = NULL",
      "snoozed_from_status = NULL",
      "woke_at = NULL",
    );
  }

  if (body.is_seed !== undefined) {
    if (typeof body.is_seed !== "boolean") {
      return json({ error: "is_seed must be boolean" }, 400);
    }
    updates.push("is_seed = ?");
    bindings.push(body.is_seed ? 1 : 0);
  }

  if (body.is_active !== undefined) {
    if (typeof body.is_active !== "boolean") {
      return json({ error: "is_active must be boolean" }, 400);
    }
    updates.push("is_active = ?");
    bindings.push(body.is_active ? 1 : 0);
  }

  if (body.email_confirmed !== undefined) {
    if (typeof body.email_confirmed !== "boolean") {
      return json({ error: "email_confirmed must be boolean" }, 400);
    }
    nextEmailConfirmed = body.email_confirmed;
    updates.push(
      "email_confirmed = ?",
      body.email_confirmed
        ? "email_confirmed_at = CURRENT_TIMESTAMP"
        : "email_confirmed_at = NULL",
    );
    bindings.push(body.email_confirmed ? 1 : 0);
  }

  if (updates.length === 0) {
    return json({ error: "Nothing to update" }, 400);
  }

  const scoring = scoreFromRow({
    ...existing,
    kind: nextKind,
    email_confirmed: nextEmailConfirmed ? 1 : 0,
  });
  updates.push("score = ?", "score_breakdown = ?", "updated_at = CURRENT_TIMESTAMP");
  bindings.push(
    scoring.score,
    scoring.breakdown ? JSON.stringify(scoring.breakdown) : null,
    channelId,
  );

  await env.SCOUT_DB.prepare(
    `UPDATE channels SET ${updates.join(", ")} WHERE channel_id = ?`,
  )
    .bind(...bindings)
    .run();

  return json(await getChannel(env, channelId));
}

async function requireMutableChannel(env: Env, channelId: string): Promise<ChannelRow> {
  const channel = await env.SCOUT_DB.prepare(
    "SELECT * FROM channels WHERE channel_id = ?",
  )
    .bind(channelId)
    .first<ChannelRow>();
  if (!channel) throw new ResponseError("Channel not found.", 404);
  if (channel.is_seed === 1 && channel.seed_locked === 1) {
    throw new ResponseError("Seed is locked and cannot be modified.", 423);
  }
  return channel;
}

async function requireUnlockedSeed(env: Env, channelId: string): Promise<ChannelRow> {
  const seed = await env.SCOUT_DB.prepare(
    "SELECT * FROM channels WHERE channel_id = ? AND is_seed = 1",
  )
    .bind(channelId)
    .first<ChannelRow>();
  if (!seed) throw new ResponseError("Seed channel not found.", 404);
  if (seed.seed_locked === 1) {
    throw new ResponseError("Seed is locked and cannot be modified.", 423);
  }
  return seed;
}

async function logOutreach(
  channelId: string,
  request: Request,
  env: Env,
): Promise<Response> {
  const existing = await requireMutableChannel(env, channelId);

  const body = await parseJson<{
    outreach_status?: unknown;
    note?: unknown;
    next_followup_at?: unknown;
  }>(request);
  if (!VALID_OUTREACH_STATUSES.has(body.outreach_status as OutreachStatus)) {
    return json({ error: "Invalid outreach_status" }, 400);
  }
  if (typeof body.note !== "string" || body.note.trim().length === 0) {
    return json({ error: "note is required" }, 400);
  }

  const nextFollowup =
    body.next_followup_at === null || body.next_followup_at === ""
      ? null
      : typeof body.next_followup_at === "string"
        ? body.next_followup_at
        : undefined;
  if (nextFollowup === undefined) {
    return json({ error: "next_followup_at must be a string or null" }, 400);
  }
  if (nextFollowup !== null && Number.isNaN(Date.parse(nextFollowup))) {
    return json({ error: "next_followup_at must be a parseable date" }, 400);
  }

  const nextStatus = body.outreach_status as OutreachStatus;
  const contactedExpression =
    nextStatus === "none"
      ? "contacted_at"
      : "COALESCE(contacted_at, CURRENT_TIMESTAMP)";

  await env.SCOUT_DB.batch([
    env.SCOUT_DB.prepare(
      `UPDATE channels
      SET outreach_stage = ?,
        contacted_at = ${contactedExpression},
        last_touch_at = CURRENT_TIMESTAMP,
        next_followup_at = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE channel_id = ?`,
    ).bind(nextStatus, nextFollowup, channelId),
    env.SCOUT_DB.prepare(
      `INSERT INTO outreach_log (channel_id, note)
      VALUES (?, ?)`,
    ).bind(channelId, body.note.trim().slice(0, 2000)),
  ]);

  return json({
    channel: await getChannel(env, channelId),
    log: await outreachLog(env, channelId),
  });
}

async function sponsorScan(channelId: string, env: Env): Promise<Response> {
  const existing = await env.SCOUT_DB.prepare(
    "SELECT channel_id FROM channels WHERE channel_id = ?",
  )
    .bind(channelId)
    .first<{ channel_id: string }>();
  if (!existing) return json({ error: "Channel not found" }, 404);

  const cached = await recentCachedVideoScans(env, channelId);
  if (cached.length > 0) {
    await logSponsorScanJob(env, {
      idSource: "cache",
      videoCount: cached.length,
      cached: true,
      sponsoredCount: sponsorScanRollup(cached).sponsoredCount,
    });

    return json(sponsorScanResponse({
      channelId,
      cached: true,
      idSource: "cache",
      rows: cached,
    }));
  }

  try {
    const resolved = await getRecentVideoIds(env, channelId);
    const scannedAt = new Date().toISOString();
    const scannedVideos = await enrichVideosWithSponsorBlock(resolved.videos);
    const rows = await insertVideoScanRows(env, channelId, scannedVideos, scannedAt);
    await logSponsorScanJob(env, {
      idSource: resolved.source,
      videoCount: rows.length,
      cached: false,
      sponsoredCount: sponsorScanRollup(rows).sponsoredCount,
    });

    return json(sponsorScanResponse({
      channelId,
      cached: false,
      idSource: resolved.source,
      rows,
    }));
  } catch (error) {
    if (error instanceof RecentVideosError) {
      await logSponsorScanJob(env, {
        idSource: "error",
        videoCount: 0,
        cached: false,
        error: error.message,
      });
      return json({ error: "sponsor_scan_video_ids_failed", message: error.message }, 502);
    }

    throw error;
  }
}

const DEEP_SPONSOR_SCAN_VIDEO_CAP = 45;

async function sponsorScanDeepHistory(channelId: string, env: Env): Promise<Response> {
  const existing = await env.SCOUT_DB.prepare(
    "SELECT channel_id FROM channels WHERE channel_id = ?",
  )
    .bind(channelId)
    .first<{ channel_id: string }>();
  if (!existing) return json({ error: "Channel not found" }, 404);

  const client = new ScrapeCreatorsClient(env);
  const page = await client.getChannelVideosPage(channelId);
  const cutoff = Date.now() - 365 * 24 * 60 * 60 * 1000;
  const pageVideos = (Array.isArray(page.videos) ? page.videos : [])
    .filter((video) => video.id)
    .filter((video) => {
      if (!video.publishedTime) return true;
      const published = Date.parse(video.publishedTime);
      return Number.isNaN(published) || published >= cutoff;
    });
  const priorCoverage = await latestDistinctSponsorScanVideos(env, channelId, 15);
  const videos = mergeSponsorVideoCoverage(
    priorCoverage,
    pageVideos.map((video) => ({
      video_id: video.id,
      video_title: video.title ?? null,
      published_at: video.publishedTime ?? null,
    })),
    DEEP_SPONSOR_SCAN_VIDEO_CAP,
  );

  if (videos.length === 0) {
    await logSponsorScanJob(env, {
      idSource: "deep_history",
      videoCount: 0,
      cached: false,
      error: "ScrapeCreators channel-videos returned no videos inside the 12-month window.",
    });
    return json(
      {
        error: "sponsor_scan_deep_history_empty",
        message: "ScrapeCreators channel-videos returned no videos inside the 12-month window.",
      },
      502,
    );
  }

  await upsertVideos(env, channelId, pageVideos);
  const scannedAt = new Date().toISOString();
  const scannedVideos = await enrichVideosWithSponsorBlock(videos);
  const rows = await insertVideoScanRows(env, channelId, scannedVideos, scannedAt);
  await logSponsorScanJob(env, {
    idSource: "deep_history",
    videoCount: rows.length,
    cached: false,
    sponsoredCount: sponsorScanRollup(rows).sponsoredCount,
  });

  return json(sponsorScanResponse({
    channelId,
    cached: false,
    idSource: "deep_history",
    rows,
    coverageLabel: sponsorCoverageLabel(rows),
  }));
}

async function latestDistinctSponsorScanVideos(
  env: Env,
  channelId: string,
  limit: number,
): Promise<Array<{ video_id: string; video_title: string | null; published_at: string | null }>> {
  const { results } = await env.SCOUT_DB.prepare(
    `WITH latest_per_video AS (
      SELECT video_id, MAX(scanned_at) AS scanned_at
      FROM video_scans
      WHERE channel_id = ?
      GROUP BY video_id
    )
    SELECT vs.video_id, vs.video_title, vs.published_at
    FROM video_scans vs
    INNER JOIN latest_per_video latest
      ON latest.video_id = vs.video_id
      AND latest.scanned_at = vs.scanned_at
    WHERE vs.channel_id = ?
    ORDER BY
      CASE WHEN vs.published_at IS NULL THEN 1 ELSE 0 END,
      datetime(vs.published_at) DESC,
      vs.id DESC
    LIMIT ?`,
  )
    .bind(channelId, channelId, limit)
    .all<{ video_id: string; video_title: string | null; published_at: string | null }>();

  return results;
}

async function recentCachedVideoScans(
  env: Env,
  channelId: string,
): Promise<VideoScanRow[]> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const latest = await env.SCOUT_DB.prepare(
    `SELECT MAX(scanned_at) AS scanned_at
    FROM video_scans
    WHERE channel_id = ?
      AND scanned_at >= ?`,
  )
    .bind(channelId, cutoff)
    .first<{ scanned_at: string | null }>();
  if (!latest?.scanned_at) return [];

  const { results } = await env.SCOUT_DB.prepare(
    `SELECT id,
      channel_id,
      video_id,
      video_title,
      published_at,
      scanned_at,
      sponsorblock_has_sponsor,
      sponsorblock_segments_json,
      error
    FROM video_scans
    WHERE channel_id = ?
      AND scanned_at = ?
    ORDER BY
      CASE WHEN published_at IS NULL THEN 1 ELSE 0 END,
      datetime(published_at) DESC,
      id ASC`,
  )
    .bind(channelId, latest.scanned_at)
    .all<VideoScanRow>();

  return results.every((row) => row.sponsorblock_has_sponsor !== null || row.error)
    ? results
    : [];
}

async function insertVideoScanRows(
  env: Env,
  channelId: string,
  videos: SponsorBlockVideoScan[],
  scannedAt: string,
): Promise<VideoScanRow[]> {
  if (videos.length === 0) return [];

  await env.SCOUT_DB.batch(
    videos.map((video) =>
      env.SCOUT_DB.prepare(
        `INSERT INTO video_scans (
          channel_id,
          video_id,
          video_title,
          published_at,
          scanned_at,
          sponsorblock_has_sponsor,
          sponsorblock_segments_json,
          error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        channelId,
        video.video_id,
        video.video_title,
        video.published_at,
        scannedAt,
        video.sponsorblock_has_sponsor,
        video.sponsorblock_segments_json,
        video.error,
      ),
    ),
  );

  const { results } = await env.SCOUT_DB.prepare(
    `SELECT id,
      channel_id,
      video_id,
      video_title,
      published_at,
      scanned_at,
      sponsorblock_has_sponsor,
      sponsorblock_segments_json,
      error
    FROM video_scans
    WHERE channel_id = ?
      AND scanned_at = ?
    ORDER BY
      CASE WHEN published_at IS NULL THEN 1 ELSE 0 END,
      datetime(published_at) DESC,
      id ASC`,
  )
    .bind(channelId, scannedAt)
    .all<VideoScanRow>();

  return results;
}

async function logSponsorScanJob(
  env: Env,
  details: {
    idSource: "stored" | "rss" | "cache" | "error" | "deep_history";
    videoCount: number;
    cached: boolean;
    sponsoredCount?: number;
    error?: string;
  },
): Promise<void> {
  const now = new Date().toISOString();
  const note = JSON.stringify({
    id_source: details.idSource,
    video_count: details.videoCount,
    sponsored_count: details.sponsoredCount ?? null,
    cached: details.cached,
    error: details.error ?? null,
  });

  await env.SCOUT_DB.prepare(
    `INSERT INTO jobs (
      kind,
      started_at,
      finished_at,
      channels_snapshotted,
      credits_spent,
      note
    ) VALUES ('sponsor_scan', ?, ?, 0, 0, ?)`,
  )
    .bind(now, now, note)
    .run();
}

function sponsorScanResponse({
  channelId,
  cached,
  idSource,
  rows,
  coverageLabel,
}: {
  channelId: string;
  cached: boolean;
  idSource: "stored" | "rss" | "cache" | "deep_history";
  rows: VideoScanRow[];
  coverageLabel?: string;
}): Record<string, unknown> {
  const scans = rows.map(sponsorScanRow);
  const rollup = sponsorScanRollup(rows);

  return {
    channel_id: channelId,
    cached,
    id_source: idSource,
    video_count: rows.length,
    coverageLabel: coverageLabel ?? `${rows.length} recent videos`,
    totalScanned: rollup.totalScanned,
    sponsoredCount: rollup.sponsoredCount,
    sponsorshipRate: rollup.sponsorshipRate,
    lastSponsoredDate: rollup.lastSponsoredDate,
    totalSponsorSeconds: rollup.totalSponsorSeconds,
    scans,
  };
}

function sponsorScanRow(row: VideoScanRow): Record<string, unknown> {
  const totalDurationSeconds = sponsorBlockTotalDurationSeconds(row.sponsorblock_segments_json);

  return {
    ...row,
    sponsorblock_has_sponsor: row.sponsorblock_has_sponsor,
    verdict: row.sponsorblock_has_sponsor === 1 ? "sponsored" : "unknown",
    totalDurationSeconds,
  };
}

function sponsorScanRollup(rows: VideoScanRow[]): {
  totalScanned: number;
  sponsoredCount: number;
  sponsorshipRate: number;
  lastSponsoredDate: string | null;
  totalSponsorSeconds: number;
} {
  const sponsored = rows.filter((row) => row.sponsorblock_has_sponsor === 1);
  const totalSponsorSeconds = Number(
    sponsored
      .reduce((sum, row) => sum + sponsorBlockTotalDurationSeconds(row.sponsorblock_segments_json), 0)
      .toFixed(3),
  );
  const lastSponsoredDate = sponsored
    .map((row) => row.published_at)
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;

  return {
    totalScanned: rows.length,
    sponsoredCount: sponsored.length,
    sponsorshipRate: rows.length > 0 ? Number((sponsored.length / rows.length).toFixed(3)) : 0,
    lastSponsoredDate,
    totalSponsorSeconds,
  };
}

async function shortlist(url: URL, env: Env): Promise<Response> {
  await wakeDueSnoozed(env);
  const minScore = parseNumberParam(url.searchParams.get("min_score"), 0, 0, 100);
  const kinds = parseKindList(url.searchParams.get("kind"));
  const limit = parseNumberParam(url.searchParams.get("limit"), 50, 1, 100);
  const minSubs = parseOptionalNumberParam(url.searchParams.get("min_subs"), 0, Number.MAX_SAFE_INTEGER);
  const maxSubs = parseOptionalNumberParam(url.searchParams.get("max_subs"), 0, Number.MAX_SAFE_INTEGER);
  const discoveredVia = parseDiscoveryFilter(url.searchParams.get("discovered_via"));
  const statusFilter = parseShortlistStatusFilter(url.searchParams.get("status"));
  const seedFilter = parseShortlistSeedFilter(url.searchParams.get("is_seed"));
  const outreachFilter = parseOutreachStatusFilter(url.searchParams.get("outreach_status"));
  const includeUnscored = parseBooleanParam(url.searchParams.get("include_unscored"), false);
  if (minSubs !== null && maxSubs !== null && minSubs > maxSubs) {
    return json({ error: "min_subs must be less than or equal to max_subs" }, 400);
  }
  const kindPlaceholders = kinds.map(() => "?").join(", ");
  const stageClause = shortlistStageClause(statusFilter, seedFilter);
  const orderBy = statusFilter === "snoozed"
    ? "c.snoozed_until IS NULL, c.snoozed_until ASC, c.score DESC"
    : "c.score DESC, c.subscriber_count ASC";

  const { results } = await env.SCOUT_DB.prepare(
    `WITH latest_scans AS (
      SELECT channel_id, MAX(scanned_at) AS scanned_at
      FROM video_scans
      GROUP BY channel_id
    ),
    sponsor_rollups AS (
      SELECT
        vs.channel_id,
        COUNT(*) AS sponsor_scan_total,
        SUM(CASE WHEN vs.sponsorblock_has_sponsor = 1 THEN 1 ELSE 0 END) AS sponsor_scan_sponsored,
        MAX(CASE WHEN vs.sponsorblock_has_sponsor = 1 THEN vs.published_at ELSE NULL END) AS sponsor_scan_last_sponsored,
        MAX(vs.scanned_at) AS sponsor_scan_scanned_at
      FROM video_scans vs
      INNER JOIN latest_scans ls
        ON ls.channel_id = vs.channel_id
        AND ls.scanned_at = vs.scanned_at
      GROUP BY vs.channel_id
    ),
    latest_outreach AS (
      SELECT channel_id, note AS latest_outreach_note
      FROM outreach_log
      WHERE id IN (
        SELECT MAX(id)
        FROM outreach_log
        GROUP BY channel_id
      )
    )
    SELECT
      c.*,
      s.title AS source_seed_title,
      sr.sponsor_scan_total,
      sr.sponsor_scan_sponsored,
      sr.sponsor_scan_last_sponsored,
      sr.sponsor_scan_scanned_at,
      lo.latest_outreach_note
    FROM channels c
    LEFT JOIN channels s ON c.source_channel_id = s.channel_id
    LEFT JOIN sponsor_rollups sr ON sr.channel_id = c.channel_id
    LEFT JOIN latest_outreach lo ON lo.channel_id = c.channel_id
    WHERE ((? = 1 AND c.score IS NULL) OR c.score >= ?)
      AND c.kind IN (${kindPlaceholders})
      AND ${stageClause.sql}
      AND (? IS NULL OR c.subscriber_count >= ?)
      AND (? IS NULL OR c.subscriber_count <= ?)
      AND (? IS NULL OR c.discovered_via = ?)
      AND (? IS NULL OR c.outreach_stage = ?)
    ORDER BY ${orderBy}
    LIMIT ?`,
  )
    .bind(
      includeUnscored ? 1 : 0,
      minScore,
      ...kinds,
      ...stageClause.bindings,
      minSubs,
      minSubs,
      maxSubs,
      maxSubs,
      discoveredVia,
      discoveredVia,
      outreachFilter,
      outreachFilter,
      limit,
    )
    .all<ChannelSummaryRow>();

  const growth = await growthMapForChannels(env, results.map((row) => row.channel_id));

  return json({
    channels: results.map((row) => channelSummary(row, growth.get(row.channel_id))),
  });
}

async function outreach(env: Env): Promise<Response> {
  const working = await outreachRows(env, "working");
  const live = await outreachRows(env, "live");
  const closed = await outreachRows(env, "closed");
  const growth = await growthMapForChannels(
    env,
    [...working, ...live, ...closed].map((row) => row.channel_id),
  );

  return json({
    working: working.map((row) => channelSummary(row, growth.get(row.channel_id))),
    live: live.map((row) => channelSummary(row, growth.get(row.channel_id))),
    closed: closed.map((row) => channelSummary(row, growth.get(row.channel_id))),
  });
}

async function outreachRows(
  env: Env,
  route: "working" | "live" | "closed",
): Promise<Array<ChannelRow & { source_seed_title: string | null }>> {
  const clause = route === "working"
    ? "c.is_active = 1"
    : route === "closed"
      ? `c.outreach_stage IN (${CLOSED_OUTREACH_SQL})`
      : `c.outreach_stage IN (${LIVE_OUTREACH_SQL})`;
  const order = route === "working"
    ? "LOWER(COALESCE(c.title, c.handle, c.channel_id)) ASC"
    : route === "closed"
      ? "c.last_touch_at DESC, c.updated_at DESC"
      : `CASE WHEN c.last_touch_at IS NULL THEN 1 ELSE 0 END,
        c.last_touch_at ASC,
        c.updated_at ASC`;
  const { results } = await env.SCOUT_DB.prepare(
    `WITH latest_scans AS (
      SELECT channel_id, MAX(scanned_at) AS scanned_at
      FROM video_scans
      GROUP BY channel_id
    ),
    sponsor_rollups AS (
      SELECT
        vs.channel_id,
        COUNT(*) AS sponsor_scan_total,
        SUM(CASE WHEN vs.sponsorblock_has_sponsor = 1 THEN 1 ELSE 0 END) AS sponsor_scan_sponsored,
        MAX(CASE WHEN vs.sponsorblock_has_sponsor = 1 THEN vs.published_at ELSE NULL END) AS sponsor_scan_last_sponsored,
        MAX(vs.scanned_at) AS sponsor_scan_scanned_at
      FROM video_scans vs
      INNER JOIN latest_scans ls
        ON ls.channel_id = vs.channel_id
        AND ls.scanned_at = vs.scanned_at
      GROUP BY vs.channel_id
    ),
    latest_outreach AS (
      SELECT channel_id, note AS latest_outreach_note
      FROM outreach_log
      WHERE id IN (
        SELECT MAX(id)
        FROM outreach_log
        GROUP BY channel_id
      )
    )
    SELECT
      c.*,
      s.title AS source_seed_title,
      sr.sponsor_scan_total,
      sr.sponsor_scan_sponsored,
      sr.sponsor_scan_last_sponsored,
      sr.sponsor_scan_scanned_at,
      lo.latest_outreach_note
    FROM channels c
    LEFT JOIN channels s ON c.source_channel_id = s.channel_id
    LEFT JOIN sponsor_rollups sr ON sr.channel_id = c.channel_id
    LEFT JOIN latest_outreach lo ON lo.channel_id = c.channel_id
    WHERE ${clause}
    ORDER BY ${order}
    LIMIT 200`,
  ).all<ChannelSummaryRow>();

  return results;
}

async function outreachLog(env: Env, channelId: string): Promise<unknown[]> {
  const { results } = await env.SCOUT_DB.prepare(
    `SELECT id, channel_id, created_at, note
    FROM outreach_log
    WHERE channel_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 25`,
  )
    .bind(channelId)
    .all();

  return results;
}

async function brands(env: Env): Promise<Response> {
  const { results } = await env.SCOUT_DB.prepare(
    `WITH latest_scans AS (
      SELECT channel_id, MAX(scanned_at) AS scanned_at
      FROM video_scans
      GROUP BY channel_id
    ),
    sponsor_rollups AS (
      SELECT
        vs.channel_id,
        COUNT(*) AS sponsor_scan_total,
        SUM(CASE WHEN vs.sponsorblock_has_sponsor = 1 THEN 1 ELSE 0 END) AS sponsor_scan_sponsored,
        MAX(CASE WHEN vs.sponsorblock_has_sponsor = 1 THEN vs.published_at ELSE NULL END) AS sponsor_scan_last_sponsored,
        MAX(vs.scanned_at) AS sponsor_scan_scanned_at
      FROM video_scans vs
      INNER JOIN latest_scans ls
        ON ls.channel_id = vs.channel_id
        AND ls.scanned_at = vs.scanned_at
      GROUP BY vs.channel_id
    )
    SELECT
      c.*,
      s.title AS source_seed_title,
      sr.sponsor_scan_total,
      sr.sponsor_scan_sponsored,
      sr.sponsor_scan_last_sponsored,
      sr.sponsor_scan_scanned_at
    FROM channels c
    LEFT JOIN channels s ON c.source_channel_id = s.channel_id
    LEFT JOIN sponsor_rollups sr ON sr.channel_id = c.channel_id
    WHERE c.kind = 'brand'
      AND c.status IN ('candidate', 'shortlisted')
    ORDER BY c.subscriber_count IS NULL, c.subscriber_count DESC, c.title ASC`,
  ).all<ChannelSummaryRow>();

  return json({
    brands: results.map((row) => {
      const raw = parseRaw(row.raw_json);
      const sponsorFields = sponsorRollupFields({
        sponsor_scan_total: Number(row.sponsor_scan_total ?? 0),
        sponsor_scan_sponsored: Number(row.sponsor_scan_sponsored ?? 0),
        sponsor_scan_last_sponsored: row.sponsor_scan_last_sponsored ?? null,
        sponsor_scan_scanned_at: row.sponsor_scan_scanned_at ?? null,
      });
      return {
        channel_id: row.channel_id,
        handle: row.handle,
        title: row.title,
        is_active: row.is_active === 1,
        subscriber_count: row.subscriber_count,
        country: row.country,
        links: extractLinks(raw),
        source_seed_title: row.source_seed_title,
        ...sponsorFields,
      };
    }),
  });
}

async function discoverSearch(request: Request, env: Env): Promise<Response> {
  const options = parseSearchOptions(await parseOptionalJson<Record<string, unknown>>(request));
  const result = await runSearchIngestion(env, options);
  return json(result);
}

async function discoverSearchBatch(request: Request, env: Env): Promise<Response> {
  const body = await parseOptionalJson<{
    queries?: unknown;
    maxPages?: unknown;
    maxResolves?: unknown;
    uploadedWithin?: unknown;
    min_subs?: unknown;
    minSubs?: unknown;
  }>(request);

  if (!Array.isArray(body.queries)) {
    return json({ error: "queries must be an array" }, 400);
  }

  const queries = body.queries
    .map((query) => (typeof query === "string" ? query.trim() : ""))
    .filter(Boolean);

  if (queries.length === 0 || queries.length > 10) {
    return json({ error: "queries must contain 1 to 10 non-empty strings" }, 400);
  }

  const shared = parseSearchOptions({
    query: queries[0],
    maxPages: body.maxPages,
    maxResolves: body.maxResolves,
    uploadedWithin: body.uploadedWithin,
    min_subs: body.min_subs ?? body.minSubs,
  });
  const results: SearchIngestionResult[] = [];
  let creditsSpentTotal = 0;

  for (const query of queries) {
    const nextOptions = { ...shared, query };
    const worstCaseCost = nextOptions.maxPages + nextOptions.maxResolves;
    if (creditsSpentTotal + worstCaseCost > 100) {
      return json({
        aborted: true,
        reason: `Batch stopped before "${query}" because the worst-case cost would exceed 100 credits.`,
        credits_spent_total: creditsSpentTotal,
        results,
      });
    }

    const result = await runSearchIngestion(env, nextOptions);
    creditsSpentTotal += result.credits_spent_this_run;
    results.push(result);
  }

  return json({
    aborted: false,
    credits_spent_total: creditsSpentTotal,
    results,
  });
}

async function listSearches(env: Env): Promise<Response> {
  const { results } = await env.SCOUT_DB.prepare(
    `SELECT id, query, pages_used, refs_found, resolved, credits_spent, created_at
    FROM searches
    ORDER BY created_at DESC, id DESC
    LIMIT 100`,
  ).all();

  return json({ searches: results });
}

async function searchSuggestions(env: Env): Promise<Response> {
  const blocked = await suggestionBlocklist(env);

  return json({
    suggestions: await storedTopicSuggestions(env, blocked, 30),
    content_suggestions: await storedContentSuggestions(env, blocked, 30),
  });
}

async function deepSearchVariants(request: Request, env: Env): Promise<Response> {
  const body = await parseJson<{ query?: unknown }>(request);
  const query = normalizeDeepQuery(typeof body.query === "string" ? body.query : "");
  if (!query) return json({ error: "query is required" }, 400);

  const fallback = fallbackDeepVariants(query);
  try {
    const result = await new AnthropicClient(env).generateDeepVariants({ baseQuery: query });
    const variants = uniqueDeepVariants([...result.queries, ...fallback], query).slice(0, 4);
    if (variants.length > 0) {
      return json({
        query,
        variants,
        source: result.queries.length >= 4 ? "llm" : "mixed",
        input_tokens: result.inputTokens,
        output_tokens: result.outputTokens,
      });
    }
  } catch {
    // Deep Search must remain available even if the LLM is unavailable or malformed.
  }

  return json({
    query,
    variants: fallback,
    source: "fallback",
    input_tokens: 0,
    output_tokens: 0,
  });
}

async function blockSearchSuggestion(request: Request, env: Env): Promise<Response> {
  const body = await parseJson<{ term?: unknown }>(request);
  const term = normalizeSuggestionBlockTerm(typeof body.term === "string" ? body.term : "");
  if (!term) return json({ error: "term is required" }, 400);

  await env.SCOUT_DB.prepare(
    "INSERT OR IGNORE INTO suggestion_blocklist (term) VALUES (?)",
  )
    .bind(term)
    .run();

  return json({ blocked: term });
}

async function suggestionBlocklist(env: Env): Promise<Set<string>> {
  const { results } = await env.SCOUT_DB.prepare(
    "SELECT term FROM suggestion_blocklist",
  ).all<{ term: string }>();

  return new Set(results.map((row) => normalizeSuggestionBlockTerm(row.term)).filter(Boolean));
}

function normalizeSuggestionBlockTerm(value: string): string {
  return normalizeSuggestionTerm(value);
}

function normalizeDeepQuery(value: string): string {
  return normalizeSuggestionTerm(value)
    .replace(/[^a-z0-9 '&.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fallbackDeepVariants(query: string): string[] {
  const base = normalizeDeepQuery(query);
  return uniqueDeepVariants([
    `${base} review`,
    `${base} how to`,
    `${base} vs`,
    `${base} recipe`,
  ], base);
}

function uniqueDeepVariants(values: string[], baseQuery: string): string[] {
  const base = normalizeDeepQuery(baseQuery);
  const seen = new Set<string>();
  const variants: string[] = [];
  for (const value of values) {
    const term = normalizeDeepQuery(value);
    if (!term || term === base || seen.has(term)) continue;
    seen.add(term);
    variants.push(term);
  }
  return variants;
}

async function mineQueries(request: Request, env: Env): Promise<Response> {
  const body = await parseOptionalJson<{
    channel_id?: unknown;
    channelId?: unknown;
    force?: unknown;
  }>(request);
  const channelId = typeof (body.channel_id ?? body.channelId) === "string"
    ? String(body.channel_id ?? body.channelId)
    : null;
  let seedIds: string[];
  if (channelId) {
    await requireUnlockedSeed(env, channelId);
    const [target] = await seedOperationTargets(env, [channelId]);
    if (!target) {
      throw new ResponseError("Seed channel not found.", 404);
    }
    if (target.stored_video_count < MIN_SEED_QUERY_VIDEOS) {
      throw new ResponseError(
        `Seed query regeneration requires at least ${MIN_SEED_QUERY_VIDEOS} stored videos; this seed has ${target.stored_video_count}. Expand it first.`,
        409,
      );
    }
    seedIds = [channelId];
  } else {
    seedIds = (await eligibleMineQueryTargets(env)).map((target) => target.channel_id);
  }
  const force = body.force === true;
  const [queries, topics] = await Promise.all([
    computeSeedQueries(env, seedIds, { force }),
    computeSeedTopics(env, seedIds, { requireStoredVideos: true }),
  ]);
  return json({
    seeds_considered: Math.max(queries.seeds_considered, topics.seeds_considered),
    phrases_written: queries.phrases_written,
    topics_written: topics.topics_written,
    seeds_generated: queries.seeds_generated,
    seeds_skipped: queries.seeds_skipped,
    llm_seeds: queries.llm_seeds,
    fallback_seeds: queries.fallback_seeds,
    input_tokens: queries.input_tokens,
    output_tokens: queries.output_tokens,
    source: queries.source,
  });
}

async function mineQueriesPlan(env: Env): Promise<Response> {
  const targets = await seedOperationTargets(env);
  const eligible = targets.filter(isEligibleMineQueryTarget);
  return json({
    target_count: eligible.length,
    locked_count: targets.filter((target) => target.seed_locked === 1).length,
    insufficient_video_count: targets.filter((target) => (
      target.seed_locked !== 1
      && target.stored_video_count < MIN_SEED_QUERY_VIDEOS
    )).length,
    minimum_stored_videos: MIN_SEED_QUERY_VIDEOS,
    targets: eligible.map((target) => ({
      channel_id: target.channel_id,
      title: target.title,
      handle: target.handle,
      stored_video_count: target.stored_video_count,
    })),
  });
}

interface SeedOperationTarget {
  channel_id: string;
  title: string | null;
  handle: string | null;
  seed_locked: number;
  stored_video_count: number;
}

async function seedOperationTargets(
  env: Env,
  seedIds?: string[],
): Promise<SeedOperationTarget[]> {
  if (hasExplicitEmptySeedTargets(seedIds)) return [];
  const seedFilter = seedIds !== undefined
    ? `AND s.channel_id IN (${seedIds.map(() => "?").join(", ")})`
    : "";
  const statement = env.SCOUT_DB.prepare(
    `SELECT
      s.channel_id,
      s.title,
      s.handle,
      s.seed_locked,
      COUNT(v.video_id) AS stored_video_count
    FROM channels s
    LEFT JOIN videos v ON v.channel_id = s.channel_id
    WHERE s.is_seed = 1
      ${seedFilter}
    GROUP BY s.channel_id, s.title, s.handle, s.seed_locked
    ORDER BY s.title ASC`,
  );
  const { results } = await (seedIds !== undefined ? statement.bind(...seedIds) : statement)
    .all<Omit<SeedOperationTarget, "stored_video_count"> & { stored_video_count: number | null }>();
  return results.map((row) => ({
    ...row,
    stored_video_count: Number(row.stored_video_count ?? 0),
  }));
}

function isEligibleMineQueryTarget(target: SeedOperationTarget): boolean {
  return target.seed_locked !== 1
    && target.stored_video_count >= MIN_SEED_QUERY_VIDEOS;
}

async function eligibleMineQueryTargets(
  env: Env,
  seedIds?: string[],
): Promise<SeedOperationTarget[]> {
  return (await seedOperationTargets(env, seedIds)).filter(isEligibleMineQueryTarget);
}

function emptySeedQueryComputation(): {
  seeds_considered: number;
  phrases_written: number;
  seeds_generated: number;
  seeds_skipped: number;
  llm_seeds: number;
  fallback_seeds: number;
  input_tokens: number;
  output_tokens: number;
  source: "skipped";
} {
  return {
    seeds_considered: 0,
    phrases_written: 0,
    seeds_generated: 0,
    seeds_skipped: 0,
    llm_seeds: 0,
    fallback_seeds: 0,
    input_tokens: 0,
    output_tokens: 0,
    source: "skipped",
  };
}

async function computeSeedQueries(
  env: Env,
  seedIds?: string[],
  options: { force?: boolean } = {},
): Promise<{
  seeds_considered: number;
  phrases_written: number;
  seeds_generated: number;
  seeds_skipped: number;
  llm_seeds: number;
  fallback_seeds: number;
  input_tokens: number;
  output_tokens: number;
  source: "llm" | "ngram" | "mixed" | "skipped";
}> {
  const authorizedTargets = await eligibleMineQueryTargets(env, seedIds);
  if (authorizedTargets.length === 0) return emptySeedQueryComputation();
  const startedAt = new Date().toISOString();
  const allTargetIds = (await eligibleMineQueryTargets(env)).map((target) => target.channel_id);
  const allSeeds = await titleMiningSeeds(env, allTargetIds);
  const selectedIds = new Set(authorizedTargets.map((target) => target.channel_id));
  const blocked = await suggestionBlocklist(env);
  const anthropic = new AnthropicClient(env);
  let phrasesWritten = 0;
  let seedsGenerated = 0;
  let seedsSkipped = 0;
  let llmSeeds = 0;
  let fallbackSeeds = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  const rawLlmResponses: MineQueryRawResponse[] = [];

  for (const seed of allSeeds.filter((item) => selectedIds.has(item.channel_id))) {
    if (!options.force && !(await seedQueriesAreStale(env, seed))) {
      seedsSkipped += 1;
      continue;
    }

    const generated = await generateSeedQueries(env, anthropic, seed, allSeeds, blocked);
    inputTokens += generated.inputTokens;
    outputTokens += generated.outputTokens;
    if (generated.rawResponseText) {
      rawLlmResponses.push({
        channel_id: seed.channel_id,
        title: seed.title,
        handle: seed.handle,
        source: generated.source,
        raw_response_text: truncateJobText(generated.rawResponseText),
      });
    }
    if (generated.source === "llm") llmSeeds += 1;
    if (generated.source === "ngram") fallbackSeeds += 1;

    await env.SCOUT_DB.prepare("DELETE FROM seed_queries WHERE channel_id = ?")
      .bind(seed.channel_id)
      .run();
    if (generated.queries.length === 0) continue;

    await env.SCOUT_DB.batch(
      generated.queries.map((phrase, index) =>
        env.SCOUT_DB.prepare(
          `INSERT INTO seed_queries (
            channel_id,
            phrase,
            rank,
            computed_at,
            source,
            generated_at,
            latest_video_at,
            video_count
          )
          VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP, ?, ?)
          ON CONFLICT(channel_id, phrase) DO UPDATE SET
            rank = excluded.rank,
            computed_at = excluded.computed_at,
            source = excluded.source,
            generated_at = excluded.generated_at,
            latest_video_at = excluded.latest_video_at,
            video_count = excluded.video_count`,
        ).bind(
          seed.channel_id,
          phrase,
          index + 1,
          generated.source,
          seed.latest_video_at ?? null,
          seed.video_count ?? 0,
        ),
      ),
    );
    phrasesWritten += generated.queries.length;
    seedsGenerated += 1;
  }

  await logMineQueriesJob(env, {
    startedAt,
    seedsConsidered: selectedIds.size,
    seedsGenerated,
    seedsSkipped,
    phrasesWritten,
    llmSeeds,
    fallbackSeeds,
    inputTokens,
    outputTokens,
    rawLlmResponses,
  });

  return {
    seeds_considered: selectedIds.size,
    phrases_written: phrasesWritten,
    seeds_generated: seedsGenerated,
    seeds_skipped: seedsSkipped,
    llm_seeds: llmSeeds,
    fallback_seeds: fallbackSeeds,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    source: llmSeeds > 0 && fallbackSeeds > 0
      ? "mixed"
      : llmSeeds > 0
        ? "llm"
        : fallbackSeeds > 0
          ? "ngram"
          : "skipped",
  };
}

async function generateSeedQueries(
  _env: Env,
  anthropic: AnthropicClient,
  seed: TitleMiningSeed,
  allSeeds: TitleMiningSeed[],
  blocked: Set<string>,
): Promise<{
  queries: string[];
  source: "llm" | "ngram";
  inputTokens: number;
  outputTokens: number;
  rawResponseText: string | null;
}> {
  try {
    const result: AnthropicQueryResult = await anthropic.generateSeedQueries(seedQueryPrompt(seed, blocked));
    const queries = result.queries.filter((query) => !blocked.has(normalizeSuggestionTerm(query)));
    if (queries.length > 0) {
      return {
        queries: queries.slice(0, 6),
        source: "llm",
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        rawResponseText: result.rawResponseText,
      };
    }
  } catch {
    // Fall through to the deterministic miner. The query endpoint reports fallback counts.
  }

  return {
    queries: mineSeedTitlePhrases(seed, allSeeds, 6, blocked).map((phrase) => phrase.term),
    source: "ngram",
    inputTokens: 0,
    outputTokens: 0,
    rawResponseText: null,
  };
}

function seedQueryPrompt(seed: TitleMiningSeed, blocked: Set<string>): SeedQueryPrompt {
  return {
    title: seed.title,
    handle: seed.handle,
    description: seed.description ?? null,
    videoTitles: seed.videos
      .map((video) => typeof video === "string" ? video : video.title)
      .filter(Boolean)
      .slice(0, 30),
    blockedTerms: blocked,
  };
}

async function seedQueriesAreStale(env: Env, seed: TitleMiningSeed): Promise<boolean> {
  const row = await env.SCOUT_DB.prepare(
    `SELECT
      MAX(generated_at) AS generated_at,
      MAX(latest_video_at) AS latest_video_at,
      MAX(video_count) AS video_count,
      MAX(CASE WHEN source = 'ngram' THEN 1 ELSE 0 END) AS has_ngram,
      COUNT(*) AS rows
    FROM seed_queries
    WHERE channel_id = ?`,
  )
    .bind(seed.channel_id)
    .first<{
      generated_at: string | null;
      latest_video_at: string | null;
      video_count: number | null;
      has_ngram: number | null;
      rows: number;
    }>();

  if (!row || Number(row.rows ?? 0) === 0) return true;
  if (Number(row.has_ngram ?? 0) > 0) return true;
  if (!row.generated_at) return true;
  if (Number(row.video_count ?? 0) !== Number(seed.video_count ?? 0)) return true;
  if (!seed.latest_video_at) return false;
  const generatedAt = Date.parse(row.generated_at);
  const latestVideoAt = Date.parse(seed.latest_video_at);
  if (!Number.isFinite(generatedAt) || !Number.isFinite(latestVideoAt)) return true;
  return latestVideoAt > generatedAt;
}

async function logMineQueriesJob(
  env: Env,
  details: {
    startedAt: string;
    seedsConsidered: number;
    seedsGenerated: number;
    seedsSkipped: number;
    phrasesWritten: number;
    llmSeeds: number;
    fallbackSeeds: number;
    inputTokens: number;
    outputTokens: number;
    rawLlmResponses: MineQueryRawResponse[];
  },
): Promise<void> {
  await env.SCOUT_DB.prepare(
    `INSERT INTO jobs (
      kind,
      started_at,
      finished_at,
      channels_snapshotted,
      credits_spent,
      note
    )
    VALUES (?, ?, CURRENT_TIMESTAMP, ?, 0, ?)`,
  )
    .bind(
      "mine_queries",
      details.startedAt,
      details.seedsGenerated,
      JSON.stringify({
        seeds_considered: details.seedsConsidered,
        seeds_generated: details.seedsGenerated,
        seeds_skipped: details.seedsSkipped,
        phrases_written: details.phrasesWritten,
        llm_seeds: details.llmSeeds,
        fallback_seeds: details.fallbackSeeds,
        input_tokens: details.inputTokens,
        output_tokens: details.outputTokens,
        raw_llm_responses: details.rawLlmResponses,
      }),
    )
    .run();
}

interface MineQueryRawResponse {
  channel_id: string;
  title: string | null;
  handle: string | null;
  source: "llm" | "ngram";
  raw_response_text: string;
}

function truncateJobText(value: string, maxLength = 2000): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}... [truncated]`;
}

async function computeSeedTopics(
  env: Env,
  seedIds?: string[],
  options: { requireStoredVideos?: boolean } = {},
): Promise<{ seeds_considered: number; topics_written: number }> {
  const authorizedTargets = options.requireStoredVideos
    ? await eligibleMineQueryTargets(env, seedIds)
    : (await seedOperationTargets(env, seedIds)).filter((target) => target.seed_locked !== 1);
  if (authorizedTargets.length === 0) {
    return { seeds_considered: 0, topics_written: 0 };
  }
  const seeds = await suggestionSeeds(
    env,
    authorizedTargets.map((target) => target.channel_id),
  );
  const blocked = await suggestionBlocklist(env);
  let topicsWritten = 0;

  for (const seed of seeds) {
    const terms = seedSuggestionTerms(seed, blocked).slice(0, 30);
    await env.SCOUT_DB.prepare("DELETE FROM seed_topics WHERE channel_id = ?")
      .bind(seed.channel_id)
      .run();
    if (terms.length === 0) continue;

    await env.SCOUT_DB.batch(
      terms.map((term, index) =>
        env.SCOUT_DB.prepare(
          `INSERT INTO seed_topics (channel_id, term, rank, computed_at)
          VALUES (?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(channel_id, term) DO UPDATE SET
            rank = excluded.rank,
            computed_at = excluded.computed_at`,
        ).bind(seed.channel_id, term, index + 1),
      ),
    );
    topicsWritten += terms.length;
  }

  return {
    seeds_considered: seeds.length,
    topics_written: topicsWritten,
  };
}

async function repairYields(env: Env): Promise<Response> {
  const seeds = await seedRows(env);
  const knownChannels = await knownChannelLookup(env);
  const updates: Array<{ seed: ChannelRow; target: ChannelRow }> = [];
  const seenPairs = new Set<string>();

  for (const seed of seeds) {
    const { results } = await env.SCOUT_DB.prepare(
      "SELECT description FROM videos WHERE channel_id = ? AND description IS NOT NULL",
    )
      .bind(seed.channel_id)
      .all<{ description: string | null }>();
    for (const row of results) {
      for (const ref of mineChannelRefs(row.description, {
        seedHandle: seed.handle,
        seedChannelId: seed.channel_id,
      })) {
        const target = existingChannelForRef(ref, knownChannels);
        if (!target || target.channel_id === seed.channel_id || target.source_channel_id) continue;
        const key = `${seed.channel_id}:${target.channel_id}`;
        if (seenPairs.has(key)) continue;
        seenPairs.add(key);
        updates.push({ seed, target });
      }
    }
  }

  if (updates.length > 0) {
    await env.SCOUT_DB.batch(
      updates.map(({ seed, target }) =>
        env.SCOUT_DB.prepare(
          `UPDATE channels
          SET source_channel_id = ?, updated_at = CURRENT_TIMESTAMP
          WHERE channel_id = ?
            AND source_channel_id IS NULL`,
        ).bind(seed.channel_id, target.channel_id),
      ),
    );
  }

  const yields = await seedYieldRows(env);
  return json({
    repaired: updates.length,
    repaired_rows: updates.map(({ seed, target }) => ({
      seed: seed.title ?? seed.handle ?? seed.channel_id,
      title: target.title,
      handle: target.handle,
      channel_id: target.channel_id,
    })),
    yields,
  });
}

async function seedRows(env: Env): Promise<ChannelRow[]> {
  const { results } = await env.SCOUT_DB.prepare(
    "SELECT * FROM channels WHERE is_seed = 1 ORDER BY title ASC",
  ).all<ChannelRow>();
  return results;
}

async function suggestionSeeds(env: Env, seedIds?: string[]): Promise<SuggestionSeed[]> {
  if (hasExplicitEmptySeedTargets(seedIds)) return [];
  const seedFilter = seedIds !== undefined
    ? `AND channel_id IN (${seedIds.map(() => "?").join(", ")})`
    : "";
  const statement = env.SCOUT_DB.prepare(
    `SELECT channel_id, title, handle, raw_json
    FROM channels
    WHERE is_seed = 1
      AND seed_locked = 0
      ${seedFilter}
    ORDER BY title ASC`,
  );
  const { results } = await (seedIds !== undefined ? statement.bind(...seedIds) : statement)
    .all<SuggestionSeed>();
  return results;
}

async function seedYieldRows(env: Env): Promise<Array<{ seed: string | null; channel_id: string; yield_count: number }>> {
  const { results } = await env.SCOUT_DB.prepare(
    `SELECT
      s.title AS seed,
      s.channel_id,
      (
        SELECT COUNT(*)
        FROM channels c
        WHERE c.source_channel_id = s.channel_id
      ) AS yield_count
    FROM channels s
    WHERE s.is_seed = 1
    ORDER BY yield_count DESC, s.title ASC`,
  ).all<{ seed: string | null; channel_id: string; yield_count: number }>();
  return results;
}

async function knownChannelLookup(env: Env): Promise<{
  byId: Map<string, ChannelRow>;
  byHandle: Map<string, ChannelRow>;
  bySlug: Map<string, ChannelRow>;
}> {
  const { results } = await env.SCOUT_DB.prepare(
    "SELECT * FROM channels",
  ).all<ChannelRow>();
  const byId = new Map<string, ChannelRow>();
  const byHandle = new Map<string, ChannelRow>();
  const bySlug = new Map<string, ChannelRow>();
  for (const row of results) {
    byId.set(row.channel_id, row);
    if (row.handle) byHandle.set(normalizeChannelToken(row.handle), row);
    if (row.title) bySlug.set(normalizeChannelToken(row.title), row);
  }
  return { byId, byHandle, bySlug };
}

function existingChannelForRef(
  ref: ChannelRef,
  lookup: {
    byId: Map<string, ChannelRow>;
    byHandle: Map<string, ChannelRow>;
    bySlug: Map<string, ChannelRow>;
  },
): ChannelRow | null {
  if (ref.type === "channelId") return lookup.byId.get(ref.ref) ?? null;
  if (ref.type === "handle") return lookup.byHandle.get(normalizeChannelToken(ref.ref)) ?? null;
  const customSlug = ref.ref.split("/").filter(Boolean).pop() ?? "";
  return lookup.byHandle.get(normalizeChannelToken(customSlug))
    ?? lookup.bySlug.get(normalizeChannelToken(customSlug))
    ?? null;
}

function normalizeChannelToken(value: string): string {
  return value
    .replace(/^@/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

async function storedSeedQueryPhraseMap(env: Env, seedIds: string[]): Promise<Map<string, string[]>> {
  if (seedIds.length === 0) return new Map();
  const placeholders = seedIds.map(() => "?").join(", ");
  const { results } = await env.SCOUT_DB.prepare(
    `SELECT channel_id, phrase
    FROM seed_queries
    WHERE channel_id IN (${placeholders})
    ORDER BY channel_id,
      CASE source WHEN 'llm' THEN 0 ELSE 1 END,
      rank ASC`,
  )
    .bind(...seedIds)
    .all<{ channel_id: string; phrase: string }>();
  const bySeed = new Map<string, string[]>();
  for (const row of results) {
    const phrases = bySeed.get(row.channel_id) ?? [];
    phrases.push(row.phrase);
    bySeed.set(row.channel_id, phrases);
  }
  return bySeed;
}

async function storedTopicSuggestions(
  env: Env,
  blockedTerms: Set<string>,
  limit: number,
): Promise<Array<{
  term: string;
  seed_count: number;
  seeds: Array<{ channel_id: string; title: string | null; handle: string | null }>;
}>> {
  const { results } = await env.SCOUT_DB.prepare(
    `SELECT
      t.term,
      t.rank,
      s.channel_id,
      s.title,
      s.handle
    FROM seed_topics t
    JOIN channels s ON s.channel_id = t.channel_id
    WHERE s.is_seed = 1
      AND s.seed_locked = 0
    ORDER BY t.rank ASC, t.term ASC
    LIMIT 1000`,
  ).all<{
    term: string;
    rank: number;
    channel_id: string;
    title: string | null;
    handle: string | null;
  }>();

  return aggregateStoredSuggestions(results, blockedTerms, limit);
}

async function storedContentSuggestions(
  env: Env,
  blockedTerms: Set<string>,
  limit: number,
): Promise<Array<{
  term: string;
  seed_count: number;
  seeds: Array<{ channel_id: string; title: string | null; handle: string | null }>;
}>> {
  const { results } = await env.SCOUT_DB.prepare(
    `SELECT
      q.phrase,
      q.rank,
      s.channel_id,
      s.title,
      s.handle
    FROM seed_queries q
    JOIN channels s ON s.channel_id = q.channel_id
    WHERE s.is_seed = 1
      AND s.seed_locked = 0
    ORDER BY
      CASE q.source WHEN 'llm' THEN 0 ELSE 1 END,
      q.rank ASC,
      q.phrase ASC
    LIMIT 500`,
  ).all<{
    phrase: string;
    rank: number;
    channel_id: string;
    title: string | null;
    handle: string | null;
  }>();

  return aggregateStoredSuggestions(
    results.map((row) => ({
      term: row.phrase,
      rank: row.rank,
      channel_id: row.channel_id,
      title: row.title,
      handle: row.handle,
    })),
    blockedTerms,
    limit,
  );
}

function aggregateStoredSuggestions(
  rows: Array<{
    term: string;
    rank: number;
    channel_id: string;
    title: string | null;
    handle: string | null;
  }>,
  blockedTerms: Set<string>,
  limit: number,
): Array<{
  term: string;
  seed_count: number;
  seeds: Array<{ channel_id: string; title: string | null; handle: string | null }>;
}> {
  const byPhrase = new Map<string, {
    term: string;
    seed_count: number;
    bestRank: number;
    seeds: Array<{ channel_id: string; title: string | null; handle: string | null }>;
  }>();
  for (const row of rows) {
    const term = normalizeSuggestionTerm(row.term);
    if (!term || blockedTerms.has(term)) continue;
    const existing = byPhrase.get(term) ?? {
      term,
      seed_count: 0,
      bestRank: row.rank,
      seeds: [],
    };
    if (!existing.seeds.some((seed) => seed.channel_id === row.channel_id)) {
      existing.seed_count += 1;
      existing.seeds.push({
        channel_id: row.channel_id,
        title: row.title,
        handle: row.handle,
      });
    }
    existing.bestRank = Math.min(existing.bestRank, row.rank);
    byPhrase.set(term, existing);
  }

  return [...byPhrase.values()]
    .sort((a, b) => b.seed_count - a.seed_count || a.bestRank - b.bestRank || a.term.localeCompare(b.term))
    .slice(0, limit)
    .map(({ bestRank: _bestRank, ...suggestion }) => suggestion);
}

async function titleMiningSeeds(env: Env, seedIds?: string[]): Promise<TitleMiningSeed[]> {
  if (hasExplicitEmptySeedTargets(seedIds)) return [];
  const seedFilter = seedIds !== undefined
    ? `AND s.channel_id IN (${seedIds.map(() => "?").join(", ")})`
    : "";
  const statement = env.SCOUT_DB.prepare(
    `SELECT
      s.channel_id,
      s.title,
      s.handle,
      s.description,
      v.title AS video_title,
      v.published_at AS video_published_at,
      MAX(v.published_at) OVER (PARTITION BY s.channel_id) AS latest_video_at,
      COUNT(v.video_id) OVER (PARTITION BY s.channel_id) AS video_count
    FROM channels s
    LEFT JOIN videos v ON v.channel_id = s.channel_id
    WHERE s.is_seed = 1
      AND s.seed_locked = 0
      ${seedFilter}
    ORDER BY s.channel_id, v.published_at DESC, v.created_at DESC`,
  );
  const { results } = await (seedIds !== undefined ? statement.bind(...seedIds) : statement).all<{
      channel_id: string;
      title: string | null;
      handle: string | null;
      description: string | null;
      video_title: string | null;
      video_published_at: string | null;
      latest_video_at: string | null;
      video_count: number | null;
    }>();

  const bySeed = new Map<string, TitleMiningSeed>();
  for (const row of results) {
    const seed = bySeed.get(row.channel_id) ?? {
      channel_id: row.channel_id,
      title: row.title,
      handle: row.handle,
      description: row.description,
      latest_video_at: row.latest_video_at,
      video_count: Number(row.video_count ?? 0),
      videos: [],
    };
    if (row.video_title) {
      seed.videos.push({
        title: row.video_title,
        published_at: row.video_published_at,
      });
    }
    bySeed.set(row.channel_id, seed);
  }

  return [...bySeed.values()];
}

async function enrich(request: Request, env: Env): Promise<Response> {
  const body = await parseOptionalJson<{
    scope?: unknown;
    channel_id?: unknown;
    channelId?: unknown;
    min_score?: unknown;
    minScore?: unknown;
    limit?: unknown;
  }>(request);
  const scope = parseEnrichScope(body.scope);
  const channelId = typeof (body.channel_id ?? body.channelId) === "string"
    ? String(body.channel_id ?? body.channelId)
    : null;
  const minScore = parseOptionalNumberParam(
    body.min_score ?? body.minScore,
    0,
    100,
  );
  const limit = parseBoundedInteger(
    body.limit,
    ENRICH_CONFIG.defaultLimit,
    1,
    ENRICH_CONFIG.maxLimit,
    "limit",
  );
  if (scope === "channel" && !channelId) {
    return json({ error: "channel_id is required for channel scope" }, 400);
  }

  const targets = await enrichTargets(env, { scope, channelId, minScore, limit });
  const creditBreakdown: EnrichCreditBreakdown = {
    channel_video_pages: 0,
    retry_credits: 0,
    other_credits: 0,
    total: 0,
  };
  const client = new ScrapeCreatorsClient(env, {
    onApiLog(event) {
      creditBreakdown.total += 1;
      if (event.isRetry) {
        creditBreakdown.retry_credits += 1;
      } else if (event.endpoint.startsWith("/v1/youtube/channel-videos?")) {
        creditBreakdown.channel_video_pages += 1;
      } else {
        creditBreakdown.other_credits += 1;
      }
    },
  });
  const enriched: unknown[] = [];

  for (const target of targets) {
    const page = await client.getChannelVideosPage(target.channel_id);
    const metrics = activityMetrics(
      Array.isArray(page.videos) ? page.videos : [],
      target.subscriber_count,
    );
    await env.SCOUT_DB.prepare(
      `UPDATE channels
      SET last_upload_at = ?,
        uploads_last_90d = ?,
        median_recent_views = ?,
        recent_velocity = ?,
        enriched_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE channel_id = ?`,
    )
      .bind(
        metrics.lastUploadAt,
        metrics.uploadsLast90d,
        metrics.medianRecentViews,
        metrics.recentVelocity,
        target.channel_id,
      )
      .run();

    const row = await env.SCOUT_DB.prepare("SELECT * FROM channels WHERE channel_id = ?")
      .bind(target.channel_id)
      .first<ChannelRow>();
    if (!row) continue;

    const scoring = scoreFromRow(row);
    await env.SCOUT_DB.prepare(
      `UPDATE channels
      SET score = ?, score_breakdown = ?, updated_at = CURRENT_TIMESTAMP
      WHERE channel_id = ?`,
    )
      .bind(
        scoring.score,
        scoring.breakdown ? JSON.stringify(scoring.breakdown) : null,
        target.channel_id,
      )
      .run();

    enriched.push(await getChannel(env, target.channel_id));
  }

  return json({
    scope,
    targets_considered: targets.length,
    channels_enriched: enriched.length,
    credits_spent_this_run: creditBreakdown.total,
    credits_breakdown: creditBreakdown,
    max_credit_cost: targets.length,
    channels: enriched,
  });
}

async function snapshotNow(request: Request, env: Env): Promise<Response> {
  const body = await parseOptionalJson<{
    scope?: unknown;
    channel_id?: unknown;
    channelId?: unknown;
  }>(request);
  const scope = parseSnapshotScope(body.scope);
  const channelId = typeof (body.channel_id ?? body.channelId) === "string"
    ? String(body.channel_id ?? body.channelId)
    : null;
  if (scope === "channel" && !channelId) {
    return json({ error: "channel_id is required for channel scope" }, 400);
  }

  return json(await runSnapshotJob(env, `${SNAPSHOT_JOB_KIND}:${scope}:manual`, new Date(), {
    scope,
    channelId,
  }));
}

async function runSnapshotJob(
  env: Env,
  kind: string,
  now: Date,
  options: SnapshotRunOptions,
): Promise<SnapshotRunSummary> {
  const startedAt = now.toISOString();
  const candidates = await snapshotTargetRows(env, options);
  const plan = planSnapshotRun(candidates, now, SNAPSHOT_CONFIG.maxPerRun);
  const creditCounter = { value: 0 };
  const client = new ScrapeCreatorsClient(env, {
    onApiLog: () => {
      creditCounter.value += 1;
    },
  });

  await env.SCOUT_DB.prepare(
    "INSERT INTO jobs (kind, started_at, note) VALUES (?, ?, ?)",
  )
    .bind(kind, startedAt, plan.note)
    .run();
  const job = await env.SCOUT_DB.prepare(
    "SELECT id FROM jobs WHERE kind = ? AND started_at = ? ORDER BY id DESC LIMIT 1",
  )
    .bind(kind, startedAt)
    .first<{ id: number }>();
  const jobId = Number(job?.id ?? 0);
  let snapshotted = 0;

  try {
    for (const target of plan.targets) {
      const channel = await client.getChannel(target.channel_id);
      await insertSnapshotAndRefreshChannel(env, channel, now);
      snapshotted += 1;
    }

    await finishSnapshotJob(env, jobId, now, snapshotted, creditCounter.value, plan.note);
  } catch (error) {
    const note = [plan.note, `Failed: ${errorMessage(error)}`].filter(Boolean).join(" ");
    await finishSnapshotJob(env, jobId, now, snapshotted, creditCounter.value, note);
    throw error;
  }

  return {
    job_id: jobId,
    kind,
    scope: options.scope,
    targets_considered: candidates.length,
    max_credit_cost: plan.targets.length,
    channels_snapshotted: snapshotted,
    skipped_recent: plan.skippedRecent,
    truncated: plan.truncated,
    credits_spent_this_run: creditCounter.value,
    note: plan.note,
  };
}

async function snapshotTargetRows(
  env: Env,
  options: SnapshotRunOptions,
): Promise<SnapshotTargetRow[]> {
  const where =
    options.scope === "watchlist"
      ? options.includeSnoozed
        ? "c.status IN ('watchlist', 'snoozed')"
        : "c.status = 'watchlist'"
      : options.scope === "seeds"
        ? "c.is_seed = 1"
        : "c.channel_id = ?";
  const bindings = options.scope === "channel" ? [options.channelId] : [];
  const { results } = await env.SCOUT_DB.prepare(
    `SELECT
      c.channel_id,
      c.handle,
      c.title,
      latest.last_snapshot_at
    FROM channels c
    LEFT JOIN (
      SELECT channel_id, MAX(taken_at) AS last_snapshot_at
      FROM snapshots
      GROUP BY channel_id
    ) latest ON latest.channel_id = c.channel_id
    WHERE ${where}
    ORDER BY c.status = 'watchlist' DESC, c.status = 'snoozed' DESC, c.is_seed DESC, c.updated_at DESC`,
  )
    .bind(...bindings)
    .all<SnapshotTargetRow>();

  return results;
}

async function snapshotTargetCount(
  env: Env,
  options: SnapshotRunOptions,
  now = new Date(),
): Promise<number> {
  const plan = planSnapshotRun(await snapshotTargetRows(env, options), now, SNAPSHOT_CONFIG.maxPerRun);
  return plan.targets.length;
}

async function insertSnapshotAndRefreshChannel(
  env: Env,
  channel: ScrapeCreatorsChannel,
  now: Date,
): Promise<void> {
  if (!channel.channelId) {
    throw new ResponseError("Snapshot channel response did not include channelId.", 502);
  }

  const live = liveChannelFields(channel);
  await env.SCOUT_DB.batch([
    env.SCOUT_DB.prepare(
      `INSERT INTO snapshots (
        channel_id,
        subscriber_count,
        view_count,
        video_count,
        taken_at
      ) VALUES (?, ?, ?, ?, ?)`,
    ).bind(
      channel.channelId,
      live.subscriberCount,
      live.viewCount,
      live.videoCount,
      now.toISOString(),
    ),
    env.SCOUT_DB.prepare(
      `UPDATE channels
      SET handle = COALESCE(?, handle),
        title = COALESCE(?, title),
        description = COALESCE(?, description),
        subscriber_count = ?,
        video_count = ?,
        view_count = ?,
        country = COALESCE(?, country),
        published_at = COALESCE(?, published_at),
        thumbnail_url = COALESCE(?, thumbnail_url),
        raw_json = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE channel_id = ?`,
    ).bind(
      live.handle,
      live.title,
      live.description,
      live.subscriberCount,
      live.videoCount,
      live.viewCount,
      live.country,
      live.publishedAt,
      live.thumbnailUrl,
      live.rawJson,
      channel.channelId,
    ),
  ]);

  const row = await env.SCOUT_DB.prepare("SELECT * FROM channels WHERE channel_id = ?")
    .bind(channel.channelId)
    .first<ChannelRow>();
  if (!row) return;

  const scoring = scoreFromRow(row);
  await env.SCOUT_DB.prepare(
    `UPDATE channels
    SET score = ?, score_breakdown = ?, updated_at = CURRENT_TIMESTAMP
    WHERE channel_id = ?`,
  )
    .bind(
      scoring.score,
      scoring.breakdown ? JSON.stringify(scoring.breakdown) : null,
      channel.channelId,
    )
    .run();
}

async function finishSnapshotJob(
  env: Env,
  jobId: number,
  now: Date,
  channelsSnapshotted: number,
  creditsSpent: number,
  note: string | null,
): Promise<void> {
  if (!jobId) return;
  await env.SCOUT_DB.prepare(
    `UPDATE jobs
    SET finished_at = ?,
      channels_snapshotted = ?,
      credits_spent = ?,
      note = ?
    WHERE id = ?`,
  )
    .bind(now.toISOString(), channelsSnapshotted, creditsSpent, note, jobId)
    .run();
}

function liveChannelFields(channel: ScrapeCreatorsChannel): LiveChannelFields {
  const title = normalizeUnicodeText(channel.name) ?? null;
  const description = normalizeUnicodeText(channel.description) ?? null;
  const subscriberCount = parseCountText(channel.subscriberCount);
  const videoCount = parseCountText(channel.videoCountText);
  const viewCount = parseCountText(channel.viewCountText);
  const normalizedChannel = {
    ...channel,
    name: title,
    description,
    subscriberCount,
  };

  return {
    title,
    description,
    handle: extractHandle(channel.channel ?? null),
    subscriberCount,
    videoCount,
    viewCount,
    country: channel.country ?? null,
    publishedAt: parseJoinedDate(channel.joinedDateText),
    thumbnailUrl: largestThumbnailUrl(channel),
    rawJson: JSON.stringify(normalizedChannel),
  };
}

type EnrichScope = "pool" | "shortlist" | "watchlist" | "channel";

interface EnrichCreditBreakdown {
  channel_video_pages: number;
  retry_credits: number;
  other_credits: number;
  total: number;
}

function parseEnrichScope(value: unknown): EnrichScope {
  if (value === "pool" || value === "shortlist" || value === "watchlist" || value === "channel") {
    return value;
  }
  throw new ResponseError("scope must be pool, shortlist, watchlist, or channel.", 400);
}

function parseSnapshotScope(value: unknown): SnapshotScope {
  if (value === undefined || value === null || value === "") return "watchlist";
  if (value === "watchlist" || value === "seeds" || value === "channel") return value;
  throw new ResponseError("scope must be watchlist, seeds, or channel.", 400);
}

async function enrichTargets(
  env: Env,
  options: {
    scope: EnrichScope;
    channelId: string | null;
    minScore: number | null;
    limit: number;
  },
): Promise<ChannelRow[]> {
  const staleCutoff = new Date(Date.now() - ENRICH_CONFIG.staleAfterDays * 24 * 60 * 60 * 1000).toISOString();
  const clauses = [
    "kind = 'creator'",
    "(enriched_at IS NULL OR enriched_at < ?)",
  ];
  const bindings: unknown[] = [staleCutoff];

  if (options.scope === "channel") {
    clauses.push("channel_id = ?");
    bindings.push(options.channelId);
  } else if (options.scope === "pool") {
    clauses.push("status = 'candidate'", "is_seed = 0");
  } else if (options.scope === "shortlist") {
    clauses.push("status = 'shortlisted'");
  } else {
    clauses.push("status = 'watchlist'");
  }

  if (options.minScore !== null) {
    clauses.push("(score IS NULL OR score >= ?)");
    bindings.push(options.minScore);
  }

  bindings.push(options.limit);

  const { results } = await env.SCOUT_DB.prepare(
    `SELECT * FROM channels
    WHERE ${clauses.join(" AND ")}
    ORDER BY score IS NULL, score DESC, subscriber_count ASC
    LIMIT ?`,
  )
    .bind(...bindings)
    .all<ChannelRow>();
  return results;
}

async function status(env: Env): Promise<Response> {
  await wakeDueSnoozed(env);
  const requestsToday = await env.SCOUT_DB.prepare(
    "SELECT COUNT(*) AS count FROM api_log WHERE date(created_at) = date('now')",
  ).first<{ count: number }>();
  const requestsTotal = await env.SCOUT_DB.prepare(
    "SELECT COUNT(*) AS count FROM api_log",
  ).first<{ count: number }>();
  const creditsMeta = await env.SCOUT_DB.prepare(
    "SELECT value, updated_at FROM meta WHERE key = 'credits_remaining'",
  ).first<{ value: string | null; updated_at: string }>();
  const byStatus = await env.SCOUT_DB.prepare(
    "SELECT status, COUNT(*) AS count FROM channels WHERE outreach_stage = 'none' AND is_active = 0 GROUP BY status",
  ).all<{ status: string; count: number }>();
  const byKind = await env.SCOUT_DB.prepare(
    "SELECT kind, COUNT(*) AS count FROM channels GROUP BY kind",
  ).all<{ kind: string; count: number }>();
  const seedCount = await env.SCOUT_DB.prepare(
    "SELECT COUNT(*) AS count FROM channels WHERE is_seed = 1",
  ).first<{ count: number }>();
  const poolCount = await env.SCOUT_DB.prepare(
    "SELECT COUNT(*) AS count FROM channels WHERE status = 'candidate' AND is_seed = 0 AND kind = 'creator' AND outreach_stage = 'none' AND is_active = 0",
  ).first<{ count: number }>();
  const shortlistCount = await env.SCOUT_DB.prepare(
    "SELECT COUNT(*) AS count FROM channels WHERE status = 'shortlisted' AND outreach_stage = 'none' AND is_active = 0",
  ).first<{ count: number }>();
  const outreachLiveCount = await env.SCOUT_DB.prepare(
    `SELECT COUNT(*) AS count FROM channels WHERE outreach_stage IN (${LIVE_OUTREACH_SQL})`,
  ).first<{ count: number }>();
  const outreachClosedCount = await env.SCOUT_DB.prepare(
    `SELECT COUNT(*) AS count FROM channels WHERE outreach_stage IN (${CLOSED_OUTREACH_SQL})`,
  ).first<{ count: number }>();
  const activeRelationshipCount = await env.SCOUT_DB.prepare(
    "SELECT COUNT(*) AS count FROM channels WHERE is_active = 1",
  ).first<{ count: number }>();
  const outreachTotalCount = await env.SCOUT_DB.prepare(
    `SELECT COUNT(*) AS count FROM channels
    WHERE is_active = 1
      OR outreach_stage IN (${LIVE_OUTREACH_SQL})`,
  ).first<{ count: number }>();
  const lastSearch = await env.SCOUT_DB.prepare(
    `SELECT id, query, pages_used, refs_found, resolved, credits_spent, created_at
    FROM searches
    ORDER BY created_at DESC, id DESC
    LIMIT 1`,
  ).first<{ created_at: string }>();
  const lastSnapshotRun = await env.SCOUT_DB.prepare(
    `SELECT id, kind, started_at, finished_at, channels_snapshotted, credits_spent, note
    FROM jobs
    WHERE kind LIKE 'snapshot:%'
    ORDER BY started_at DESC, id DESC
    LIMIT 1`,
  ).first<{ kind: string; started_at: string; finished_at: string | null }>();
  const snapshotTargets = await snapshotTargetCount(env, { scope: "watchlist" });
  const seedSnapshotTargets = await snapshotTargetCount(env, { scope: "seeds" });
  const lastRun = latestRun(lastSnapshotRun, lastSearch);

  return json({
    credits_remaining: parseCountText(creditsMeta?.value ?? null),
    credits_remaining_updated_at: creditsMeta?.updated_at ?? null,
    requests_today: Number(requestsToday?.count ?? 0),
    requests_total: Number(requestsTotal?.count ?? 0),
    channel_counts: {
      by_status: countMap(byStatus.results, "status"),
      by_kind: countMap(byKind.results, "kind"),
      pool: Number(poolCount?.count ?? 0),
      shortlist: Number(shortlistCount?.count ?? 0),
      seeds: Number(seedCount?.count ?? 0),
      outreach_live: Number(outreachLiveCount?.count ?? 0),
      outreach_closed: Number(outreachClosedCount?.count ?? 0),
      active_relationships: Number(activeRelationshipCount?.count ?? 0),
      outreach_total: Number(outreachTotalCount?.count ?? 0),
    },
    last_search: lastSearch ?? null,
    last_snapshot_run: lastSnapshotRun ?? null,
    last_run: lastRun,
    snapshot_targets: snapshotTargets,
    seed_snapshot_targets: seedSnapshotTargets,
  });
}

async function runSearchIngestion(
  env: Env,
  options: SearchIngestionOptions,
): Promise<SearchIngestionResult> {
  const client = new ScrapeCreatorsClient(env);
  const creditsBefore = await totalCreditsUsed(env);
  const pages: ScrapeCreatorsSearch[] = [];
  let continuationToken: string | undefined;
  let pagesUsed = 0;

  for (let page = 0; page < options.maxPages; page += 1) {
    const pageResult = await client.searchYouTubePage(options.query, {
      uploadDate: options.uploadedWithin,
      continuationToken,
    });
    pages.push(pageResult);
    pagesUsed += 1;
    continuationToken = pageResult.continuationToken;
    if (!continuationToken) break;
  }

  const refs = normalizeSearchChannelRefs(combineSearchPages(pages));
  const failedRefs = await allFailedRefSet(env);
  const { filtered: withoutExisting, skipped: refsSkippedExisting } =
    await dropExistingSearchRefs(env, refs);
  const withoutFailed = withoutExisting.filter(
    (ref) => !failedRefs.has(canonicalRefText(ref)),
  );
  const refsSkippedFailed = withoutExisting.length - withoutFailed.length;
  const refsToResolve = withoutFailed
    .sort((a, b) => b.hitCount - a.hitCount || a.ref.localeCompare(b.ref))
    .slice(0, options.maxResolves);
  const candidates: SearchIngestionResult["candidates"] = [];

  for (const ref of refsToResolve) {
    try {
      const resolved = await client.getChannel(resolveInput(ref));
      if (!resolved.channelId) {
        await recordFailedRef(
          env,
          SEARCH_FAILED_REF_SOURCE,
          ref,
          new Error("Resolved channel response did not include channelId."),
          "missing channelId in ScrapeCreators response",
        );
        continue;
      }

      const existingResolved = await getChannel(env, resolved.channelId);
      if (existingResolved) continue;

      const gateReason = searchQualityGateReason(resolved, options.minSubs);
      if (gateReason) {
        await upsertCandidateChannel(env, resolved, {
          sourceChannelId: null,
          discoveredVia: "search",
          mentionCount: ref.hitCount,
          searchQuery: options.query,
          status: "rejected",
          kindReason: gateReason,
        });
        continue;
      }

      await upsertCandidateChannel(env, resolved, {
        sourceChannelId: null,
        discoveredVia: "search",
        mentionCount: ref.hitCount,
        searchQuery: options.query,
      });
      const stored = await env.SCOUT_DB.prepare(
        "SELECT title, subscriber_count, kind, score FROM channels WHERE channel_id = ?",
      )
        .bind(resolved.channelId)
        .first<Pick<ChannelRow, "title" | "subscriber_count" | "kind" | "score">>();

      if (stored) {
        candidates.push({
          title: stored.title,
          subs: stored.subscriber_count,
          kind: stored.kind,
          score: stored.score,
        });
      }
    } catch (error) {
      if (isPermanentRefError(error)) {
        await recordFailedRef(
          env,
          SEARCH_FAILED_REF_SOURCE,
          ref,
          error,
          searchFailureReason(ref, error),
        );
        continue;
      }

      throw error;
    }
  }

  const creditsAfter = await totalCreditsUsed(env);
  const result: SearchIngestionResult = {
    query: options.query,
    pages_used: pagesUsed,
    refs_found: refs.length,
    refs_skipped_existing: refsSkippedExisting,
    refs_skipped_failed: refsSkippedFailed,
    channels_resolved: candidates.length,
    credits_spent_this_run: creditsAfter - creditsBefore,
    candidates,
  };

  await env.SCOUT_DB.prepare(
    `INSERT INTO searches (
      query,
      pages_used,
      refs_found,
      resolved,
      credits_spent
    ) VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(
      result.query,
      result.pages_used,
      result.refs_found,
      result.channels_resolved,
      result.credits_spent_this_run,
    )
    .run();

  return result;
}

function parseSearchOptions(body: Record<string, unknown>): SearchIngestionOptions {
  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query) {
    throw new ResponseError("query is required", 400);
  }

  return {
    query,
    maxPages: parseBoundedInteger(body.maxPages, 1, 1, 3, "maxPages"),
    maxResolves: parseBoundedInteger(body.maxResolves, 10, 1, 25, "maxResolves"),
    uploadedWithin: parseUploadDate(body.uploadedWithin),
    minSubs: parseBoundedInteger(
      body.min_subs ?? body.minSubs,
      QUALITY_GATE_CONFIG.minSubsSearchResolve,
      0,
      100_000_000,
      "min_subs",
    ),
  };
}

function parseUploadDate(value: unknown): ScrapeCreatorsSearchUploadDate | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (
    value === "today" ||
    value === "this_week" ||
    value === "this_month" ||
    value === "this_year"
  ) {
    return value;
  }

  throw new ResponseError(
    "uploadedWithin must be one of today, this_week, this_month, this_year.",
    400,
  );
}

function combineSearchPages(pages: ScrapeCreatorsSearch[]): ScrapeCreatorsSearch {
  return pages.reduce<ScrapeCreatorsSearch>(
    (combined, page) => ({
      videos: [...(combined.videos ?? []), ...(page.videos ?? [])],
      channels: [...(combined.channels ?? []), ...(page.channels ?? [])],
      playlists: [...(combined.playlists ?? []), ...(page.playlists ?? [])],
      shorts: [...(combined.shorts ?? []), ...(page.shorts ?? [])],
      shelves: [...(combined.shelves ?? []), ...(page.shelves ?? [])],
      lives: [...(combined.lives ?? []), ...(page.lives ?? [])],
    }),
    {},
  );
}

interface ChannelRow {
  channel_id: string;
  handle: string | null;
  title: string | null;
  description: string | null;
  subscriber_count: number | null;
  video_count: number | null;
  view_count: number | null;
  country: string | null;
  published_at: string | null;
  thumbnail_url: string | null;
  is_seed: number;
  seed_locked: number;
  is_active: number;
  discovered_via: string;
  source_channel_id: string | null;
  search_query: string | null;
  status: ChannelStatus;
  outreach_status: string;
  outreach_stage: OutreachStatus;
  contacted_at: string | null;
  last_touch_at: string | null;
  next_followup_at: string | null;
  email_confirmed: number;
  email_confirmed_at: string | null;
  snoozed_until: string | null;
  snooze_reason: string | null;
  snoozed_at: string | null;
  snoozed_from_status: string | null;
  woke_at: string | null;
  raw_json: string;
  mention_count: number;
  kind: ChannelKind;
  kind_reason: string | null;
  kind_locked: number;
  score: number | null;
  score_breakdown: string | null;
  last_upload_at: string | null;
  uploads_last_90d: number | null;
  median_recent_views: number | null;
  enriched_at: string | null;
  recent_velocity: number | null;
  created_at: string;
  updated_at: string;
}

interface SeedListRow extends ChannelRow {
  yield_count: number;
  current_stored_video_count: number;
  current_newest_stored_video_at: string | null;
  freshness_latest_upload_at: string | null;
  freshness_newest_stored_video_at: string | null;
  freshness_stored_video_count: number | null;
  freshness_unmined_count: number | null;
  freshness_unmined_is_lower_bound: number | null;
  freshness_never_mined: number | null;
  freshness_rss_entry_count: number | null;
  freshness_status: SeedFreshnessStatus | null;
  freshness_error: string | null;
  freshness_checked_at: string | null;
}

interface SeedStoredVideoStats {
  stored_video_count: number;
  newest_stored_video_at: string | null;
}

interface SeedFreshnessCacheRow {
  channel_id: string;
  latest_upload_at: string | null;
  newest_stored_video_at: string | null;
  stored_video_count: number;
  unmined_count: number | null;
  unmined_is_lower_bound: number;
  never_mined: number;
  rss_entry_count: number;
  status: SeedFreshnessStatus;
  error: string | null;
  checked_at: string;
}

interface SeedFreshnessView {
  latest_upload_at: string | null;
  newest_stored_video_at: string | null;
  stored_video_count: number;
  unmined_count: number | null;
  unmined_is_lower_bound: boolean;
  never_mined: boolean;
  rss_entry_count: number;
  status: SeedFreshnessStatus;
  error: string | null;
  checked_at: string;
  stale: boolean;
}

interface ChannelSummaryRow extends ChannelRow {
  source_seed_title: string | null;
  sponsor_scan_total?: number | null;
  sponsor_scan_sponsored?: number | null;
  sponsor_scan_last_sponsored?: string | null;
  sponsor_scan_scanned_at?: string | null;
  latest_outreach_note?: string | null;
}

interface SnapshotTargetRow extends SnapshotTargetState {
  handle: string | null;
  title: string | null;
}

interface SnapshotRunSummary {
  job_id: number;
  kind: string;
  scope: SnapshotScope;
  targets_considered: number;
  max_credit_cost: number;
  channels_snapshotted: number;
  skipped_recent: number;
  truncated: number;
  credits_spent_this_run: number;
  note: string | null;
}

type SnapshotScope = "watchlist" | "seeds" | "channel";

interface VideoScanRow {
  id: number;
  channel_id: string;
  video_id: string;
  video_title: string | null;
  published_at: string | null;
  scanned_at: string;
  sponsorblock_has_sponsor: number | null;
  sponsorblock_segments_json: string | null;
  error: string | null;
}

interface ChannelSponsorRollup {
  sponsor_scan_total: number;
  sponsor_scan_sponsored: number;
  sponsor_scan_last_sponsored: string | null;
  sponsor_scan_scanned_at: string | null;
}

interface SnapshotRunOptions {
  scope: SnapshotScope;
  channelId?: string | null;
  includeSnoozed?: boolean;
}

interface LiveChannelFields {
  title: string | null;
  description: string | null;
  handle: string | null;
  subscriberCount: number | null;
  videoCount: number | null;
  viewCount: number | null;
  country: string | null;
  publishedAt: string | null;
  thumbnailUrl: string | null;
  rawJson: string;
}

interface AggregatedRef {
  type: ChannelRef["type"];
  ref: string;
  collab: boolean;
  mentionCount: number;
}

interface SearchIngestionOptions {
  query: string;
  maxPages: number;
  maxResolves: number;
  uploadedWithin?: ScrapeCreatorsSearchUploadDate;
  minSubs: number;
}

interface SearchIngestionResult {
  query: string;
  pages_used: number;
  refs_found: number;
  refs_skipped_existing: number;
  refs_skipped_failed: number;
  channels_resolved: number;
  credits_spent_this_run: number;
  candidates: Array<{
    title: string | null;
    subs: number | null;
    kind: ChannelKind;
    score: number | null;
  }>;
}

interface ExpansionResult {
  videos_fetched: number;
  pages_used: number;
  refs_found: number;
  refs_skipped_existing: number;
  refs_skipped_failed: number;
  channels_resolved: number;
  credits_spent_this_run: number;
  candidates: unknown[];
}

async function expandSeed(
  channelId: string,
  request: Request,
  env: Env,
): Promise<Response> {
  const seed = await requireUnlockedSeed(env, channelId);

  const body = await parseOptionalJson<{
    maxPages?: unknown;
    maxResolves?: unknown;
  }>(request);
  const maxPages = parseBoundedInteger(body.maxPages, 2, 1, 3, "maxPages");
  const maxResolves = parseBoundedInteger(
    body.maxResolves,
    15,
    1,
    50,
    "maxResolves",
  );
  const client = new ScrapeCreatorsClient(env);

  return json(await runSeedExpansion(env, client, seed, maxPages, maxResolves));
}

async function expandAllSeeds(): Promise<Response> {
  return json({
    error: "server_expand_all_disabled",
    message: "Server-side Expand All is disabled to avoid Workers subrequest limits. Use the UI client-side orchestrator, which calls each per-seed expand endpoint sequentially.",
  }, 409);
}

async function runSeedExpansion(
  env: Env,
  client: ScrapeCreatorsClient,
  seed: ChannelRow,
  maxPages: number,
  maxResolves: number,
  creditCounter?: { value: number },
): Promise<ExpansionResult> {
  const authorizedSeed = await requireUnlockedSeed(env, seed.channel_id);
  const channelId = authorizedSeed.channel_id;
  const creditsBefore = creditCounter ? creditCounter.value : await totalCreditsUsed(env);
  const fetchedVideos: ScrapeCreatorsVideoListItem[] = [];
  let continuationToken: string | undefined;
  let pagesUsed = 0;

  for (let page = 0; page < maxPages; page += 1) {
    const pageResult = await client.getChannelVideosPage(
      channelId,
      continuationToken,
    );
    pagesUsed += 1;
    fetchedVideos.push(...(Array.isArray(pageResult.videos) ? pageResult.videos : []));
    continuationToken = pageResult.continuationToken;
    if (!continuationToken) break;
  }

  await upsertVideos(env, channelId, fetchedVideos);
  await computeSeedQueries(env, [channelId]);

  const aggregated = aggregateRefs(authorizedSeed, fetchedVideos);
  const failedRefs = await failedRefSet(env, channelId);
  const { filtered: withoutExisting, skipped: refsSkippedExisting } =
    await dropExistingRefs(env, aggregated);
  const withoutFailed = withoutExisting.filter(
    (ref) => !failedRefs.has(canonicalRefText(ref)),
  );
  const refsSkippedFailed = withoutExisting.length - withoutFailed.length;
  const refsToResolve = withoutFailed
    .sort((a, b) => b.mentionCount - a.mentionCount || a.ref.localeCompare(b.ref))
    .slice(0, maxResolves);
  const candidates: unknown[] = [];

  for (const ref of refsToResolve) {
    try {
      const resolved = await client.getChannel(resolveInput(ref));
      if (!resolved.channelId) {
        await recordFailedRef(
          env,
          channelId,
          ref,
          new Error("Resolved channel response did not include channelId."),
        );
        continue;
      }

      const existingResolved = await getChannel(env, resolved.channelId);
      if (existingResolved) {
        continue;
      }

      const dormantReason = dormantChannelReason(resolved);
      if (dormantReason) {
        await upsertCandidateChannel(env, resolved, {
          sourceChannelId: channelId,
          discoveredVia: ref.collab ? "collab" : "mention",
          mentionCount: ref.mentionCount,
          status: "rejected",
          kindReason: dormantReason,
        });
        continue;
      }

      await upsertCandidateChannel(env, resolved, {
        sourceChannelId: channelId,
        discoveredVia: ref.collab ? "collab" : "mention",
        mentionCount: ref.mentionCount,
      });
      const stored = await getChannel(env, resolved.channelId);
      if (stored) candidates.push(stored);
    } catch (error) {
      if (isPermanentRefError(error)) {
        await recordFailedRef(env, channelId, ref, error);
        continue;
      }

      throw error;
    }
  }

  const creditsAfter = creditCounter ? creditCounter.value : await totalCreditsUsed(env);

  return {
    videos_fetched: fetchedVideos.length,
    pages_used: pagesUsed,
    refs_found: aggregated.length,
    refs_skipped_existing: refsSkippedExisting,
    refs_skipped_failed: refsSkippedFailed,
    channels_resolved: candidates.length,
    credits_spent_this_run: creditsAfter - creditsBefore,
    candidates,
  };
}

async function upsertSeedChannel(
  env: Env,
  channel: ScrapeCreatorsChannel,
): Promise<void> {
  await upsertChannel(env, channel, {
    discoveredVia: "manual",
    status: "candidate",
    sourceChannelId: null,
    mentionCount: 0,
    isSeed: true,
  });
}

async function upsertCandidateChannel(
  env: Env,
  channel: ScrapeCreatorsChannel,
  options: {
    discoveredVia: "mention" | "collab" | "search";
    sourceChannelId: string | null;
    mentionCount: number;
    searchQuery?: string | null;
    status?: ChannelStatus;
    kindReason?: string | null;
  },
): Promise<void> {
  await upsertChannel(env, channel, {
    discoveredVia: options.discoveredVia,
    status: options.status ?? "candidate",
    sourceChannelId: options.sourceChannelId,
    mentionCount: options.mentionCount,
    searchQuery: options.searchQuery ?? null,
    isSeed: false,
    kindReason: options.kindReason ?? null,
  });
}

async function upsertChannel(
  env: Env,
  channel: ScrapeCreatorsChannel,
  options: {
    discoveredVia: DiscoveredVia;
    status: ChannelStatus;
    sourceChannelId: string | null;
    mentionCount: number;
    searchQuery?: string | null;
    isSeed?: boolean;
    kindReason?: string | null;
  },
): Promise<void> {
  const title = normalizeUnicodeText(channel.name) ?? null;
  const channelUrl = channel.channel ?? null;
  const handle = extractHandle(channelUrl);
  const description = normalizeUnicodeText(channel.description) ?? null;
  const subscriberCount = parseCountText(channel.subscriberCount);
  const videoCount = parseCountText(channel.videoCountText);
  const viewCount = parseCountText(channel.viewCountText);
  const country = channel.country ?? null;
  const publishedAt = parseJoinedDate(channel.joinedDateText);
  const thumbnailUrl = largestThumbnailUrl(channel);
  const normalizedChannel = {
    ...channel,
    name: title,
    description,
    subscriberCount,
  };
  const rawJson = JSON.stringify(normalizedChannel);
  const classification = await classificationForUpsert(env, {
    channel_id: channel.channelId,
    handle,
    title,
    description,
    subscriber_count: subscriberCount,
    raw_json: rawJson,
  }, options.status);
  const scoring = scoreChannel({
    subscriber_count: subscriberCount,
    video_count: videoCount,
    view_count: viewCount,
    published_at: publishedAt,
    discovered_via: options.discoveredVia,
    mention_count: options.mentionCount,
    raw_json: rawJson,
    kind: classification.kind,
  });
  const kindReason = options.kindReason ?? classification.reason;

  await env.SCOUT_DB.prepare(
    `INSERT INTO channels (
      channel_id,
      handle,
      title,
      description,
      subscriber_count,
      video_count,
      view_count,
      country,
      published_at,
      thumbnail_url,
      is_seed,
      discovered_via,
      source_channel_id,
      status,
      mention_count,
      search_query,
      kind,
      kind_reason,
      score,
      score_breakdown,
      raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(channel_id) DO UPDATE SET
      handle = excluded.handle,
      title = excluded.title,
      description = excluded.description,
      subscriber_count = excluded.subscriber_count,
      video_count = excluded.video_count,
      view_count = excluded.view_count,
      country = excluded.country,
      published_at = excluded.published_at,
      thumbnail_url = excluded.thumbnail_url,
      is_seed = CASE WHEN excluded.is_seed = 1 THEN 1 ELSE channels.is_seed END,
      discovered_via = excluded.discovered_via,
      source_channel_id = COALESCE(excluded.source_channel_id, channels.source_channel_id),
      status = CASE WHEN excluded.is_seed = 1 THEN channels.status ELSE excluded.status END,
      mention_count = excluded.mention_count,
      search_query = excluded.search_query,
      kind = CASE WHEN channels.kind_locked = 1 THEN channels.kind ELSE excluded.kind END,
      kind_reason = CASE WHEN channels.kind_locked = 1 THEN channels.kind_reason ELSE excluded.kind_reason END,
      score = CASE WHEN channels.kind_locked = 1 THEN channels.score ELSE excluded.score END,
      score_breakdown = CASE WHEN channels.kind_locked = 1 THEN channels.score_breakdown ELSE excluded.score_breakdown END,
      raw_json = excluded.raw_json,
      updated_at = CURRENT_TIMESTAMP`,
  )
    .bind(
      channel.channelId,
      handle,
      title,
      description,
      subscriberCount,
      videoCount,
      viewCount,
      country,
      publishedAt,
      thumbnailUrl,
      options.isSeed ? 1 : 0,
      options.discoveredVia,
      options.sourceChannelId,
      options.status,
      options.mentionCount,
      options.searchQuery ?? null,
      classification.kind,
      kindReason,
      scoring.score,
      scoring.breakdown ? JSON.stringify(scoring.breakdown) : null,
      rawJson,
    )
    .run();
}

async function getChannel(env: Env, channelId: string): Promise<unknown> {
  const row = await env.SCOUT_DB.prepare("SELECT * FROM channels WHERE channel_id = ?")
    .bind(channelId)
    .first<ChannelRow>();
  if (!row) return null;
  return {
    ...row,
    is_seed: row.is_seed === 1,
    seed_locked: row.seed_locked === 1,
    is_active: row.is_active === 1,
    outreach_status: row.outreach_stage,
  };
}

async function upsertVideos(
  env: Env,
  channelId: string,
  videos: ScrapeCreatorsVideoListItem[],
): Promise<void> {
  if (videos.length === 0) return;

  const statements = videos
    .filter((video) => video.id)
    .map((video) =>
      env.SCOUT_DB.prepare(
        `INSERT INTO videos (
            video_id,
            channel_id,
            title,
            description,
            view_count,
            published_at,
            raw_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(video_id) DO UPDATE SET
            channel_id = excluded.channel_id,
            title = excluded.title,
            description = excluded.description,
            view_count = excluded.view_count,
            published_at = excluded.published_at,
            raw_json = excluded.raw_json`,
      ).bind(
        video.id,
        channelId,
        video.title ?? null,
        video.description ?? null,
        video.viewCountInt ?? parseCountText(video.viewCountText),
        video.publishedTime ?? null,
        JSON.stringify(video),
      ),
    );

  if (statements.length === 0) return;

  await env.SCOUT_DB.batch(statements);
}

function aggregateRefs(
  seed: ChannelRow,
  videos: ScrapeCreatorsVideoListItem[],
): AggregatedRef[] {
  const refs = new Map<string, AggregatedRef>();

  for (const video of videos) {
    for (const ref of mineChannelRefs(video.description, {
      seedHandle: seed.handle,
      seedChannelId: seed.channel_id,
    })) {
      const key = canonicalRefText(ref);
      const existing = refs.get(key);

      if (existing) {
        existing.mentionCount += 1;
        existing.collab = existing.collab || ref.collab;
        continue;
      }

      refs.set(key, {
        type: ref.type,
        ref: ref.ref,
        collab: ref.collab,
        mentionCount: 1,
      });
    }
  }

  return [...refs.values()];
}

async function dropExistingRefs(
  env: Env,
  refs: AggregatedRef[],
): Promise<{ filtered: AggregatedRef[]; skipped: number }> {
  if (refs.length === 0) return { filtered: [], skipped: 0 };

  const { results } = await env.SCOUT_DB.prepare(
    "SELECT channel_id, handle FROM channels",
  ).all<{ channel_id: string; handle: string | null }>();
  const knownChannelIds = new Set(results.map((row) => row.channel_id));
  const knownHandles = new Set(
    results
      .map((row) => row.handle?.replace(/^@/, "").toLowerCase())
      .filter((handle): handle is string => Boolean(handle)),
  );
  const filtered = refs.filter((ref) => {
    if (ref.type === "channelId") return !knownChannelIds.has(ref.ref);
    if (ref.type === "handle") return !knownHandles.has(ref.ref.toLowerCase());
    return true;
  });

  return { filtered, skipped: refs.length - filtered.length };
}

async function dropExistingSearchRefs(
  env: Env,
  refs: SearchChannelRef[],
): Promise<{ filtered: SearchChannelRef[]; skipped: number }> {
  if (refs.length === 0) return { filtered: [], skipped: 0 };

  const { results } = await env.SCOUT_DB.prepare(
    "SELECT channel_id, handle FROM channels",
  ).all<{ channel_id: string; handle: string | null }>();
  const knownChannelIds = new Set(results.map((row) => row.channel_id));
  const knownHandles = new Set(
    results
      .map((row) => row.handle?.replace(/^@/, "").toLowerCase())
      .filter((handle): handle is string => Boolean(handle)),
  );
  const filtered = refs.filter((ref) => {
    if (ref.type === "channelId") return !knownChannelIds.has(ref.ref);
    if (ref.type === "handle") return !knownHandles.has(ref.ref.toLowerCase());
    return true;
  });

  return { filtered, skipped: refs.length - filtered.length };
}

async function failedRefSet(
  env: Env,
  sourceChannelId: string,
): Promise<Set<string>> {
  const { results } = await env.SCOUT_DB.prepare(
    "SELECT ref_text FROM failed_refs WHERE source_channel_id = ?",
  )
    .bind(sourceChannelId)
    .all<{ ref_text: string }>();

  return new Set(results.map((row) => row.ref_text));
}

async function allFailedRefSet(env: Env): Promise<Set<string>> {
  const { results } = await env.SCOUT_DB.prepare(
    "SELECT ref_text FROM failed_refs",
  ).all<{ ref_text: string }>();

  return new Set(results.map((row) => row.ref_text));
}

async function recordFailedRef(
  env: Env,
  sourceChannelId: string,
  ref: { type: string; ref: string },
  error: unknown,
  failureReason = "resolve failed",
): Promise<void> {
  await env.SCOUT_DB.prepare(
    `INSERT INTO failed_refs (ref_text, source_channel_id, error, failure_reason)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(ref_text, source_channel_id) DO UPDATE SET
      error = excluded.error,
      failure_reason = excluded.failure_reason`,
  )
    .bind(canonicalRefText(ref), sourceChannelId, errorMessage(error), failureReason)
    .run();
}

async function totalCreditsUsed(env: Env): Promise<number> {
  const row = await env.SCOUT_DB.prepare(
    "SELECT COALESCE(SUM(credits_estimated), 0) AS credits FROM api_log",
  ).first<{ credits: number }>();
  return Number(row?.credits ?? 0);
}

async function classificationForUpsert(
  env: Env,
  channel: {
    channel_id: string;
    handle: string | null;
    title: string | null;
    description: string | null;
    subscriber_count?: number | null;
    raw_json: string | null;
  },
  status: ChannelStatus,
): Promise<Classification> {
  return classifyChannel(channel, await seedIdentities(env));
}

async function seedIdentities(env: Env): Promise<SeedIdentity[]> {
  const { results } = await env.SCOUT_DB.prepare(
    "SELECT channel_id, handle, title, raw_json FROM channels WHERE is_seed = 1",
  ).all<SeedIdentity>();
  return results;
}

function scoreFromRow(row: ChannelRow): ScoreResult {
  return scoreChannel({
    subscriber_count: parseCountText(row.subscriber_count),
    video_count: parseCountText(row.video_count),
    view_count: parseCountText(row.view_count),
    published_at: row.published_at,
    discovered_via: row.discovered_via,
    mention_count: parseCountText(row.mention_count),
    raw_json: row.raw_json,
    kind: row.kind,
    last_upload_at: row.last_upload_at,
    uploads_last_90d: row.uploads_last_90d,
    median_recent_views: row.median_recent_views,
    enriched_at: row.enriched_at,
    recent_velocity: row.recent_velocity,
    email_confirmed: row.email_confirmed,
  });
}

function initialDistribution(): Record<ChannelKind, number> {
  return {
    creator: 0,
    brand: 0,
    alt: 0,
  };
}

function channelSummary(
  row: ChannelSummaryRow,
  growth?: GrowthMetrics,
): unknown {
  const raw = parseRaw(row.raw_json);
  const sponsorTotal = Number(row.sponsor_scan_total ?? 0);
  const sponsorSponsored = Number(row.sponsor_scan_sponsored ?? 0);
  return {
    channel_id: row.channel_id,
    title: row.title,
    handle: row.handle,
    thumbnail_url: row.thumbnail_url,
    is_seed: row.is_seed === 1,
    seed_locked: row.seed_locked === 1,
    is_active: row.is_active === 1,
    subscriber_count: row.subscriber_count,
    score: row.score,
    score_breakdown: parseScoreBreakdown(row.score_breakdown),
    kind: row.kind,
    kind_reason: row.kind_reason,
    discovered_via: row.discovered_via,
    status: row.status,
    outreach_status: row.outreach_stage ?? "none",
    contacted_at: row.contacted_at ?? null,
    last_touch_at: row.last_touch_at ?? null,
    next_followup_at: row.next_followup_at ?? null,
    snoozed_until: row.snoozed_until ?? null,
    snooze_reason: row.snooze_reason ?? null,
    snoozed_at: row.snoozed_at ?? null,
    snoozed_from_status: row.snoozed_from_status ?? null,
    woke_at: row.woke_at ?? null,
    latest_outreach_note: row.latest_outreach_note ?? null,
    source_seed_title: row.source_seed_title,
    search_query: row.search_query,
    mention_count: row.mention_count,
    last_upload_at: row.last_upload_at,
    uploads_last_90d: row.uploads_last_90d,
    median_recent_views: row.median_recent_views,
    enriched_at: row.enriched_at,
    recent_velocity: row.recent_velocity,
    email_present: emailPresent(raw),
    email_confirmed: row.email_confirmed === 1,
    email_confirmed_at: row.email_confirmed_at ?? null,
    social_links: socialLinks(raw),
    contact_links: contactLinks(raw),
    sponsor_scan_total: sponsorTotal,
    sponsor_scan_sponsored: sponsorSponsored,
    sponsorship_rate: sponsorTotal > 0 ? Number((sponsorSponsored / sponsorTotal).toFixed(3)) : null,
    last_sponsored_date: row.sponsor_scan_last_sponsored ?? null,
    sponsor_scan_scanned_at: row.sponsor_scan_scanned_at ?? null,
    sponsorshipRate: sponsorTotal > 0 ? Number((sponsorSponsored / sponsorTotal).toFixed(3)) : null,
    lastSponsoredDate: row.sponsor_scan_last_sponsored ?? null,
    ...growthFields(growth),
  };
}

async function sponsorRollupMapForChannels(
  env: Env,
  channelIds: string[],
): Promise<Map<string, ChannelSponsorRollup>> {
  const unique = [...new Set(channelIds)].filter(Boolean);
  const rollups = new Map<string, ChannelSponsorRollup>();
  if (unique.length === 0) return rollups;

  const placeholders = unique.map(() => "?").join(", ");
  const { results } = await env.SCOUT_DB.prepare(
    `WITH latest_scans AS (
      SELECT channel_id, MAX(scanned_at) AS scanned_at
      FROM video_scans
      WHERE channel_id IN (${placeholders})
      GROUP BY channel_id
    )
    SELECT
      vs.channel_id,
      COUNT(*) AS sponsor_scan_total,
      SUM(CASE WHEN vs.sponsorblock_has_sponsor = 1 THEN 1 ELSE 0 END) AS sponsor_scan_sponsored,
      MAX(CASE WHEN vs.sponsorblock_has_sponsor = 1 THEN vs.published_at ELSE NULL END) AS sponsor_scan_last_sponsored,
      MAX(vs.scanned_at) AS sponsor_scan_scanned_at
    FROM video_scans vs
    INNER JOIN latest_scans ls
      ON ls.channel_id = vs.channel_id
      AND ls.scanned_at = vs.scanned_at
    GROUP BY vs.channel_id`,
  )
    .bind(...unique)
    .all<ChannelSponsorRollup & { channel_id: string }>();

  for (const row of results) {
    rollups.set(row.channel_id, {
      sponsor_scan_total: Number(row.sponsor_scan_total ?? 0),
      sponsor_scan_sponsored: Number(row.sponsor_scan_sponsored ?? 0),
      sponsor_scan_last_sponsored: row.sponsor_scan_last_sponsored ?? null,
      sponsor_scan_scanned_at: row.sponsor_scan_scanned_at ?? null,
    });
  }

  return rollups;
}

function sponsorRollupFields(rollup?: ChannelSponsorRollup): Record<string, unknown> {
  const total = Number(rollup?.sponsor_scan_total ?? 0);
  const sponsored = Number(rollup?.sponsor_scan_sponsored ?? 0);
  const rate = total > 0 ? Number((sponsored / total).toFixed(3)) : null;
  const lastDate = rollup?.sponsor_scan_last_sponsored ?? null;
  const scannedAt = rollup?.sponsor_scan_scanned_at ?? null;

  return {
    sponsor_scan_total: total,
    sponsor_scan_sponsored: sponsored,
    sponsorship_rate: rate,
    last_sponsored_date: lastDate,
    sponsor_scan_scanned_at: scannedAt,
    sponsorshipRate: rate,
    lastSponsoredDate: lastDate,
  };
}

async function growthMapForChannels(
  env: Env,
  channelIds: string[],
): Promise<Map<string, GrowthMetrics>> {
  const unique = [...new Set(channelIds)].filter(Boolean);
  const growth = new Map<string, GrowthMetrics>();
  if (unique.length === 0) return growth;

  const placeholders = unique.map(() => "?").join(", ");
  const { results } = await env.SCOUT_DB.prepare(
    `SELECT channel_id, subscriber_count, view_count, video_count, taken_at
    FROM snapshots
    WHERE channel_id IN (${placeholders})
    ORDER BY channel_id, taken_at`,
  )
    .bind(...unique)
    .all<SnapshotPoint & { channel_id: string }>();
  const grouped = new Map<string, SnapshotPoint[]>();

  for (const snapshot of results) {
    const list = grouped.get(snapshot.channel_id) ?? [];
    list.push({
      subscriber_count: snapshot.subscriber_count,
      view_count: snapshot.view_count,
      video_count: snapshot.video_count,
      taken_at: snapshot.taken_at,
    });
    grouped.set(snapshot.channel_id, list);
  }

  for (const channelId of unique) {
    growth.set(channelId, computeGrowthMetrics(grouped.get(channelId) ?? []));
  }

  return growth;
}

function growthFields(growth?: GrowthMetrics): Record<string, unknown> {
  return {
    subs_growth_7d: growth?.subs_growth_7d ?? null,
    subs_growth_7d_days: growth?.subs_growth_7d_days ?? null,
    subs_growth_30d: growth?.subs_growth_30d ?? null,
    subs_growth_30d_days: growth?.subs_growth_30d_days ?? null,
    views_growth_30d: growth?.views_growth_30d ?? null,
    views_growth_30d_days: growth?.views_growth_30d_days ?? null,
    tracking_days: growth?.tracking_days ?? null,
    first_snapshot_at: growth?.first_snapshot_at ?? null,
    latest_snapshot_at: growth?.latest_snapshot_at ?? null,
    snapshots: growth?.snapshots ?? [],
  };
}

function parseScoreBreakdown(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function emailPresent(raw: unknown): boolean {
  return Boolean(raw && typeof raw === "object" && (raw as Record<string, unknown>).email);
}

function socialLinks(raw: unknown): string[] {
  return extractLinks(raw).filter((link) => {
    const lower = link.toLowerCase();
    return (
      lower.includes("instagram.com") ||
      lower.includes("tiktok.com") ||
      lower.includes("twitter.com") ||
      lower.includes("x.com")
    );
  });
}

function contactLinks(raw: unknown): Array<{ type: string; label: string; url: string }> {
  return sanitizedContactLinks(raw);
}

function isChannelKind(value: unknown): value is ChannelKind {
  return (
    value === "creator" ||
    value === "brand" ||
    value === "alt"
  );
}

function parseKindList(value: string | null): ChannelKind[] {
  const values = (value ?? "creator")
    .split(",")
    .map((kind) => kind.trim())
    .filter(Boolean);

  if (values.length === 0) {
    throw new ResponseError("kind must include at least one value.", 400);
  }

  const unique = [...new Set(values)];
  for (const kind of unique) {
    if (!isChannelKind(kind)) {
      throw new ResponseError("Invalid kind", 400);
    }
  }

  return unique as ChannelKind[];
}

function parseDiscoveryFilter(value: string | null): ShortlistDiscoveryFilter | null {
  if (value === null || value === "") return null;
  if (value === "mention" || value === "collab" || value === "search") return value;
  throw new ResponseError("discovered_via must be mention, collab, or search.", 400);
}

function parseShortlistStatusFilter(value: string | null): ShortlistStatusFilter | null {
  if (value === null || value === "") return null;
  if (value === "all") return value;
  if (VALID_STATUSES.has(value as ChannelStatus)) return value as ChannelStatus;
  throw new ResponseError("status must be candidate, shortlisted, watchlist, snoozed, rejected, or all.", 400);
}

async function wakeDueSnoozed(env: Env): Promise<number> {
  const result = await env.SCOUT_DB.prepare(
    `UPDATE channels
    SET status = 'candidate',
        woke_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE status = 'snoozed'
      AND snoozed_until IS NOT NULL
      AND datetime(snoozed_until) <= CURRENT_TIMESTAMP`,
  ).run();
  return Number(result.meta.changes ?? 0);
}

function parseOutreachStatusFilter(value: string | null): OutreachStatus | null {
  if (value === null || value === "") return null;
  if (VALID_OUTREACH_STATUSES.has(value as OutreachStatus)) return value as OutreachStatus;
  throw new ResponseError("outreach_status must be a valid outreach status.", 400);
}

function parseShortlistSeedFilter(value: string | null): StageSeedFilter {
  if (value === null || value === "") return null;
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  throw new ResponseError("is_seed must be 0, 1, true, or false.", 400);
}

function parseBooleanParam(value: string | null, fallback: boolean): boolean {
  if (value === null || value === "") return fallback;
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  throw new ResponseError("Expected boolean query value.", 400);
}

function parseNumberParam(
  value: string | null,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new ResponseError(`Expected number from ${min} to ${max}.`, 400);
  }

  return Math.round(parsed);
}

function parseOptionalNumberParam(
  value: unknown,
  min: number,
  max: number,
): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new ResponseError(`Expected number from ${min} to ${max}.`, 400);
  }

  return Math.round(parsed);
}

async function requireAdmin(request: Request, env: Env): Promise<Response | null> {
  const decision = await evaluateAdminAuth(env.SCOUT_DB, request, env.SCOUT_ADMIN_KEY);
  if (decision.ok) return null;

  if (decision.delay) {
    await delay(AUTH_FAILURE_DELAY_MS);
  }

  return json(
    {
      error: decision.status === 429 ? "rate_limited" : "Unauthorized",
      message: decision.message,
      retry_after_seconds: decision.retryAfterSeconds ?? null,
    },
    decision.status ?? 401,
    decision.retryAfterSeconds
      ? { "Retry-After": String(decision.retryAfterSeconds) }
      : undefined,
  );
}

async function parseJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new ResponseError("Request body must be valid JSON.", 400);
  }
}

async function parseOptionalJson<T extends object>(request: Request): Promise<T> {
  const text = await request.text();
  if (!text.trim()) return {} as T;

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ResponseError("Request body must be valid JSON.", 400);
  }
}

function parseBoundedInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  name: string,
): number {
  if (value === undefined || value === null) return fallback;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    throw new ResponseError(`${name} must be an integer from ${min} to ${max}.`, 400);
  }

  return value;
}

function extractHandle(channelUrl: string | null): string | null {
  if (!channelUrl) return null;

  try {
    const url = new URL(channelUrl);
    const match = url.pathname.match(/\/@([^/?]+)/);
    return match?.[1] ?? null;
  } catch {
    const match = channelUrl.match(/@([^/?]+)/);
    return match?.[1] ?? null;
  }
}

function largestThumbnailUrl(channel: ScrapeCreatorsChannel): string | null {
  const sources = channel.avatar?.image?.sources ?? [];
  if (sources.length === 0) return null;

  return [...sources].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0].url;
}

function canonicalRefText(ref: { type: string; ref: string }): string {
  return `${ref.type}:${ref.ref.toLowerCase()}`;
}

function resolveInput(ref: { type: string; ref: string }): string {
  if (ref.type === "handle") return ref.ref;
  return ref.ref;
}

function latestRun(
  lastSnapshotRun: { kind: string; started_at: string; finished_at: string | null } | null,
  lastSearch: { created_at?: string } | null,
): { kind: string; at: string } | null {
  const snapshotAt = lastSnapshotRun?.finished_at ?? lastSnapshotRun?.started_at ?? null;
  const searchAt = lastSearch?.created_at ?? null;
  if (!snapshotAt && !searchAt) return null;
  if (!snapshotAt) return { kind: "search", at: searchAt as string };
  if (!searchAt) return { kind: "snapshot", at: snapshotAt };
  return new Date(snapshotAt).getTime() >= new Date(searchAt).getTime()
    ? { kind: "snapshot", at: snapshotAt }
    : { kind: "search", at: searchAt };
}

function countMap<T extends Record<string, unknown> & { count: unknown }>(
  rows: T[],
  key: keyof T,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const name = String(row[key] ?? "unknown");
    counts[name] = Number(row.count ?? 0);
  }

  return counts;
}

function searchFailureReason(ref: { type: string; ref: string }, error: unknown): string {
  if (ref.type === "url" && /\/watch\?|youtu\.be\//i.test(ref.ref)) {
    return "video URL was incorrectly treated as a channel ref";
  }

  if (error instanceof ScrapeCreatorsApiError && error.status === 404) {
    return "ScrapeCreators could not resolve the channel ref";
  }

  return "permanent ScrapeCreators resolve failure";
}

function isPermanentRefError(error: unknown): boolean {
  return (
    error instanceof ScrapeCreatorsApiError &&
    error.kind === "http_error" &&
    [400, 403, 404].includes(error.status)
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 1000);
  return String(error).slice(0, 1000);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function json(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return Response.json(body, {
    status,
    headers: {
      ...SECURITY_HEADERS,
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

async function assetResponse(request: Request, env: Env): Promise<Response> {
  if (!env.ASSETS) {
    return json({ error: "Not found" }, 404);
  }

  const response = await env.ASSETS.fetch(request);
  return withSecurityHeaders(response);
}

function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

class ResponseError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ResponseError";
  }
}
