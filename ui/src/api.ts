export type ChannelKind = "creator" | "brand" | "alt";
export type ChannelStatus = "candidate" | "shortlisted" | "watchlist" | "snoozed" | "rejected";
export type OutreachStatus = "none" | "sent" | "replied" | "in_talks" | "signed" | "passed" | "ghosted";
export type DiscoverySource = "mention" | "collab" | "search";

export interface ContactLink {
  type: string;
  label: string;
  url: string;
}

export interface ChannelCardRow {
  channel_id: string;
  title: string | null;
  handle: string | null;
  thumbnail_url: string | null;
  is_seed: boolean;
  subscriber_count: number | null;
  score: number | null;
  score_breakdown: ScoreBreakdown | null;
  kind: ChannelKind;
  kind_reason: string | null;
  discovered_via: string;
  status: ChannelStatus;
  outreach_status: OutreachStatus;
  contacted_at: string | null;
  last_touch_at: string | null;
  next_followup_at: string | null;
  snoozed_until: string | null;
  snooze_reason: string | null;
  snoozed_at: string | null;
  snoozed_from_status: "candidate" | "watchlist" | null;
  woke_at: string | null;
  latest_outreach_note: string | null;
  source_seed_title: string | null;
  search_query: string | null;
  mention_count: number;
  email_present: boolean;
  email_confirmed: boolean;
  email_confirmed_at: string | null;
  social_links: string[];
  contact_links: ContactLink[];
  sponsor_scan_total: number;
  sponsor_scan_sponsored: number;
  sponsorship_rate: number | null;
  last_sponsored_date: string | null;
  sponsor_scan_scanned_at: string | null;
  last_upload_at: string | null;
  uploads_last_90d: number | null;
  median_recent_views: number | null;
  enriched_at: string | null;
  recent_velocity: number | null;
  subs_growth_7d: number | null;
  subs_growth_7d_days: number | null;
  subs_growth_30d: number | null;
  subs_growth_30d_days: number | null;
  views_growth_30d: number | null;
  views_growth_30d_days: number | null;
  tracking_days: number | null;
  first_snapshot_at: string | null;
  latest_snapshot_at: string | null;
  snapshots: SnapshotPoint[];
}

export interface ScoreBreakdown {
  total?: number;
  components?: Record<
    string,
    {
      points?: number;
      weight?: number;
      reason?: string;
    }
  >;
}

export interface RawChannelRow {
  channel_id: string;
  handle: string | null;
  title: string | null;
  thumbnail_url: string | null;
  is_seed: boolean;
  seed_locked: boolean;
  subscriber_count: number | null;
  created_at: string;
  status: ChannelStatus;
  outreach_status?: OutreachStatus;
  contacted_at?: string | null;
  last_touch_at?: string | null;
  next_followup_at?: string | null;
  snoozed_until?: string | null;
  snooze_reason?: string | null;
  snoozed_at?: string | null;
  snoozed_from_status?: "candidate" | "watchlist" | null;
  woke_at?: string | null;
  kind: ChannelKind;
  kind_reason: string | null;
  email_confirmed?: boolean;
  email_confirmed_at?: string | null;
  yield_count?: number;
  last_upload_at?: string | null;
  uploads_last_90d?: number | null;
  recent_velocity?: number | null;
  subs_growth_7d?: number | null;
  subs_growth_7d_days?: number | null;
  subs_growth_30d?: number | null;
  subs_growth_30d_days?: number | null;
  views_growth_30d?: number | null;
  views_growth_30d_days?: number | null;
  tracking_days?: number | null;
  first_snapshot_at?: string | null;
  latest_snapshot_at?: string | null;
  snapshots?: SnapshotPoint[];
  query_phrases?: string[];
}

export interface SnapshotPoint {
  subscriber_count: number | null;
  view_count: number | null;
  video_count?: number | null;
  taken_at: string;
}

export interface SearchSummary {
  query?: string;
  pages_used: number;
  refs_found: number;
  refs_skipped_existing: number;
  refs_skipped_failed?: number;
  channels_resolved: number;
  credits_spent_this_run: number;
  candidates: Array<{
    title: string | null;
    subs: number | null;
    kind: ChannelKind;
    score: number | null;
  }>;
}

export interface SeedExpansionSummary extends SearchSummary {
  seed_channel_id: string;
  seed_title: string | null;
  seed_handle: string | null;
  error?: string | null;
}

export interface ExpandAllSeedsSummary {
  aborted: boolean;
  reason: string | null;
  seeds_total: number;
  seeds_expanded: number;
  max_pages_per_seed: number;
  max_resolves_per_seed: number;
  max_credit_cost_per_seed: number;
  credit_cap: number;
  credits_spent_total: number;
  refs_found_total: number;
  channels_resolved_total: number;
  summaries: SeedExpansionSummary[];
  failures?: Array<{
    seed_channel_id: string;
    seed_title: string | null;
    seed_handle: string | null;
    error: string;
  }>;
}

export interface MineQueriesTarget {
  channel_id: string;
  title: string | null;
  handle: string | null;
  stored_video_count: number;
}

export interface MineQueriesPlan {
  target_count: number;
  locked_count: number;
  insufficient_video_count: number;
  minimum_stored_videos: number;
  targets: MineQueriesTarget[];
}

export interface SearchRecord {
  id: number;
  query: string;
  pages_used: number;
  refs_found: number;
  resolved: number;
  credits_spent: number;
  created_at: string;
}

export interface BrandRow {
  channel_id: string;
  handle: string | null;
  title: string | null;
  subscriber_count: number | null;
  country: string | null;
  links: string[];
  source_seed_title: string | null;
  sponsor_scan_total: number;
  sponsor_scan_sponsored: number;
  sponsorship_rate: number | null;
  last_sponsored_date: string | null;
  sponsor_scan_scanned_at: string | null;
}

export interface StatusPayload {
  credits_remaining: number | null;
  credits_remaining_updated_at: string | null;
  requests_today: number;
  requests_total: number;
  channel_counts: {
    by_status: Record<string, number>;
    by_kind: Record<string, number>;
    pool: number;
    shortlist: number;
    seeds: number;
    outreach_active: number;
    outreach_closed: number;
  };
  last_search: SearchRecord | null;
  last_snapshot_run: SnapshotJob | null;
  last_run: {
    kind: string;
    at: string;
  } | null;
  snapshot_targets: number;
  seed_snapshot_targets: number;
}

export interface SnapshotJob {
  id: number;
  kind: string;
  started_at: string;
  finished_at: string | null;
  channels_snapshotted: number;
  credits_spent: number;
  note: string | null;
}

export interface SearchSuggestion {
  term: string;
  seed_count: number;
  seeds: Array<{
    channel_id: string;
    title: string | null;
    handle: string | null;
  }>;
}

export interface EnrichSummary {
  scope: string;
  targets_considered: number;
  channels_enriched: number;
  credits_spent_this_run: number;
  credits_breakdown: {
    channel_video_pages: number;
    retry_credits: number;
    other_credits: number;
    total: number;
  };
  max_credit_cost: number;
  channels: ChannelCardRow[];
}

export interface SnapshotSummary {
  job_id: number;
  kind: string;
  scope: "watchlist" | "seeds" | "channel";
  targets_considered: number;
  max_credit_cost: number;
  channels_snapshotted: number;
  skipped_recent: number;
  truncated: number;
  credits_spent_this_run: number;
  note: string | null;
}

export interface SponsorScanRow {
  id: number;
  channel_id: string;
  video_id: string;
  video_title: string | null;
  published_at: string | null;
  scanned_at: string;
  sponsorblock_has_sponsor: number | null;
  sponsorblock_segments_json: string | null;
  error: string | null;
  verdict: "sponsored" | "unknown";
  totalDurationSeconds: number;
}

export interface SponsorScanSummary {
  channel_id: string;
  cached: boolean;
  id_source: "stored" | "rss" | "cache" | "deep_history";
  video_count: number;
  coverageLabel?: string;
  totalScanned: number;
  sponsoredCount: number;
  sponsorshipRate: number;
  lastSponsoredDate: string | null;
  totalSponsorSeconds: number;
  scans: SponsorScanRow[];
}

export interface DeepVariantsResponse {
  query: string;
  variants: string[];
  source: "llm" | "mixed" | "fallback";
  input_tokens: number;
  output_tokens: number;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class ScoutApi {
  constructor(private readonly getKey: () => string | null) {}

  getStatus(): Promise<StatusPayload> {
    return this.request<StatusPayload>("/api/status");
  }

  getShortlist(params: Record<string, string | number | null | undefined>) {
    return this.request<{ channels: ChannelCardRow[] }>(`/api/shortlist?${query(params)}`);
  }

  getOutreach() {
    return this.request<{ active: ChannelCardRow[]; closed: ChannelCardRow[] }>("/api/outreach");
  }

  listChannels(status: ChannelStatus | "seed") {
    return this.request<{ channels: RawChannelRow[] }>(`/api/channels?status=${status}`);
  }

  createSeed(handle: string) {
    return this.request<RawChannelRow>("/api/seeds", {
      method: "POST",
      body: JSON.stringify({ handle }),
    });
  }

  expandSeed(channelId: string, maxPages: number, maxResolves: number) {
    return this.request<SearchSummary>(`/api/seeds/${encodeURIComponent(channelId)}/expand`, {
      method: "POST",
      body: JSON.stringify({ maxPages, maxResolves }),
    });
  }

  patchChannel(channelId: string, body: Partial<{
    status: ChannelStatus;
    kind: ChannelKind;
    is_seed: boolean;
    email_confirmed: boolean;
    snoozed_until: string;
    snooze_reason: string;
  }>) {
    return this.request<RawChannelRow>(`/api/channels/${encodeURIComponent(channelId)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }

  logOutreach(channelId: string, body: { outreach_status: OutreachStatus; note: string; next_followup_at: string | null }) {
    return this.request<{ channel: RawChannelRow; log: Array<{ id: number; channel_id: string; created_at: string; note: string }> }>(
      `/api/channels/${encodeURIComponent(channelId)}/outreach`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    );
  }

  runSearch(body: {
    query: string;
    uploadedWithin?: string;
    maxPages: number;
    maxResolves: number;
    min_subs?: number;
  }) {
    return this.request<SearchSummary>("/api/discover/search", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  listSearches() {
    return this.request<{ searches: SearchRecord[] }>("/api/searches");
  }

  listBrands() {
    return this.request<{ brands: BrandRow[] }>("/api/brands");
  }

  listSearchSuggestions() {
    return this.request<{ suggestions: SearchSuggestion[]; content_suggestions: SearchSuggestion[] }>("/api/search/suggestions");
  }

  deepVariants(queryText: string) {
    return this.request<DeepVariantsResponse>("/api/search/deep-variants", {
      method: "POST",
      body: JSON.stringify({ query: queryText }),
    });
  }

  blockSearchSuggestion(term: string) {
    return this.request<{ blocked: string }>("/api/search/suggestions/blocklist", {
      method: "POST",
      body: JSON.stringify({ term }),
    });
  }

  enrich(body: {
    scope: "pool" | "shortlist" | "watchlist" | "channel";
    channel_id?: string;
    min_score?: number;
    limit?: number;
  }) {
    return this.request<EnrichSummary>("/api/admin/enrich", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  snapshotNow(body: { scope?: "watchlist" | "seeds" | "channel"; channel_id?: string } = {}) {
    return this.request<SnapshotSummary>("/api/admin/snapshot", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  sponsorScan(channelId: string) {
    return this.request<SponsorScanSummary>(`/api/channels/${encodeURIComponent(channelId)}/sponsor-scan`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  }

  sponsorScanDeepHistory(channelId: string) {
    return this.request<SponsorScanSummary>(`/api/channels/${encodeURIComponent(channelId)}/sponsor-scan/deep-history`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  }

  mineQueries(body: { channel_id?: string; force?: boolean } = {}) {
    return this.request<{
      seeds_considered: number;
      phrases_written: number;
      topics_written: number;
      seeds_generated: number;
      seeds_skipped: number;
      llm_seeds: number;
      fallback_seeds: number;
      input_tokens: number;
      output_tokens: number;
      source: "llm" | "ngram" | "mixed" | "skipped";
    }>("/api/admin/mine-queries", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  mineQueriesPlan() {
    return this.request<MineQueriesPlan>("/api/admin/mine-queries/plan");
  }

  repairYields() {
    return this.request<{ repaired: number; yields: Array<{ seed: string | null; channel_id: string; yield_count: number }> }>("/api/admin/repair-yields", {
      method: "POST",
      body: JSON.stringify({}),
    });
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const key = this.getKey();
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    if (init.body) headers.set("content-type", "application/json");
    if (key) headers.set("x-scout-key", key);

    const response = await fetch(path, { ...init, headers });
    const text = await response.text();
    let payload: unknown = null;
    try {
      payload = text ? (JSON.parse(text) as unknown) : null;
    } catch {
      payload = text.trim() ? { message: text.trim() } : null;
    }

    if (!response.ok) {
      const message = nonEmptyMessage(
        payload && typeof payload === "object" && "message" in payload
          ? String((payload as { message?: unknown }).message)
          : payload && typeof payload === "object" && "error" in payload
            ? String((payload as { error?: unknown }).error)
            : response.statusText,
        `Request failed (${response.status})`,
      );
      const retryAfterSeconds =
        payload && typeof payload === "object" && "retry_after_seconds" in payload
          ? Number((payload as { retry_after_seconds?: unknown }).retry_after_seconds)
          : Number(response.headers.get("retry-after"));
      throw new ApiError(
        message,
        response.status,
        Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : null,
      );
    }

    return payload as T;
  }
}

function nonEmptyMessage(value: string, fallback: string): string {
  const trimmed = value.trim();
  return trimmed || fallback;
}

function query(params: Record<string, string | number | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  }

  return search.toString();
}
