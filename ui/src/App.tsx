import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ApiError,
  BrandRow,
  ChannelCardRow,
  ChannelKind,
  ChannelStatus,
  EnrichSummary,
  ExpandAllSeedsSummary,
  OutreachStatus,
  RawChannelRow,
  ScoutApi,
  SearchRecord,
  SearchSuggestion,
  SearchSummary,
  StatusPayload,
} from "./api";
import { BulkController, BulkProgress, runBulkOperation } from "./bulk";
import { HOT_CONFIG, MOVER_CONFIG, REACH_CONFIG } from "./config";

type StageTab = "pool" | "shortlist" | "watchlist" | "rejected";
type Tab = StageTab | "outreach" | "seeds" | "brands";
type SortMode = "score" | "growth" | "subs_desc" | "subs_asc";
type GateState = "idle" | "checking" | "denied" | "success" | "cooldown";
type ToastState = {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
};
type BulkUi = {
  active: boolean;
  progress: BulkProgress | null;
  start: () => BulkController;
  update: (progress: BulkProgress) => void;
  cancel: () => void;
  finish: () => void;
};

const SESSION_KEY = "scout_admin_key";
const EXPAND_ALL_CLIENT_CREDIT_CAP = 150;
const KIND_OPTIONS: ChannelKind[] = ["creator", "brand"];
const ALL_KIND_OPTIONS: ChannelKind[] = ["creator", "brand", "alt"];
const TABS: Tab[] = ["pool", "shortlist", "outreach", "watchlist", "seeds", "rejected", "brands"];
const OUTREACH_OPTIONS: OutreachStatus[] = ["sent", "replied", "in_talks", "signed", "passed", "ghosted"];

export function App() {
  const [adminKey, setAdminKey] = useState(() => sessionStorage.getItem(SESSION_KEY));
  const [tab, setTab] = useState<Tab>("pool");
  const [toast, setToast] = useState<ToastState | null>(null);
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [gateState, setGateState] = useState<GateState>("idle");
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [bulkProgress, setBulkProgress] = useState<BulkProgress | null>(null);
  const [bulkActive, setBulkActive] = useState(false);
  const bulkControllerRef = useRef<BulkController | null>(null);
  const api = useMemo(() => new ScoutApi(() => adminKey), [adminKey]);

  const showError = useCallback((error: unknown) => {
    if (error instanceof ApiError && error.status === 401) {
      sessionStorage.removeItem(SESSION_KEY);
      setAdminKey(null);
      setStatus(null);
      setGateState("idle");
      setToast({ message: "Admin key rejected. Sign in again." });
      return;
    }

    setToast({ message: errorMessage(error) });
  }, []);

  const refreshStatus = useCallback(async () => {
    if (!adminKey) return;
    try {
      setStatus(await api.getStatus());
    } catch (error) {
      showError(error);
    }
  }, [adminKey, api, showError]);

  const bulkUi = useMemo<BulkUi>(() => ({
    active: bulkActive,
    progress: bulkProgress,
    start: () => {
      const controller: BulkController = { cancelled: false };
      bulkControllerRef.current = controller;
      setBulkActive(true);
      return controller;
    },
    update: setBulkProgress,
    cancel: () => {
      if (bulkControllerRef.current) bulkControllerRef.current.cancelled = true;
      setBulkProgress((progress) => progress ? { ...progress, cancelling: true } : progress);
    },
    finish: () => {
      bulkControllerRef.current = null;
      setBulkActive(false);
      setBulkProgress(null);
    },
  }), [bulkActive, bulkProgress]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  async function submitGate(value: string) {
    setGateState("checking");
    try {
      const gateApi = new ScoutApi(() => value);
      const nextStatus = await gateApi.getStatus();
      sessionStorage.setItem(SESSION_KEY, value);
      setStatus(nextStatus);
      setGateState("success");
      window.setTimeout(() => {
        setAdminKey(value);
        setGateState("idle");
      }, 720);
    } catch (error) {
      if (error instanceof ApiError && error.status === 429) {
        const seconds = Math.max(1, error.retryAfterSeconds ?? 60);
        setCooldownUntil(Date.now() + seconds * 1000);
        setGateState("cooldown");
        return;
      }

      setGateState("denied");
      window.setTimeout(() => setGateState("idle"), 2000);
    }
  }

  function lock() {
    sessionStorage.removeItem(SESSION_KEY);
    setAdminKey(null);
    setStatus(null);
    setGateState("idle");
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <div className="wordmark">SCOUT</div>
          <div className="subline">Channel discovery pipeline</div>
        </div>
        <StatusStrip status={status} live={bulkActive} />
        {adminKey && (
          <button className="lock-button" onClick={lock} title="Lock session">
            LOCK
          </button>
        )}
      </header>

      <nav className="tabs" aria-label="SCOUT views">
        {TABS.map((item) => {
          const count = tabCount(item, status);
          return (
            <button
              key={item}
              className={tab === item ? "active" : ""}
              onClick={() => setTab(item)}
            >
              <span>{label(item)}</span>
              {count !== null && <strong>{count}</strong>}
            </button>
          );
        })}
      </nav>
      {bulkProgress && (
        <BulkProgressPanel progress={bulkProgress} onCancel={bulkUi.cancel} />
      )}

      <main>
        {adminKey && (tab === "pool" || tab === "shortlist" || tab === "watchlist" || tab === "rejected") && (
          <StageView
            stage={tab}
            api={api}
            status={status}
            onError={showError}
            onToast={setToast}
            onChanged={refreshStatus}
            bulk={bulkUi}
          />
        )}
        {adminKey && tab === "seeds" && (
          <SeedsView
            api={api}
            onError={showError}
            onToast={setToast}
            onChanged={refreshStatus}
            bulk={bulkUi}
            onQuery={(query) => {
              const params = new URLSearchParams(window.location.search);
              params.set("q", query);
              window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
              setTab("pool");
            }}
          />
        )}
        {adminKey && tab === "outreach" && (
          <OutreachView
            api={api}
            onError={showError}
            onToast={setToast}
            onChanged={refreshStatus}
          />
        )}
        {adminKey && tab === "brands" && (
          <BrandsView
            api={api}
            onError={showError}
            onToast={setToast}
            onChanged={refreshStatus}
          />
        )}
      </main>

      {!adminKey && (
        <Gate
          state={gateState}
          cooldownUntil={cooldownUntil}
          onSubmit={(key) => void submitGate(key)}
        />
      )}
      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}
    </div>
  );
}

function Gate({
  state,
  cooldownUntil,
  onSubmit,
}: {
  state: GateState;
  cooldownUntil: number | null;
  onSubmit: (key: string) => void;
}) {
  const [value, setValue] = useState("");
  const [remaining, setRemaining] = useState(0);
  const isCoolingDown = state === "cooldown";

  useEffect(() => {
    if (!cooldownUntil) return;
    const update = () => {
      setRemaining(Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000)));
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [cooldownUntil]);

  return (
    <div className={`gate-backdrop ${state}`}>
      <form
        className="gate-panel"
        onSubmit={(event) => {
          event.preventDefault();
          if (value.trim() && state !== "checking" && !isCoolingDown) {
            onSubmit(value.trim());
          }
        }}
      >
        <div className="scout-radar" aria-hidden="true">
          <svg viewBox="0 0 220 220" role="presentation">
            <circle className="radar-ring ring-a" cx="110" cy="110" r="36" />
            <circle className="radar-ring ring-b" cx="110" cy="110" r="68" />
            <circle className="radar-ring ring-c" cx="110" cy="110" r="99" />
            <line className="radar-cross" x1="110" y1="18" x2="110" y2="202" />
            <line className="radar-cross" x1="18" y1="110" x2="202" y2="110" />
            <g className="radar-nodes">
              <circle className="node node-a" cx="148" cy="70" r="3.3" />
              <circle className="node node-b" cx="171" cy="124" r="3.3" />
              <circle className="node node-c" cx="95" cy="162" r="3.3" />
              <circle className="node node-d" cx="62" cy="92" r="3.3" />
            </g>
          </svg>
          <div className="radar-trail" />
          <div className="radar-sweep" />
        </div>
        <div className="gate-wordmark">SCOUT</div>
        <input
          autoFocus
          type="password"
          value={value}
          disabled={state === "checking" || isCoolingDown}
          onChange={(event) => setValue(event.target.value)}
          placeholder={isCoolingDown ? `COOLDOWN ${remaining}s` : "ACCESS KEY_"}
        />
        <div className="gate-denied">
          {isCoolingDown ? `COOLDOWN ${remaining}s` : "ACCESS DENIED"}
        </div>
      </form>
    </div>
  );
}

function StatusStrip({ status, live }: { status: StatusPayload | null; live: boolean }) {
  const [pulse, setPulse] = useState(false);
  const [lastCredits, setLastCredits] = useState<number | null>(status?.credits_remaining ?? null);
  const pool = status?.channel_counts.pool ?? 0;
  const shortlisted = status?.channel_counts.shortlist ?? 0;
  const watchlist = status?.channel_counts.by_status.watchlist ?? 0;
  const creditsAsOf = status?.credits_remaining_updated_at ?? null;
  const lastRun = status?.last_run ?? null;

  useEffect(() => {
    const next = status?.credits_remaining ?? null;
    if (lastCredits !== null && next !== null && next !== lastCredits) {
      setPulse(true);
      window.setTimeout(() => setPulse(false), 900);
    }
    setLastCredits(next);
  }, [lastCredits, status?.credits_remaining]);

  return (
    <div className="status-strip">
      <div
        className={`stat-module credits-module clipped ${pulse ? "pulse" : ""}`}
        title={`Spent today ${status?.requests_today ?? 0}; lifetime requests ${status?.requests_total ?? 0}`}
      >
        <span>CREDITS</span>
        <strong>{status?.credits_remaining ?? "?"}</strong>
        <em>{live ? "as of just now" : creditsAsOf ? `as of ${relativeTime(creditsAsOf)}` : "as of unknown"}</em>
        <small>{status?.requests_today ?? 0} spent today</small>
      </div>
      <div className="stat-module pipeline-module clipped">
        <span>PIPELINE</span>
        <p>
          <strong>{pool}</strong> pool <i>-</i> <strong>{shortlisted}</strong> shortlist <i>-</i> <strong>{watchlist}</strong> eyes
        </p>
      </div>
      <div className="stat-module last-run-module clipped">
        <span>LAST RUN</span>
        <p>{lastRun ? `${lastRun.kind.toUpperCase()} ${relativeTime(lastRun.at)}` : "NONE"}</p>
      </div>
    </div>
  );
}

function StageView({
  stage,
  api,
  status,
  onError,
  onToast,
  onChanged,
  bulk,
}: {
  stage: StageTab;
  api: ScoutApi;
  status: StatusPayload | null;
  onError: (error: unknown) => void;
  onToast: (toast: ToastState) => void;
  onChanged: () => void;
  bulk: BulkUi;
}) {
  const initialFilters = useMemo(() => initialShortlistFilters(), []);
  const [channels, setChannels] = useState<ChannelCardRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [minScore, setMinScore] = useState(initialFilters.minScore);
  const [minSubs, setMinSubs] = useState(initialFilters.minSubs);
  const [maxSubs, setMaxSubs] = useState(initialFilters.maxSubs);
  const [kinds, setKinds] = useState<ChannelKind[]>(initialFilters.kinds);
  const [source, setSource] = useState(initialFilters.source);
  const [titleFilter, setTitleFilter] = useState(initialFilters.titleFilter);
  const [sort, setSort] = useState<SortMode>(stage === "shortlist" ? "score" : initialFilters.sort);
  const [filtersOpen, setFiltersOpen] = useState(initialFilters.filtersOpen);
  const [searchQuery, setSearchQuery] = useState(initialFilters.searchQuery);
  const [uploadedWithin, setUploadedWithin] = useState("");
  const [searchMaxResolves, setSearchMaxResolves] = useState(10);
  const [searchMinSubs, setSearchMinSubs] = useState(5000);
  const [searchSummary, setSearchSummary] = useState<SearchSummary | null>(null);
  const [searches, setSearches] = useState<SearchRecord[]>([]);
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [contentSuggestions, setContentSuggestions] = useState<SearchSuggestion[]>([]);
  const searchedTerms = useMemo(() => searchedTermSet(searches), [searches]);
  const [deepSearch, setDeepSearch] = useState(false);
  const [autoEnrich, setAutoEnrich] = useState(true);
  const [deepVariants, setDeepVariants] = useState<string[]>([]);
  const [recentOpen, setRecentOpen] = useState(false);
  const [highlightIds, setHighlightIds] = useState<Set<string>>(() => new Set());
  const [outreachChannel, setOutreachChannel] = useState<ChannelCardRow | null>(null);
  const showPoolFilters = stage === "pool";

  useEffect(() => {
    if (!showPoolFilters) return;
    const params = new URLSearchParams(window.location.search);
    params.set("min_score", String(minScore));
    setOrDelete(params, "min_subs", minSubs);
    setOrDelete(params, "max_subs", maxSubs);
    params.set("kind", kinds.join(","));
    params.set("source", source);
    setOrDelete(params, "title", titleFilter);
    setOrDelete(params, "q", searchQuery);
    params.set("sort", sort);
    params.set("filters", filtersOpen ? "open" : "closed");
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }, [filtersOpen, kinds, maxSubs, minScore, minSubs, searchQuery, showPoolFilters, sort, source, titleFilter]);

  const load = useCallback(async (): Promise<ChannelCardRow[]> => {
    setLoading(true);
    try {
      const stageStatus =
        stage === "pool"
          ? "candidate"
          : stage === "shortlist"
            ? "shortlisted"
            : stage === "watchlist"
              ? "watchlist"
              : "rejected";
      const result = await api.getShortlist({
        min_score: showPoolFilters ? minScore : 0,
        min_subs: showPoolFilters ? minSubs : null,
        max_subs: showPoolFilters ? maxSubs : null,
        kind: showPoolFilters ? kinds.join(",") : ALL_KIND_OPTIONS.join(","),
        discovered_via: showPoolFilters && source !== "all" ? source : null,
        status: stageStatus,
        outreach_status: stage === "shortlist" ? "none" : null,
        is_seed: stage === "pool" ? 0 : null,
        include_unscored: stage === "pool" ? 0 : 1,
        limit: 100,
      });
      setChannels(result.channels);
      return result.channels;
    } catch (error) {
      onError(error);
      return [];
    } finally {
      setLoading(false);
    }
  }, [api, kinds, maxSubs, minScore, minSubs, onError, showPoolFilters, source, stage]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadSearches = useCallback(async () => {
    if (!showPoolFilters) return;
    try {
      setSearches((await api.listSearches()).searches);
    } catch (error) {
      onError(error);
    }
  }, [api, onError, showPoolFilters]);

  useEffect(() => {
    if (!showPoolFilters) return;
    void loadSearches();
    api.listSearchSuggestions()
      .then((result) => {
        setSuggestions(result.suggestions);
        setContentSuggestions(result.content_suggestions ?? []);
      })
      .catch(() => {
        setSuggestions([]);
        setContentSuggestions([]);
      });
  }, [api, loadSearches, showPoolFilters]);

  useEffect(() => {
    if (!deepSearch) return;
    setDeepVariants(generateDeepVariants(searchQuery, contentSuggestions));
  }, [contentSuggestions, deepSearch, searchQuery]);

  const visible = useMemo(() => sortChannels(
    showPoolFilters
      ? channels.filter((channel) =>
          (channel.title ?? "").toLowerCase().includes(titleFilter.toLowerCase()),
        )
      : channels,
    stage === "watchlist" ? "growth" : showPoolFilters ? sort : "score",
  ), [channels, showPoolFilters, sort, stage, titleFilter]);

  async function patchStatus(channel: ChannelCardRow, nextStatus: ChannelStatus, messageStatus = nextStatus) {
    const previousStatus = channel.status;
    setChannels((rows) => rows.filter((row) => row.channel_id !== channel.channel_id));
    try {
      await api.patchChannel(channel.channel_id, { status: nextStatus });
      onChanged();
      onToast({
        message: `${channel.title ?? "Channel"} marked ${messageStatus}.`,
        actionLabel: "Undo",
        onAction: () => {
          void api.patchChannel(channel.channel_id, { status: previousStatus })
            .then(load)
            .then(onChanged)
            .catch(onError);
        },
      });
    } catch (error) {
      onError(error);
      await load();
    }
  }

  async function toggleSeed(channel: ChannelCardRow) {
    const nextSeedState = !channel.is_seed;
    setChannels((rows) =>
      stage === "pool" && nextSeedState
        ? rows.filter((row) => row.channel_id !== channel.channel_id)
        : rows.map((row) =>
            row.channel_id === channel.channel_id ? { ...row, is_seed: nextSeedState } : row,
          ),
    );

    try {
      await api.patchChannel(channel.channel_id, { is_seed: nextSeedState });
      onChanged();
      onToast({
        message: `${channel.title ?? "Channel"} ${nextSeedState ? "added to" : "removed from"} seeds.`,
      });
    } catch (error) {
      onError(error);
      await load();
    }
  }

  async function toggleKind(channel: ChannelCardRow) {
    if (channel.kind === "alt") return;
    const nextKind: ChannelKind = channel.kind === "brand" ? "creator" : "brand";
    setChannels((rows) =>
      nextKind === "brand"
        ? rows.filter((row) => row.channel_id !== channel.channel_id)
        : rows.map((row) => row.channel_id === channel.channel_id ? { ...row, kind: nextKind } : row),
    );
    try {
      await api.patchChannel(channel.channel_id, { kind: nextKind });
      onChanged();
      onToast({ message: `${channel.title ?? "Channel"} marked ${nextKind}.` });
    } catch (error) {
      onError(error);
      await load();
    }
  }

  async function handleOutreachLog(body: { outreach_status: OutreachStatus; note: string; next_followup_at: string | null }) {
    if (!outreachChannel) return;
    const channel = outreachChannel;
    try {
      await api.logOutreach(channel.channel_id, body);
      setOutreachChannel(null);
      await load();
      onChanged();
      if (body.outreach_status === "signed" && !channel.is_seed) {
        onToast({
          message: `${channel.title ?? "Channel"} marked signed.`,
          actionLabel: "Promote to seed",
          onAction: () => {
            void api.patchChannel(channel.channel_id, { is_seed: true })
              .then(load)
              .then(onChanged)
              .catch(onError);
          },
        });
      } else {
        onToast({ message: `${channel.title ?? "Channel"} outreach logged.` });
      }
    } catch (error) {
      onError(error);
    }
  }

  async function enrichStage() {
    const targets = visible.slice(0, 30);
    if (targets.length === 0 || bulk.active) return;
    const controller = bulk.start();
    try {
      const result = await runBulkOperation({
        action: "Enriching",
        items: targets.map((channel) => ({
          id: channel.channel_id,
          label: channel.title ?? channel.handle ?? channel.channel_id,
          value: channel,
        })),
        controller,
        runItem: (channel) => api.enrich({ scope: "channel", channel_id: channel.channel_id, limit: 1 }),
        getCredits: (summary) => summary.credits_spent_this_run,
        getErrorMessage: errorMessage,
        onProgress: bulk.update,
        onItemComplete: async (_summary, index) => {
          if ((index + 1) % 3 === 0) await Promise.resolve(onChanged());
        },
      });
      await load();
      onChanged();
      onToast({
        message: bulkResultToast("Enriched", result, "channel"),
      });
    } catch (error) {
      onError(error);
    } finally {
      bulk.finish();
    }
  }

  async function enrichCard(channel: ChannelCardRow) {
    try {
      const result = await api.enrich({ scope: "channel", channel_id: channel.channel_id, limit: 1 });
      await load();
      onChanged();
      onToast({
        message: `${channel.title ?? "Channel"}: ${enrichToastMessage(result)}`,
      });
    } catch (error) {
      onError(error);
    }
  }

  async function snapshotWatchlist() {
    const targets = channels;
    if (targets.length === 0 || bulk.active) return;
    const controller = bulk.start();
    try {
      const result = await runBulkOperation({
        action: "Snapshotting",
        items: targets.map((channel) => ({
          id: channel.channel_id,
          label: channel.title ?? channel.handle ?? channel.channel_id,
          value: channel,
        })),
        controller,
        runItem: (channel) => api.snapshotNow({ scope: "channel", channel_id: channel.channel_id }),
        getCredits: (summary) => summary.credits_spent_this_run,
        getErrorMessage: errorMessage,
        onProgress: bulk.update,
        onItemComplete: async (_summary, index) => {
          if ((index + 1) % 3 === 0) await Promise.resolve(onChanged());
        },
      });
      await load();
      onChanged();
      onToast({
        message: bulkResultToast("Snapshotted", result, "channel"),
      });
    } catch (error) {
      onError(error);
    } finally {
      bulk.finish();
    }
  }

  async function runPoolSearch(event?: FormEvent) {
    event?.preventDefault();
    const query = searchQuery.trim();
    if (!query || bulk.active) return;
    const before = new Set(channels.map((channel) => channel.channel_id));
    const sanitizedVariants = deepSearch
      ? sanitizeDeepSearchVariants(query, deepVariants)
      : { variants: [], dropped: [] };
    const baseQueries = deepSearch ? [query, ...sanitizedVariants.variants].filter(Boolean) : [query];
    const plan = searchPlanForCap(baseQueries, searchMaxResolves, autoEnrich, deepSearch ? 40 : Number.POSITIVE_INFINITY);
    const controller = bulk.start();
    try {
      const variantSummaries: SearchSummary[] = [];
      const enrichedTitles: string[] = [];
      const searchedNow: string[] = [];
      let knownIds = before;
      const result = await runBulkOperation({
        action: deepSearch ? "Deep searching" : "Searching",
        items: plan.queries.map((plannedQuery) => ({
          id: plannedQuery,
          label: plannedQuery,
          value: plannedQuery,
        })),
        controller,
        runItem: async (plannedQuery) => {
          const summary = await api.runSearch({
            query: plannedQuery,
            uploadedWithin: uploadedWithin || undefined,
            maxPages: 1,
            maxResolves: plan.maxResolves,
            min_subs: searchMinSubs,
          });
          variantSummaries.push(summary);
          searchedNow.push(plannedQuery);
          let nextChannels = await load();
          const arrivals = nextChannels.filter((channel) => !knownIds.has(channel.channel_id));
          knownIds = new Set(nextChannels.map((channel) => channel.channel_id));

          let enrichCredits = 0;
          if (autoEnrich && arrivals.length > 0) {
            for (const arrival of arrivals) {
              if (controller.cancelled) break;
              const enrichment = await api.enrich({ scope: "channel", channel_id: arrival.channel_id, limit: 1 });
              enrichCredits += enrichment.credits_spent_this_run;
              enrichedTitles.push(arrival.title ?? arrival.handle ?? arrival.channel_id);
            }
            nextChannels = await load();
            knownIds = new Set(nextChannels.map((channel) => channel.channel_id));
          }

          const arrivedIds = arrivals.map((arrival) => arrival.channel_id);
          setHighlightIds(new Set(arrivedIds));
          window.setTimeout(() => setHighlightIds(new Set()), 1800);

          return {
            summary,
            credits: summary.credits_spent_this_run + enrichCredits,
            arrivals: arrivedIds.length,
          };
        },
        getCredits: (item) => item.credits,
        getErrorMessage: errorMessage,
        onProgress: bulk.update,
        onItemComplete: async (_item, index) => {
          if ((index + 1) % 3 === 0) await Promise.resolve(onChanged());
        },
      });
      const latest = variantSummaries[variantSummaries.length - 1] ?? null;
      if (latest) setSearchSummary(latest);
      await loadSearches();
      setSearches((items) => mergeSearchTerms(items, searchedNow));
      await load();
      onChanged();
      onToast({
        message: searchRunToast(result, variantSummaries, enrichedTitles, sanitizedVariants.dropped),
      });
    } catch (error) {
      onError(error);
    } finally {
      bulk.finish();
    }
  }

  async function dismissSuggestion(term: string) {
    setSuggestions((items) => items.filter((suggestion) => suggestion.term !== term));
    setContentSuggestions((items) => items.filter((suggestion) => suggestion.term !== term));
    try {
      await api.blockSearchSuggestion(term);
      onToast({ message: `"${term}" hidden from suggestions.` });
    } catch (error) {
      onError(error);
      api.listSearchSuggestions()
        .then((result) => {
          setSuggestions(result.suggestions);
          setContentSuggestions(result.content_suggestions ?? []);
        })
        .catch(onError);
    }
  }

  const currentSanitizedVariants = deepSearch
    ? sanitizeDeepSearchVariants(searchQuery, deepVariants)
    : { variants: [], dropped: [] };
  const currentSearchPlan = searchPlanForCap(
    deepSearch ? [searchQuery.trim(), ...currentSanitizedVariants.variants].filter(Boolean) : [searchQuery.trim()].filter(Boolean),
    searchMaxResolves,
    autoEnrich,
    deepSearch ? 40 : Number.POSITIVE_INFINITY,
  );
  const currentSearchMaxCost = searchPlanMaxCost(currentSearchPlan.queries.length, currentSearchPlan.maxResolves, autoEnrich);

  return (
    <section className="view">
      {showPoolFilters ? (
        <>
          <form className="discovery-console clipped" onSubmit={(event) => void runPoolSearch(event)}>
            <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="keyword discovery" />
            <select value={uploadedWithin} onChange={(event) => setUploadedWithin(event.target.value)}>
              <option value="">any upload date</option>
              <option value="today">today</option>
              <option value="this_week">this week</option>
              <option value="this_month">this month</option>
              <option value="this_year">this year</option>
            </select>
            <NumberStepper label="min subs" value={searchMinSubs} min={0} max={100000000} onChange={setSearchMinSubs} />
            <NumberStepper label="resolves" value={searchMaxResolves} min={1} max={25} onChange={setSearchMaxResolves} />
            <label className="toggle-label">
              <input type="checkbox" checked={deepSearch} onChange={(event) => setDeepSearch(event.target.checked)} />
              DEEP
            </label>
            <label className="toggle-label">
              <input type="checkbox" checked={autoEnrich} onChange={(event) => setAutoEnrich(event.target.checked)} />
              AUTO-ENRICH
            </label>
            <div className="cost">
              max {currentSearchMaxCost} credits{deepSearch ? ` / cap 40 / ${currentSearchPlan.maxResolves} resolves each` : ""}
            </div>
            <button className="primary" type="submit" disabled={bulk.active || !searchQuery.trim()}>
              {bulk.active && bulk.progress?.action.toLowerCase().includes("search") ? <><Spinner /> Running</> : "Run"}
            </button>
            {deepSearch && deepVariants.length > 0 && (
              <div className="variant-row">
                <span>VARIANTS</span>
                {deepVariants.map((variant) => (
                  <span className="suggestion-chip" key={variant}>
                    <button type="button" onClick={() => setSearchQuery(variant)}>{variant}</button>
                    <button
                      className="suggestion-dismiss"
                      type="button"
                      aria-label={`Remove ${variant}`}
                      title="Remove variant"
                      onClick={() => setDeepVariants((items) => items.filter((item) => item !== variant))}
                    >
                      x
                    </button>
                  </span>
                ))}
              </div>
            )}
            <SuggestionRows
              topics={suggestions}
              content={contentSuggestions}
              onPick={setSearchQuery}
              onDismiss={(term) => void dismissSuggestion(term)}
              searchedTerms={searchedTerms}
            />
            <button className="recent-toggle" type="button" onClick={() => setRecentOpen((value) => !value)}>
              Recent searches {recentOpen ? "hide" : "show"}
            </button>
            {recentOpen && (
              <div className="recent-strip">
                {searches.length === 0 ? (
                  <span className="muted">No searches yet</span>
                ) : (
                  <SearchesTable searches={searches.slice(0, 6)} compact />
                )}
              </div>
            )}
          </form>
          {searchSummary && <RunSummary summary={searchSummary} />}
          <Toolbar>
            <button type="button" onClick={() => setFiltersOpen((value) => !value)}>
              FILTERS {filtersOpen ? "OPEN" : "CLOSED"}
            </button>
            <select value={sort} onChange={(event) => setSort(event.target.value as SortMode)}>
              <option value="score">score desc</option>
              <option value="subs_desc">subs desc</option>
              <option value="subs_asc">subs asc</option>
            </select>
            <button type="button" onClick={() => void enrichStage()} disabled={bulk.active || visible.length === 0}>
              Enrich max {Math.min(visible.length || 1, 30)}
            </button>
            {filtersOpen && (
              <div className="filter-drawer">
                <label>Min score<input type="number" value={minScore} onChange={(event) => setMinScore(Number(event.target.value))} /></label>
                <label>Min subs<input value={minSubs} onChange={(event) => setMinSubs(event.target.value)} /></label>
                <label>Max subs<input value={maxSubs} onChange={(event) => setMaxSubs(event.target.value)} /></label>
                <ToggleGroup
                  options={KIND_OPTIONS}
                  values={kinds}
                  onChange={setKinds}
                />
                <select value={source} onChange={(event) => setSource(event.target.value)}>
                  <option value="all">all sources</option>
                  <option value="mention">mention</option>
                  <option value="collab">collab</option>
                  <option value="search">search</option>
                </select>
                <input value={titleFilter} onChange={(event) => setTitleFilter(event.target.value)} placeholder="title filter" />
              </div>
            )}
          </Toolbar>
        </>
      ) : (
        <div className="stage-heading clipped">
          <strong>{stageTitle(stage)}</strong>
          <span>{stageDetail(stage)}</span>
          {stage === "watchlist" && (
            <>
              <button type="button" onClick={() => void snapshotWatchlist()} disabled={bulk.active || channels.length === 0}>
                Snapshot now max {status?.snapshot_targets ?? channels.length}
              </button>
              <button type="button" onClick={() => void enrichStage()} disabled={bulk.active || visible.length === 0}>
                Enrich max {Math.min(visible.length || 1, 30)}
              </button>
            </>
          )}
        </div>
      )}
      {loading ? <Loading /> : visible.length === 0 ? (
        <EmptyState title={emptyTitle(stage)} detail={emptyDetail(stage)} />
      ) : (
        <div className="card-grid">
          {visible.map((channel) => (
            <ChannelCard
              key={channel.channel_id}
              channel={channel}
              showStatus={stage !== "pool"}
              onShortlist={stage === "pool" || stage === "watchlist" ? () => void patchStatus(channel, "shortlisted") : undefined}
              onReject={stage !== "rejected" ? () => void patchStatus(channel, "rejected") : undefined}
              onToggleSeed={stage !== "rejected" ? () => void toggleSeed(channel) : undefined}
              onWatchlist={stage === "pool" || stage === "shortlist" ? () => void patchStatus(channel, "watchlist", "watchlist") : undefined}
              onBackToPool={stage === "shortlist" || stage === "watchlist" ? () => void patchStatus(channel, "candidate", "candidate") : undefined}
              onRestoreToPool={stage === "rejected" ? () => void patchStatus(channel, "candidate", "candidate") : undefined}
              onToggleKind={stage !== "rejected" ? () => void toggleKind(channel) : undefined}
              onEnrich={stage === "pool" || stage === "watchlist" ? () => void enrichCard(channel) : undefined}
              onLogOutreach={stage === "shortlist" ? () => setOutreachChannel(channel) : undefined}
              tab={stage}
              highlighted={highlightIds.has(channel.channel_id)}
            />
          ))}
        </div>
      )}
      {outreachChannel && (
        <OutreachDialog
          channel={outreachChannel}
          onClose={() => setOutreachChannel(null)}
          onSubmit={(body) => void handleOutreachLog(body)}
        />
      )}
    </section>
  );
}

function OutreachView({
  api,
  onError,
  onToast,
  onChanged,
}: {
  api: ScoutApi;
  onError: (error: unknown) => void;
  onToast: (toast: ToastState) => void;
  onChanged: () => void;
}) {
  const [active, setActive] = useState<ChannelCardRow[]>([]);
  const [closed, setClosed] = useState<ChannelCardRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [outreachChannel, setOutreachChannel] = useState<ChannelCardRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.getOutreach();
      setActive(result.active);
      setClosed(result.closed);
    } catch (error) {
      onError(error);
    } finally {
      setLoading(false);
    }
  }, [api, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function patchStatus(channel: ChannelCardRow, status: ChannelStatus, message: string) {
    try {
      await api.patchChannel(channel.channel_id, { status });
      await load();
      onChanged();
      onToast({ message });
    } catch (error) {
      onError(error);
    }
  }

  async function toggleSeed(channel: ChannelCardRow) {
    const nextSeedState = !channel.is_seed;
    try {
      await api.patchChannel(channel.channel_id, { is_seed: nextSeedState });
      await load();
      onChanged();
      onToast({ message: `${channel.title ?? "Channel"} ${nextSeedState ? "added to" : "removed from"} seeds.` });
    } catch (error) {
      onError(error);
    }
  }

  async function handleOutreachLog(body: { outreach_status: OutreachStatus; note: string; next_followup_at: string | null }) {
    if (!outreachChannel) return;
    const channel = outreachChannel;
    try {
      await api.logOutreach(channel.channel_id, body);
      setOutreachChannel(null);
      await load();
      onChanged();
      if (body.outreach_status === "signed" && !channel.is_seed) {
        onToast({
          message: `${channel.title ?? "Channel"} marked signed.`,
          actionLabel: "Promote to seed",
          onAction: () => {
            void api.patchChannel(channel.channel_id, { is_seed: true })
              .then(load)
              .then(onChanged)
              .catch(onError);
          },
        });
      } else {
        onToast({ message: `${channel.title ?? "Channel"} outreach logged.` });
      }
    } catch (error) {
      onError(error);
    }
  }

  return (
    <section className="view">
      <div className="stage-heading clipped">
        <strong>Outreach</strong>
        <span>Live conversations sorted by the stalest touch first.</span>
      </div>
      {loading ? <Loading /> : active.length === 0 ? (
        <EmptyState title="No active outreach" detail="Log outreach from a Shortlist card to start follow-up tracking." />
      ) : (
        <div className="card-grid">
          {active.map((channel) => (
            <ChannelCard
              key={channel.channel_id}
              channel={channel}
              showStatus
              stale={isStaleOutreach(channel)}
              onLogOutreach={() => setOutreachChannel(channel)}
              onShortlist={channel.status !== "shortlisted" ? () => void patchStatus(channel, "shortlisted", `${channel.title ?? "Channel"} shortlisted.`) : undefined}
              onReject={() => void patchStatus(channel, "rejected", `${channel.title ?? "Channel"} rejected.`)}
              onBackToPool={channel.status !== "candidate" ? () => void patchStatus(channel, "candidate", `${channel.title ?? "Channel"} returned to Pool.`) : undefined}
              onToggleSeed={() => void toggleSeed(channel)}
              tab="outreach"
            />
          ))}
        </div>
      )}
      <details className="closed-section clipped">
        <summary>Closed ({closed.length})</summary>
        {closed.length === 0 ? (
          <EmptyState title="No closed outreach" detail="Signed, passed, and ghosted channels will collect here." />
        ) : (
          <div className="card-grid">
            {closed.map((channel) => (
              <ChannelCard
                key={channel.channel_id}
                channel={channel}
                showStatus
                onLogOutreach={() => setOutreachChannel(channel)}
                onToggleSeed={channel.outreach_status === "signed" ? () => void toggleSeed(channel) : undefined}
                tab="outreach"
              />
            ))}
          </div>
        )}
      </details>
      {outreachChannel && (
        <OutreachDialog
          channel={outreachChannel}
          onClose={() => setOutreachChannel(null)}
          onSubmit={(body) => void handleOutreachLog(body)}
        />
      )}
    </section>
  );
}

function SeedsView({
  api,
  onError,
  onToast,
  onChanged,
  bulk,
  onQuery,
}: {
  api: ScoutApi;
  onError: (error: unknown) => void;
  onToast: (toast: ToastState) => void;
  onChanged: () => void;
  bulk: BulkUi;
  onQuery: (query: string) => void;
}) {
  const [seeds, setSeeds] = useState<RawChannelRow[]>([]);
  const [handle, setHandle] = useState("");
  const [loading, setLoading] = useState(false);
  const [dialogSeed, setDialogSeed] = useState<RawChannelRow | null>(null);
  const [summary, setSummary] = useState<SearchSummary | null>(null);
  const [batchSummary, setBatchSummary] = useState<ExpandAllSeedsSummary | null>(null);
  const [searches, setSearches] = useState<SearchRecord[]>([]);
  const searchedTerms = useMemo(() => searchedTermSet(searches), [searches]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSeeds((await api.listChannels("seed")).channels);
      setSearches((await api.listSearches()).searches);
    } catch (error) {
      onError(error);
    } finally {
      setLoading(false);
    }
  }, [api, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function addSeed(event: FormEvent) {
    event.preventDefault();
    if (!handle.trim()) return;
    try {
      await api.createSeed(handle.trim());
      setHandle("");
      await load();
      onChanged();
    } catch (error) {
      onError(error);
    }
  }

  async function unseed(seed: RawChannelRow) {
    setSeeds((rows) => rows.filter((row) => row.channel_id !== seed.channel_id));
    try {
      await api.patchChannel(seed.channel_id, { is_seed: false });
      onChanged();
    } catch (error) {
      onError(error);
      await load();
    }
  }

  async function expandAll() {
    if (bulk.active) return;
    const controller = bulk.start();
    try {
      const result = await runClientExpandAllSeeds(api, seeds, controller, bulk.update, onChanged);
      setBatchSummary(result);
      setSummary(null);
      await load();
      onChanged();
      onToast({
        message: expandAllToast(result),
      });
    } catch (error) {
      onError(error);
    } finally {
      bulk.finish();
    }
  }

  async function snapshotAllSeeds() {
    if (bulk.active) return;
    const controller = bulk.start();
    try {
      const result = await runClientSnapshotAllSeeds(api, seeds, controller, bulk.update, onChanged);
      await load();
      onChanged();
      onToast({
        message: bulkResultToast("Snapshotted", result, "seed"),
      });
    } catch (error) {
      onError(error);
    } finally {
      bulk.finish();
    }
  }

  async function regenerateQueries() {
    if (bulk.active) return;
    const controller = bulk.start();
    try {
      const result = await runBulkOperation({
        action: "Regenerating queries",
        items: seeds.map((seed) => ({
          id: seed.channel_id,
          label: seed.title ?? seed.handle ?? seed.channel_id,
          value: seed,
        })),
        controller,
        runItem: (seed) => api.mineQueries({ channel_id: seed.channel_id, force: true }),
        getCredits: () => 0,
        getErrorMessage: errorMessage,
        onProgress: bulk.update,
      });
      await load();
      onChanged();
      onToast({
        message: bulkResultToast("Regenerated queries for", result, "seed"),
      });
    } catch (error) {
      onError(error);
    } finally {
      bulk.finish();
    }
  }

  async function snapshotSeed(seed: RawChannelRow) {
    try {
      const result = await api.snapshotNow({ scope: "channel", channel_id: seed.channel_id });
      await load();
      onChanged();
      onToast({
        message: `${seed.title ?? "Seed"} snapshot: ${result.channels_snapshotted} taken, ${result.credits_spent_this_run} credit(s).${result.skipped_recent ? " Recently snapshotted; skipped." : ""}`,
      });
    } catch (error) {
      onError(error);
    }
  }

  async function dismissSeedQuery(term: string) {
    setSeeds((rows) => rows.map((seed) => ({
      ...seed,
      query_phrases: (seed.query_phrases ?? []).filter((phrase) => phrase !== term),
    })));
    try {
      await api.blockSearchSuggestion(term);
      onToast({ message: `"${term}" hidden from suggestions.` });
    } catch (error) {
      onError(error);
      await load();
    }
  }

  return (
    <section className="view">
      <form className="inline-form clipped" onSubmit={(event) => void addSeed(event)}>
        <input value={handle} onChange={(event) => setHandle(event.target.value)} placeholder="@handle or channel URL" />
        <button className="primary" type="submit">Add Seed</button>
        <button
          type="button"
          onClick={() => void expandAll()}
          disabled={bulk.active || seeds.length === 0}
          title="Runs maxPages 1 and maxResolves 10 per seed, stopping before the 150-credit cap."
        >
          Expand All Seeds max {Math.min(EXPAND_ALL_CLIENT_CREDIT_CAP, seeds.length * 11)} credits
        </button>
        <button
          type="button"
          onClick={() => void snapshotAllSeeds()}
          disabled={bulk.active || seeds.length === 0}
          title="Snapshots seed channels, skipping any taken within the last 48 hours."
        >
          Snapshot All Seeds max {seeds.length} credits
        </button>
        <button
          type="button"
          onClick={() => void regenerateQueries()}
          disabled={bulk.active || seeds.length === 0}
          title="Regenerates stored LLM query chips for each seed. Uses Anthropic, not ScrapeCreators credits."
        >
          Regen Queries max 0 credits
        </button>
      </form>
      {summary && <RunSummary summary={summary} />}
      {batchSummary && <ExpandAllSummary summary={batchSummary} />}
      {loading ? <Loading /> : seeds.length === 0 ? (
        <EmptyState title="No seeds yet" detail="Add a handle or promote a shortlist card into seed coverage." />
      ) : (
        <div className="card-grid seed-grid">
          {seeds.map((seed) => (
            <SeedCard
              key={seed.channel_id}
              seed={seed}
              onExpand={() => setDialogSeed(seed)}
              onSnapshot={() => void snapshotSeed(seed)}
              onUnseed={() => void unseed(seed)}
              onQuery={onQuery}
              onDismissQuery={(term) => void dismissSeedQuery(term)}
              searchedTerms={searchedTerms}
            />
          ))}
        </div>
      )}
      {dialogSeed && (
        <ExpandDialog
          seed={dialogSeed}
          onClose={() => setDialogSeed(null)}
          onRun={async (maxPages, maxResolves) => {
            try {
              const result = await api.expandSeed(dialogSeed.channel_id, maxPages, maxResolves);
              setSummary(result);
              setDialogSeed(null);
              onChanged();
            } catch (error) {
              onError(error);
            }
          }}
        />
      )}
    </section>
  );
}

function SearchView({
  api,
  onError,
  onToast,
  onChanged,
}: {
  api: ScoutApi;
  onError: (error: unknown) => void;
  onToast: (toast: ToastState) => void;
  onChanged: () => void;
}) {
  const [query, setQuery] = useState("");
  const [uploadedWithin, setUploadedWithin] = useState("");
  const [maxPages, setMaxPages] = useState(1);
  const [maxResolves, setMaxResolves] = useState(10);
  const [minSubs, setMinSubs] = useState(5000);
  const [summary, setSummary] = useState<SearchSummary | null>(null);
  const [candidates, setCandidates] = useState<ChannelCardRow[]>([]);
  const [searches, setSearches] = useState<SearchRecord[]>([]);
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [loading, setLoading] = useState(false);

  const loadSearches = useCallback(async () => {
    try {
      setSearches((await api.listSearches()).searches);
    } catch (error) {
      onError(error);
    }
  }, [api, onError]);

  useEffect(() => {
    void loadSearches();
  }, [loadSearches]);

  useEffect(() => {
    api.listSearchSuggestions()
      .then((result) => setSuggestions(result.suggestions))
      .catch(onError);
  }, [api, onError]);

  async function run(event: FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    try {
      const result = await api.runSearch({
        query: query.trim(),
        uploadedWithin: uploadedWithin || undefined,
        maxPages,
        maxResolves,
        min_subs: minSubs,
      });
      setSummary(result);
      const shortlist = await api.getShortlist({
        min_score: 0,
        kind: "creator,brand",
        discovered_via: "search",
        status: "candidate",
        limit: 100,
      });
      setCandidates(shortlist.channels.filter((row) => row.search_query === query.trim()));
      await loadSearches();
      onChanged();
    } catch (error) {
      onError(error);
    } finally {
      setLoading(false);
    }
  }

  async function actOnCandidate(
    channel: ChannelCardRow,
    body: Partial<{ status: ChannelStatus; is_seed: boolean; kind: ChannelKind }>,
    message: string,
  ) {
    setCandidates((rows) => rows.filter((row) => row.channel_id !== channel.channel_id));
    try {
      await api.patchChannel(channel.channel_id, body);
      onChanged();
      onToast({ message });
    } catch (error) {
      onError(error);
      setCandidates((rows) => [channel, ...rows]);
    }
  }

  async function toggleKind(channel: ChannelCardRow) {
    const nextKind: ChannelKind = channel.kind === "brand" ? "creator" : "brand";
    await actOnCandidate(channel, { kind: nextKind }, `${channel.title ?? "Channel"} marked ${nextKind}.`);
  }

  async function dismissSuggestion(term: string) {
    setSuggestions((items) => items.filter((suggestion) => suggestion.term !== term));
    try {
      await api.blockSearchSuggestion(term);
      onToast({ message: `"${term}" hidden from suggestions.` });
    } catch (error) {
      onError(error);
      api.listSearchSuggestions()
        .then((result) => setSuggestions(result.suggestions))
        .catch(onError);
    }
  }

  return (
    <section className="view">
      <form className="search-console clipped" onSubmit={(event) => void run(event)}>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="keyword search" />
        <select value={uploadedWithin} onChange={(event) => setUploadedWithin(event.target.value)}>
          <option value="">any upload date</option>
          <option value="today">today</option>
          <option value="this_week">this week</option>
          <option value="this_month">this month</option>
          <option value="this_year">this year</option>
        </select>
        <NumberStepper label="pages" value={maxPages} min={1} max={3} onChange={setMaxPages} />
        <NumberStepper label="resolves" value={maxResolves} min={1} max={25} onChange={setMaxResolves} />
        <NumberStepper label="min subs" value={minSubs} min={0} max={100000000} onChange={setMinSubs} />
        <div className="cost">max {maxPages + maxResolves} credits</div>
        <button className="primary" type="submit" disabled={loading}>
          {loading ? <><Spinner /> Running</> : "Run"}
        </button>
        {suggestions.length > 0 && (
          <div className="suggestions">
            <span>FROM YOUR SEEDS</span>
            {suggestions.slice(0, 12).map((suggestion) => (
              <span className="suggestion-chip" key={suggestion.term}>
                <button
                  type="button"
                  title={`shared by ${suggestion.seed_count} seed${suggestion.seed_count === 1 ? "" : "s"}: ${suggestion.seeds.map((seed) => seed.title ?? seed.handle ?? seed.channel_id).join(", ")}`}
                  onClick={() => setQuery(suggestion.term)}
                >
                  {suggestion.term}
                </button>
                <button
                  className="suggestion-dismiss"
                  type="button"
                  aria-label={`Hide ${suggestion.term}`}
                  title="Hide suggestion"
                  onClick={() => void dismissSuggestion(suggestion.term)}
                >
                  x
                </button>
              </span>
            ))}
          </div>
        )}
      </form>
      {summary && <RunSummary summary={summary} />}
      {loading ? <Loading /> : candidates.length === 0 ? (
        summary ? (
          <EmptyState title="No resolved candidates in this view" detail="The search may have hit existing or failed refs." />
        ) : (
          <EmptyState title="Ready for a query" detail="Enter a niche keyword and SCOUT will resolve candidates into the funnel." />
        )
      ) : (
        <div className="card-grid compact-grid">
          {candidates.map((channel) => (
            <ChannelCard
              key={channel.channel_id}
              channel={channel}
              onShortlist={() => void actOnCandidate(channel, { status: "shortlisted" }, `${channel.title ?? "Channel"} shortlisted.`)}
              onWatchlist={() => void actOnCandidate(channel, { status: "watchlist" }, `${channel.title ?? "Channel"} moved to Eyes Peeled.`)}
              onReject={() => void actOnCandidate(channel, { status: "rejected" }, `${channel.title ?? "Channel"} rejected.`)}
              onToggleSeed={() => void actOnCandidate(channel, { is_seed: true }, `${channel.title ?? "Channel"} added to seeds.`)}
              onToggleKind={() => void toggleKind(channel)}
              tab="pool"
            />
          ))}
        </div>
      )}
      <h2>Recent Searches</h2>
      {searches.length === 0 ? (
        <EmptyState title="No searches yet" detail="Run a query to start filling the search ledger." />
      ) : (
        <SearchesTable searches={searches} />
      )}
    </section>
  );
}

function BrandsView({
  api,
  onError,
  onToast,
  onChanged,
}: {
  api: ScoutApi;
  onError: (error: unknown) => void;
  onToast: (toast: ToastState) => void;
  onChanged: () => void;
}) {
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.listBrands()
      .then((result) => setBrands(result.brands))
      .catch(onError)
      .finally(() => setLoading(false));
  }, [api, onError]);

  async function patchBrand(brand: BrandRow, body: Partial<{ kind: ChannelKind; status: ChannelStatus; is_seed: boolean }>, message: string) {
    setBrands((rows) => rows.filter((row) => row.channel_id !== brand.channel_id));
    try {
      await api.patchChannel(brand.channel_id, body);
      onChanged();
      onToast({ message });
    } catch (error) {
      onError(error);
      api.listBrands()
        .then((result) => setBrands(result.brands))
        .catch(onError);
    }
  }

  return (
    <section className="view">
      {loading ? <Loading /> : brands.length === 0 ? (
        <EmptyState title="No brands classified" detail="Sponsor-intel channels will appear here after classification." />
      ) : (
        <div className="card-grid">
          {brands.map((brand) => (
            <article className="channel-card clipped" key={brand.channel_id}>
              <div className="card-head seed-head">
                <div className="thumb-fallback large">{(brand.title ?? brand.handle ?? "?").charAt(0).toUpperCase()}</div>
                <div>
                  <a className="channel-title" href={`https://youtube.com/channel/${brand.channel_id}`} target="_blank" rel="noreferrer">
                    {brand.title ?? brand.channel_id}
                  </a>
                  <div className="muted">{brand.handle ? `@${brand.handle}` : ""}</div>
                </div>
              </div>
              <div className="card-metrics">
                <span>{compact(brand.subscriber_count)} subs</span>
                <span className="chip kind-brand">brand</span>
                {brand.country && <span className="chip">{brand.country}</span>}
              </div>
              <div className="meta-line">
                {brand.source_seed_title && <span>seed: {brand.source_seed_title}</span>}
              </div>
              <IconLinks links={brand.links.map((url) => ({ type: "link", label: linkLabel(url), url }))} />
              <div className="card-actions">
                <button onClick={() => void patchBrand(brand, { kind: "creator", status: "candidate", is_seed: false }, `${brand.title ?? "Channel"} returned to Pool.`)}>
                  Not a brand
                </button>
                <button onClick={() => void patchBrand(brand, { status: "rejected" }, `${brand.title ?? "Brand"} rejected.`)}>
                  Reject
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function ChannelCard({
  channel,
  showStatus = false,
  onShortlist,
  onReject,
  onToggleSeed,
  onWatchlist,
  onBackToPool,
  onRestoreToPool,
  onToggleKind,
  onEnrich,
  onLogOutreach,
  tab,
  highlighted = false,
  stale = false,
}: {
  channel: ChannelCardRow;
  showStatus?: boolean;
  onShortlist?: () => void;
  onReject?: () => void;
  onToggleSeed?: () => void;
  onWatchlist?: () => void;
  onBackToPool?: () => void;
  onRestoreToPool?: () => void;
  onToggleKind?: () => void;
  onEnrich?: () => void;
  onLogOutreach?: () => void;
  tab?: Tab;
  highlighted?: boolean;
  stale?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const actions = cardActions({
    channel,
    tab,
    onShortlist,
    onReject,
    onToggleSeed,
    onWatchlist,
    onBackToPool,
    onRestoreToPool,
    onToggleKind,
    onEnrich,
    onLogOutreach,
  });
  const primaryAction = actions.find((action) => action.primary);
  const secondaryActions = actions.filter((action) => action.visibleSecondary);
  const overflowActions = actions.filter((action) => !action.primary && !action.visibleSecondary);
  const provenance = provenanceText(channel);
  const statusVisible = showStatus && !statusRedundantForTab(tab, channel.status);

  return (
    <article className={`channel-card clipped ${highlighted ? "new-arrival" : ""} ${stale ? "stale-card" : ""}`}>
      <div className="card-head">
        <ChannelImage
          src={channel.thumbnail_url}
          title={channel.title ?? channel.handle ?? channel.channel_id}
          size="large"
        />
        <div>
          <a className="channel-title" href={`https://youtube.com/channel/${channel.channel_id}`} target="_blank" rel="noreferrer">
            {channel.title ?? channel.channel_id}
          </a>
          <div className="muted">{channel.handle ? `@${channel.handle}` : "no handle"}</div>
        </div>
        <button
          className={`score score-${scoreTier(channel.score)}`}
          onClick={() => setOpen((value) => !value)}
          title="click for breakdown"
        >
          {channel.score?.toFixed(0) ?? "--"}
        </button>
      </div>
      <div className="card-metrics">
        <span>{compact(channel.subscriber_count)} subs</span>
        <span className={`chip kind-chip kind-${channel.kind}`}>{channel.kind}</span>
        <span className="chip">{channel.discovered_via}</span>
        {statusVisible && <span className="chip status-chip">{channel.status}</span>}
        {provenance && <span className="chip provenance-chip">{provenance}</span>}
        {channel.median_recent_views !== null && channel.median_recent_views !== undefined && (
          <span className="chip views-chip" title="median views across recent uploads">
            ~{compact(channel.median_recent_views)} / VIDEO <em>REACH {effectiveReach(channel).toFixed(2)}</em>
          </span>
        )}
        {hotChannel(channel) && <span className="chip hot-chip">HOT</span>}
        {moverChannel(channel) && <span className="chip mover-chip">MOVER</span>}
        {stale && <span className="chip stale-chip">STALE</span>}
        {channel.outreach_status && channel.outreach_status !== "none" && (
          <span className="chip outreach-chip">{outreachLabel(channel.outreach_status)}</span>
        )}
      </div>
      <GrowthChips row={channel} />
      <Sparkline points={channel.snapshots ?? []} />
      <div className="meta-line">
        {channel.search_query && <span>query: {channel.search_query}</span>}
        {channel.kind_reason && channel.status === "rejected" && <span>{channel.kind_reason}</span>}
        {channel.last_upload_at && <span>last upload {daysAgo(channel.last_upload_at)}d ago</span>}
        {channel.next_followup_at && <span>follow up {shortDate(channel.next_followup_at)}</span>}
      </div>
      <IconLinks links={channel.contact_links} />
      {open && <ScoreTable breakdown={channel.score_breakdown} />}
      {actions.length > 0 && (
        <div className="card-actions">
          {primaryAction && (
            <button className={`primary-action ${primaryAction.className ?? ""}`} onClick={primaryAction.onClick}>
              {primaryAction.label}
            </button>
          )}
          {secondaryActions.map((action) => (
            <button key={action.key} className={`secondary-action ${action.className ?? ""}`} onClick={action.onClick} title={action.title}>
              {action.label}
            </button>
          ))}
          {overflowActions.length > 0 && (
            <details className="action-overflow">
              <summary aria-label="More actions" title="More actions">...</summary>
              <div className="overflow-list">
                {overflowActions.map((action) => (
                  <button key={action.key} className={action.className} onClick={action.onClick} title={action.title}>
                    {action.label}
                  </button>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </article>
  );
}

type CardAction = {
  key: string;
  label: string;
  onClick: () => void;
  primary?: boolean;
  visibleSecondary?: boolean;
  className?: string;
  title?: string;
};

function cardActions({
  channel,
  tab,
  onShortlist,
  onReject,
  onToggleSeed,
  onWatchlist,
  onBackToPool,
  onRestoreToPool,
  onToggleKind,
  onEnrich,
  onLogOutreach,
}: {
  channel: ChannelCardRow;
  tab?: Tab;
  onShortlist?: () => void;
  onReject?: () => void;
  onToggleSeed?: () => void;
  onWatchlist?: () => void;
  onBackToPool?: () => void;
  onRestoreToPool?: () => void;
  onToggleKind?: () => void;
  onEnrich?: () => void;
  onLogOutreach?: () => void;
}): CardAction[] {
  const actions: CardAction[] = [];
  if (onShortlist) {
    actions.push({
      key: "shortlist",
      label: "Shortlist",
      onClick: onShortlist,
      primary: tab === "pool",
    });
  }
  if (onLogOutreach) {
    actions.push({
      key: "outreach",
      label: "Log outreach",
      onClick: onLogOutreach,
      primary: tab === "shortlist" || tab === "outreach",
    });
  }
  if (onWatchlist) actions.push({ key: "watchlist", label: "Eyes Peeled", onClick: onWatchlist });
  if (onReject) {
    actions.push({
      key: "reject",
      label: "Reject",
      onClick: onReject,
      visibleSecondary: tab === "pool" || tab === "shortlist",
    });
  }
  if (onToggleSeed) {
    actions.push({
      key: "seed",
      label: channel.is_seed ? "Seeded" : "+ Seed",
      onClick: onToggleSeed,
      className: channel.is_seed ? "active-action" : undefined,
    });
  }
  if (onBackToPool) actions.push({ key: "back-pool", label: "Back to Pool", onClick: onBackToPool });
  if (onRestoreToPool) actions.push({ key: "restore-pool", label: "Restore to Pool", onClick: onRestoreToPool });
  if (onToggleKind && channel.kind !== "alt") {
    actions.push({
      key: "kind",
      label: channel.kind === "brand" ? "Mark creator" : "Mark brand",
      onClick: onToggleKind,
    });
  }
  if (onEnrich) actions.push({ key: "enrich", label: "Enrich", onClick: onEnrich, title: "Enrich activity" });

  return actions;
}

function statusRedundantForTab(tab: Tab | undefined, status: ChannelStatus): boolean {
  return (
    (tab === "pool" && status === "candidate") ||
    (tab === "shortlist" && status === "shortlisted") ||
    (tab === "watchlist" && status === "watchlist") ||
    (tab === "rejected" && status === "rejected")
  );
}

function provenanceText(channel: ChannelCardRow): string | null {
  const parts: string[] = [];
  if (channel.source_seed_title) parts.push(`seed: ${channel.source_seed_title}`);
  if (channel.mention_count > 0) parts.push(`${channel.mention_count} mention${channel.mention_count === 1 ? "" : "s"}`);
  return parts.length ? parts.join(" / ") : null;
}

function OutreachDialog({
  channel,
  onClose,
  onSubmit,
}: {
  channel: ChannelCardRow;
  onClose: () => void;
  onSubmit: (body: { outreach_status: OutreachStatus; note: string; next_followup_at: string | null }) => void;
}) {
  const [outreachStatus, setOutreachStatus] = useState<OutreachStatus>(
    channel.outreach_status && channel.outreach_status !== "none" ? channel.outreach_status : "sent",
  );
  const [note, setNote] = useState("");
  const [nextFollowup, setNextFollowup] = useState(channel.next_followup_at ? dateInputValue(channel.next_followup_at) : "");
  const closed = outreachStatus === "signed" || outreachStatus === "passed" || outreachStatus === "ghosted";

  useEffect(() => {
    if (closed) setNextFollowup("");
  }, [closed]);

  return (
    <div className="dialog-backdrop" role="presentation">
      <form
        className="dialog clipped outreach-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit({
            outreach_status: outreachStatus,
            note,
            next_followup_at: nextFollowup || null,
          });
        }}
      >
        <h2>Log outreach</h2>
        <div className="dialog-subtitle">{channel.title ?? channel.handle ?? channel.channel_id}</div>
        <label>
          Status
          <select value={outreachStatus} onChange={(event) => setOutreachStatus(event.target.value as OutreachStatus)}>
            {OUTREACH_OPTIONS.map((option) => (
              <option key={option} value={option}>{outreachLabel(option)}</option>
            ))}
          </select>
        </label>
        <label>
          Note
          <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="sent intro, replied with rates, follow-up context..." required />
        </label>
        <label>
          Next follow-up <span className="optional">optional</span>
          <input type="date" value={nextFollowup} onChange={(event) => setNextFollowup(event.target.value)} disabled={closed} />
        </label>
        {outreachStatus === "signed" && !channel.is_seed && (
          <p className="dialog-hint">Signed channels will offer a one-click seed prompt after logging.</p>
        )}
        <div className="dialog-actions">
          <button className="primary" type="submit" disabled={!note.trim()}>Save log</button>
          <button type="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </div>
  );
}

function SeedCard({
  seed,
  onExpand,
  onSnapshot,
  onUnseed,
  onQuery,
  onDismissQuery,
  searchedTerms,
}: {
  seed: RawChannelRow;
  onExpand: () => void;
  onSnapshot: () => void;
  onUnseed: () => void;
  onQuery: (query: string) => void;
  onDismissQuery: (query: string) => void;
  searchedTerms: Set<string>;
}) {
  const [queriesOpen, setQueriesOpen] = useState(false);
  const phrases = seed.query_phrases ?? [];
  return (
    <article className="channel-card seed-card clipped">
      <div className="card-head seed-head">
        <ChannelImage
          src={seed.thumbnail_url}
          title={seed.title ?? seed.handle ?? seed.channel_id}
          size="large"
        />
        <div>
          <a className="channel-title" href={`https://youtube.com/channel/${seed.channel_id}`} target="_blank" rel="noreferrer">
            {seed.title ?? seed.channel_id}
          </a>
          <div className="muted">{seed.handle ? `@${seed.handle}` : "no handle"}</div>
        </div>
      </div>
      <div className="card-metrics">
        <span>{compact(seed.subscriber_count)} subs</span>
        <span className="chip status-chip">{seed.status}</span>
        <span className="chip">seed</span>
        <span className="chip">YIELD: {seed.yield_count ?? 0}</span>
      </div>
      <GrowthChips row={seed} />
      <Sparkline points={seed.snapshots ?? []} />
      <div className="meta-line">
        <span>added {shortDate(seed.created_at)}</span>
      </div>
      {phrases.length > 0 && (
        <div className="seed-queries">
          <button type="button" onClick={() => setQueriesOpen((value) => !value)}>
            Queries {queriesOpen ? "hide" : "show"}
          </button>
          {queriesOpen && (
            <div className="suggestions seed-query-list">
              {phrases.map((phrase) => (
                <span className={`suggestion-chip ${searchedTerms.has(normalizeChipTerm(phrase)) ? "searched" : ""}`} key={phrase}>
                  <button type="button" onClick={() => onQuery(phrase)}>
                    {searchedTerms.has(normalizeChipTerm(phrase)) && <span aria-hidden="true">✓ </span>}
                    {phrase}
                  </button>
                  <button
                    className="suggestion-dismiss"
                    type="button"
                    aria-label={`Hide ${phrase}`}
                    title="Hide suggestion"
                    onClick={() => onDismissQuery(phrase)}
                  >
                    x
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="card-actions">
        <button onClick={onExpand}>Expand</button>
        <button onClick={onSnapshot}>Snapshot</button>
        <button onClick={onUnseed}>Unseed</button>
      </div>
    </article>
  );
}

type GrowthRow = Pick<
  ChannelCardRow,
  "subs_growth_7d" | "subs_growth_30d" | "views_growth_30d" | "tracking_days" | "snapshots"
>;

function GrowthChips({ row }: { row: Partial<GrowthRow> }) {
  const hasGrowth = row.subs_growth_7d !== null && row.subs_growth_7d !== undefined
    || row.subs_growth_30d !== null && row.subs_growth_30d !== undefined
    || row.views_growth_30d !== null && row.views_growth_30d !== undefined;
  const snapshotCount = row.snapshots?.length ?? 0;

  if (!hasGrowth) {
    if (snapshotCount === 0) return null;
    return (
      <div className="growth-row">
        <span className="chip tracking-chip">TRACKING ({row.tracking_days ?? 0}d)</span>
      </div>
    );
  }

  return (
    <div className="growth-row">
      {row.subs_growth_7d !== null && row.subs_growth_7d !== undefined && (
        <span className="chip growth-chip">SUBS 7D {formatPercent(row.subs_growth_7d)}</span>
      )}
      {row.subs_growth_30d !== null && row.subs_growth_30d !== undefined && (
        <span className="chip growth-chip">SUBS 30D {formatPercent(row.subs_growth_30d)}</span>
      )}
      {row.views_growth_30d !== null && row.views_growth_30d !== undefined && (
        <span className="chip growth-chip dim">VIEWS 30D {formatPercent(row.views_growth_30d)}</span>
      )}
    </div>
  );
}

function Sparkline({ points }: { points: ChannelCardRow["snapshots"] }) {
  const values = (points ?? [])
    .map((point) => point.subscriber_count)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const width = 160;
  const height = 34;
  const step = values.length === 1 ? width : width / (values.length - 1);
  const d = values.map((value, index) => {
    const x = index * step;
    const y = height - ((value - min) / range) * (height - 4) - 2;
    return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");

  return (
    <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function ExpandDialog({
  seed,
  onClose,
  onRun,
}: {
  seed: RawChannelRow;
  onClose: () => void;
  onRun: (maxPages: number, maxResolves: number) => Promise<void>;
}) {
  const [maxPages, setMaxPages] = useState(2);
  const [maxResolves, setMaxResolves] = useState(15);
  return (
    <div className="dialog-backdrop">
      <div className="dialog clipped">
        <h2>Expand {seed.title}</h2>
        <NumberStepper label="pages" value={maxPages} min={1} max={3} onChange={setMaxPages} />
        <NumberStepper label="resolves" value={maxResolves} min={1} max={25} onChange={setMaxResolves} />
        <div className="cost">max {maxPages + maxResolves} credits</div>
        <div className="dialog-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={() => void onRun(maxPages, maxResolves)}>Expand</button>
        </div>
      </div>
    </div>
  );
}

function Toolbar({ children }: { children: ReactNode }) {
  return <div className="toolbar clipped">{children}</div>;
}

function ToggleGroup({
  options,
  values,
  onChange,
}: {
  options: ChannelKind[];
  values: ChannelKind[];
  onChange: (values: ChannelKind[]) => void;
}) {
  return (
    <div className="segmented">
      {options.map((option) => (
        <button
          key={option}
          className={values.includes(option) ? "active" : ""}
          onClick={() => {
            const next = values.includes(option)
              ? values.filter((value) => value !== option)
              : [...values, option];
            onChange(next.length ? next : values);
          }}
          type="button"
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function NumberStepper({
  label: text,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label>{text}
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(clamp(Number(event.target.value), min, max))}
      />
    </label>
  );
}

function RunSummary({ summary }: { summary: SearchSummary }) {
  return (
    <div className="run-summary clipped">
      <strong>{summary.query ?? "Seed expansion"}</strong>
      <span>{summary.pages_used} pages</span>
      <span>{summary.refs_found} refs</span>
      <span>{summary.refs_skipped_existing} existing</span>
      <span>{summary.refs_skipped_failed ?? 0} failed skipped</span>
      <span>{summary.channels_resolved} resolved</span>
      <span>{summary.credits_spent_this_run} credits</span>
    </div>
  );
}

function SuggestionRows({
  topics,
  content,
  onPick,
  onDismiss,
  searchedTerms,
}: {
  topics: SearchSuggestion[];
  content: SearchSuggestion[];
  onPick: (term: string) => void;
  onDismiss: (term: string) => void;
  searchedTerms: Set<string>;
}) {
  if (topics.length === 0 && content.length === 0) return null;
  return (
    <div className="suggestion-rows">
      <SuggestionRow label="TOPICS" suggestions={topics} onPick={onPick} onDismiss={onDismiss} searchedTerms={searchedTerms} />
      <SuggestionRow label="CONTENT" suggestions={content} onPick={onPick} onDismiss={onDismiss} searchedTerms={searchedTerms} />
    </div>
  );
}

function SuggestionRow({
  label: text,
  suggestions,
  onPick,
  onDismiss,
  searchedTerms,
}: {
  label: string;
  suggestions: SearchSuggestion[];
  onPick: (term: string) => void;
  onDismiss: (term: string) => void;
  searchedTerms: Set<string>;
}) {
  if (suggestions.length === 0) return null;
  return (
    <div className="suggestions">
      <span>{text}</span>
      {suggestions.slice(0, 12).map((suggestion) => {
        const searched = searchedTerms.has(normalizeChipTerm(suggestion.term));
        return (
        <span className={`suggestion-chip ${searched ? "searched" : ""}`} key={`${text}-${suggestion.term}`}>
          <button
            type="button"
            title={`shared by ${suggestion.seed_count} seed${suggestion.seed_count === 1 ? "" : "s"}: ${suggestion.seeds.map((seed) => seed.title ?? seed.handle ?? seed.channel_id).join(", ")}`}
            onClick={() => onPick(suggestion.term)}
          >
            {searched && <span aria-hidden="true">✓ </span>}
            {suggestion.term}
          </button>
          <button
            className="suggestion-dismiss"
            type="button"
            aria-label={`Hide ${suggestion.term}`}
            title="Hide suggestion"
            onClick={() => onDismiss(suggestion.term)}
          >
            x
          </button>
        </span>
      );})}
    </div>
  );
}

function BulkProgressPanel({ progress, onCancel }: { progress: BulkProgress; onCancel: () => void }) {
  const percent = progress.total > 0 ? Math.round((progress.index / progress.total) * 100) : 0;
  return (
    <div className="bulk-progress clipped" role="status" aria-live="polite">
      <div className="bulk-progress-head">
        <strong>{progress.action} {progress.index}/{progress.total} - {progress.itemLabel}</strong>
        <span>{progress.creditsSpent} credits spent</span>
        <button type="button" onClick={onCancel} disabled={progress.cancelling}>
          {progress.cancelling ? "Cancelling" : "Cancel"}
        </button>
      </div>
      <progress className="bulk-bar" value={Math.min(100, Math.max(0, percent))} max={100} aria-label="Bulk operation progress" />
      {progress.failures.length > 0 && (
        <div className="bulk-failures">
          {progress.failures.length} failure(s): {progress.failures.slice(0, 2).map((failure) => failure.label).join(", ")}
          {progress.failures.length > 2 ? ` +${progress.failures.length - 2} more` : ""}
        </div>
      )}
    </div>
  );
}

function bulkResultToast(
  verb: string,
  result: { total: number; done: number; creditsSpent: number; failures: Array<{ label: string; error: string }>; cancelled: boolean; stoppedReason?: string | null },
  itemLabel: string,
): string {
  const failures = result.failures.length
    ? ` Failures: ${result.failures.slice(0, 3).map((failure) => `${failure.label}: ${failure.error}`).join(" | ")}${result.failures.length > 3 ? ` +${result.failures.length - 3} more` : ""}.`
    : "";
  const prefix = result.cancelled ? "Cancelled: " : "";
  const stopped = result.stoppedReason ? ` ${result.stoppedReason}` : "";
  return `${prefix}${verb} ${result.done} of ${result.total} ${itemLabel}(s), ${result.creditsSpent} credits spent.${failures}${stopped}`;
}

async function runClientExpandAllSeeds(
  api: ScoutApi,
  seeds: RawChannelRow[],
  controller: BulkController,
  onProgress: (progress: BulkProgress) => void,
  onItemComplete: (index: number) => Promise<void> | void,
): Promise<ExpandAllSeedsSummary> {
  const result = await runBulkOperation({
    action: "Expanding",
    items: seeds.map((seed) => ({
      id: seed.channel_id,
      label: seedLabel(seed),
      value: seed,
    })),
    controller,
    runItem: async (seed) => ({
      seed_channel_id: seed.channel_id,
      seed_title: seed.title,
      seed_handle: seed.handle,
      ...(await api.expandSeed(seed.channel_id, 1, 10)),
    }),
    getCredits: (summary) => summary.credits_spent_this_run,
    getErrorMessage: errorMessage,
    onProgress,
    onItemComplete: async (_summary, index) => {
      if ((index + 1) % 3 === 0) await Promise.resolve(onItemComplete(index));
    },
    shouldStopBeforeItem: ({ item, creditsSpent }) => (
      creditsSpent + 11 > EXPAND_ALL_CLIENT_CREDIT_CAP
        ? `Stopped before ${item.label}: next seed could exceed the ${EXPAND_ALL_CLIENT_CREDIT_CAP}-credit cap.`
        : null
    ),
  });

  const summaries = result.results;
  const failures = result.failures.map((failure) => ({
    seed_channel_id: failure.id,
    seed_title: failure.label,
    seed_handle: null,
    error: failure.error,
  }));

  return {
    aborted: result.cancelled || result.stoppedReason !== null,
    reason: result.cancelled ? "Cancelled by operator." : result.stoppedReason,
    seeds_total: seeds.length,
    seeds_expanded: summaries.length,
    max_pages_per_seed: 1,
    max_resolves_per_seed: 10,
    max_credit_cost_per_seed: 11,
    credit_cap: EXPAND_ALL_CLIENT_CREDIT_CAP,
    credits_spent_total: result.creditsSpent,
    refs_found_total: summaries.reduce((sum, summary) => sum + summary.refs_found, 0),
    channels_resolved_total: summaries.reduce((sum, summary) => sum + summary.channels_resolved, 0),
    summaries,
    failures,
  };
}

async function runClientSnapshotAllSeeds(
  api: ScoutApi,
  seeds: RawChannelRow[],
  controller: BulkController,
  onProgress: (progress: BulkProgress) => void,
  onItemComplete: (index: number) => Promise<void> | void,
) {
  return runBulkOperation({
    action: "Snapshotting",
    items: seeds.map((seed) => ({
      id: seed.channel_id,
      label: seedLabel(seed),
      value: seed,
    })),
    controller,
    runItem: (seed) => api.snapshotNow({ scope: "channel", channel_id: seed.channel_id }),
    getCredits: (summary) => summary.credits_spent_this_run,
    getErrorMessage: errorMessage,
    onProgress,
    onItemComplete: async (_summary, index) => {
      if ((index + 1) % 3 === 0) await Promise.resolve(onItemComplete(index));
    },
  });
}

function expandAllToast(summary: ExpandAllSeedsSummary): string {
  const failures = summary.failures?.length ?? 0;
  return [
    `Expanded ${summary.seeds_expanded}/${summary.seeds_total} seed(s), resolved ${summary.channels_resolved_total}, spent ${summary.credits_spent_total} credit(s).`,
    failures ? `${failures} failed.` : "",
    summary.reason ?? "",
  ].filter(Boolean).join(" ");
}

function ExpandAllSummary({ summary }: { summary: ExpandAllSeedsSummary }) {
  return (
    <div className="batch-summary clipped">
      <div className="run-summary">
        <strong>{summary.aborted ? "Expand all stopped" : "Expand all complete"}</strong>
        <span>{summary.seeds_expanded}/{summary.seeds_total} seeds</span>
        <span>{summary.refs_found_total} refs</span>
        <span>{summary.channels_resolved_total} resolved</span>
        <span>{summary.credits_spent_total} credits</span>
        <span>cap {summary.credit_cap}</span>
      </div>
      {summary.reason && <p className="muted">{summary.reason}</p>}
      <table className="data-table compact-table">
        <thead><tr><th>Seed</th><th>Refs</th><th>Resolved</th><th>Credits</th></tr></thead>
        <tbody>
          {summary.summaries.map((seed) => (
            <tr key={seed.seed_channel_id}>
              <td>{seed.seed_title ?? seed.seed_handle ?? seed.seed_channel_id}</td>
              <td>{seed.refs_found}</td>
              <td>{seed.channels_resolved}</td>
              <td>{seed.credits_spent_this_run}</td>
            </tr>
          ))}
          {(summary.failures ?? []).map((seed) => (
            <tr key={`failed-${seed.seed_channel_id}`}>
              <td>{seed.seed_title ?? seed.seed_handle ?? seed.seed_channel_id}</td>
              <td colSpan={2}>FAILED</td>
              <td>{seed.error}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SearchesTable({ searches, compact = false }: { searches: SearchRecord[]; compact?: boolean }) {
  return (
    <table className={`data-table ${compact ? "compact-table" : ""}`}>
      <thead><tr><th>Query</th><th>Resolved</th><th>Credits</th><th>When</th></tr></thead>
      <tbody>
        {searches.map((search) => (
          <tr key={search.id}>
            <td>{search.query}</td>
            <td>{search.resolved}</td>
            <td>{search.credits_spent}</td>
            <td>{shortDate(search.created_at)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ScoreTable({ breakdown }: { breakdown: ChannelCardRow["score_breakdown"] }) {
  const components = breakdown?.components ?? {};
  return (
    <table className="score-table">
      <tbody>
        {Object.entries(components).map(([name, component]) => (
          <tr key={name}>
            <td>{scoreComponentLabel(name)}</td>
            <td>{component.points?.toFixed(1) ?? "0"}/{component.weight ?? 0}</td>
            <td>{component.reason ?? ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function scoreComponentLabel(name: string): string {
  const labels: Record<string, string> = {
    subRangeFit: "subscriber range",
    engagementReach: "recent views / reach",
    mentionStrength: "mention strength",
    contactability: "contactability",
    legacyEngagement: "lifetime views / video",
  };
  return labels[name] ?? name;
}

function Identity({ row }: { row: RawChannelRow }) {
  return (
    <div className="identity">
      <ChannelImage
        src={row.thumbnail_url}
        title={row.title ?? row.handle ?? row.channel_id}
        size="small"
      />
      <div>
        <a href={`https://youtube.com/channel/${row.channel_id}`} target="_blank" rel="noreferrer">
          {row.title ?? row.channel_id}
        </a>
        <div className="muted">{row.handle ? `@${row.handle}` : ""}</div>
      </div>
    </div>
  );
}

function IconLinks({ links }: { links: Array<{ type: string; label: string; url: string }> }) {
  if (links.length === 0) return <div className="icon-row empty">no contact links</div>;
  return (
    <div className="icon-row">
      {links.map((link, index) => (
        <a key={`${link.type}-${index}`} href={link.url} target="_blank" rel="noopener noreferrer" title={link.label}>
          {iconText(link.type)}
        </a>
      ))}
    </div>
  );
}

function ChannelImage({
  src,
  title,
  size,
}: {
  src: string | null;
  title: string;
  size: "small" | "large";
}) {
  const [failed, setFailed] = useState(false);
  const initial = title.trim().charAt(0).toUpperCase() || "?";

  if (!src || failed) {
    return <div className={`thumb-fallback ${size}`}>{initial}</div>;
  }

  return (
    <img
      src={src}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty-state clipped">
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

function Toast({ toast, onClose }: { toast: ToastState; onClose: () => void }) {
  return (
    <div className="toast clipped">
      <span>{toast.message}</span>
      {toast.actionLabel && toast.onAction && (
        <button
          onClick={() => {
            toast.onAction?.();
            onClose();
          }}
        >
          {toast.actionLabel}
        </button>
      )}
      <button onClick={onClose}>Dismiss</button>
    </div>
  );
}

function Loading() {
  return <div className="loading clipped">Loading</div>;
}

function label(tab: Tab): string {
  if (tab === "watchlist") return "EYES PEELED";
  return tab.toUpperCase();
}

function tabCount(tab: Tab, status: StatusPayload | null): number | null {
  if (!status) return null;
  if (tab === "pool") return status.channel_counts.pool ?? 0;
  if (tab === "shortlist") return status.channel_counts.shortlist ?? 0;
  if (tab === "outreach") return status.channel_counts.outreach_active ?? 0;
  if (tab === "watchlist") return status.channel_counts.by_status.watchlist ?? 0;
  if (tab === "seeds") return status.channel_counts.seeds ?? 0;
  if (tab === "rejected") return status.channel_counts.by_status.rejected ?? 0;
  if (tab === "brands") return status.channel_counts.by_kind.brand ?? 0;
  return null;
}

function stageTitle(stage: StageTab): string {
  if (stage === "shortlist") return "Outreach potentials";
  if (stage === "watchlist") return "Eyes peeled";
  if (stage === "rejected") return "Rejected channels";
  return "Triage pool";
}

function stageDetail(stage: StageTab): string {
  if (stage === "shortlist") return "Shortlisted channels, including any that are also seeds.";
  if (stage === "watchlist") return "Early channels worth watching before outreach.";
  if (stage === "rejected") return "Channels removed from active consideration.";
  return "Candidate channels that have not been seeded, shortlisted, or rejected.";
}

function emptyTitle(stage: StageTab): string {
  if (stage === "shortlist") return "No shortlisted channels";
  if (stage === "watchlist") return "No channels on watch";
  if (stage === "rejected") return "No rejected channels";
  return "Pool is clear";
}

function emptyDetail(stage: StageTab): string {
  if (stage === "shortlist") return "Shortlist cards from Pool or Search to build the outreach list.";
  if (stage === "watchlist") return "Move early prospects here with Eyes Peeled.";
  if (stage === "rejected") return "Rejected channels will appear here with a restore action.";
  return "Adjust the filters, expand a seed, or run a search.";
}

function initialShortlistFilters() {
  const params = new URLSearchParams(window.location.search);
  return {
    minScore: Number(params.get("min_score") ?? 0),
    minSubs: params.get("min_subs") ?? "",
    maxSubs: params.get("max_subs") ?? "",
    kinds: parseKindParam(params.get("kind")),
    source: params.get("source") ?? params.get("discovered_via") ?? "all",
    titleFilter: params.get("title") ?? "",
    sort: parseSortParam(params.get("sort")),
    filtersOpen: params.get("filters") === "open",
    searchQuery: params.get("q") ?? "",
  };
}

function setOrDelete(params: URLSearchParams, key: string, value: string) {
  if (value) params.set(key, value);
  else params.delete(key);
}

function seedLabel(seed: Pick<RawChannelRow, "title" | "handle" | "channel_id">): string {
  return seed.title ?? (seed.handle ? `@${seed.handle}` : seed.channel_id);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  const value = String(error).trim();
  return value || "Request failed with no error message.";
}

function parseKindParam(value: string | null): ChannelKind[] {
  if (!value) return ["creator"];
  const kinds = value
    .split(",")
    .filter((kind): kind is ChannelKind =>
      kind === "creator" || kind === "brand",
    );
  return kinds.length ? kinds : ["creator"];
}

function parseSortParam(value: string | null): SortMode {
  if (value === "growth") return value;
  if (value === "subs_desc" || value === "subs_asc") return value;
  return "score";
}

function compact(value: number | null | undefined): string {
  if (value === null || value === undefined) return "--";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}K`;
  return String(value);
}

function shortDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" });
}

function dateInputValue(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function shortDateTime(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function relativeTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function sortChannels(channels: ChannelCardRow[], sort: SortMode): ChannelCardRow[] {
  return [...channels].sort((a, b) => {
    if (sort === "subs_desc") return (b.subscriber_count ?? 0) - (a.subscriber_count ?? 0);
    if (sort === "subs_asc") return (a.subscriber_count ?? 0) - (b.subscriber_count ?? 0);
    if (sort === "growth") {
      const aGrowth = a.subs_growth_30d;
      const bGrowth = b.subs_growth_30d;
      if (aGrowth === null && bGrowth !== null) return 1;
      if (aGrowth !== null && bGrowth === null) return -1;
      if (aGrowth !== null && bGrowth !== null && bGrowth !== aGrowth) return bGrowth - aGrowth;
    }
    return (b.score ?? 0) - (a.score ?? 0);
  });
}

function formatPercent(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(Math.abs(value) >= 10 ? 0 : 1)}%`;
}

function scoreTier(score: number | null): string {
  if (score === null) return "low";
  if (score >= 85) return "high";
  if (score >= 70) return "mid";
  return "low";
}

function enrichToastMessage(result: EnrichSummary): string {
  const breakdown = result.credits_breakdown;
  const base = `Enriched ${result.channels_enriched} channel(s), spent ${result.credits_spent_this_run} credit(s).`;
  if (!breakdown) return base;
  if (breakdown.retry_credits === 0 && breakdown.other_credits === 0) return base;
  return `${base} Breakdown: ${breakdown.channel_video_pages} video page(s), ${breakdown.retry_credits} retry, ${breakdown.other_credits} other.`;
}

function generateDeepVariants(query: string, contentSuggestions: SearchSuggestion[]): string[] {
  const base = normalizeQuery(query);
  if (!base) return [];
  const queryWords = new Set(base.split(/\s+/).filter((word) => word.length >= 3));
  const related = contentSuggestions
    .map((suggestion) => normalizeQuery(suggestion.term))
    .filter((term) => term && term !== base)
    .map((term) => ({
      term,
      overlap: term.split(/\s+/).filter((word) => queryWords.has(word)).length,
      seedCount: contentSuggestions.find((suggestion) => normalizeQuery(suggestion.term) === term)?.seed_count ?? 0,
    }))
    .filter((item) => item.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap || b.seedCount - a.seedCount || a.term.localeCompare(b.term))
    .map((item) => item.term);
  const templated = [`${base} review`, `${base} how to`, `${base} vs`];
  return uniqueTerms([...related, ...templated]).slice(0, 4);
}

type DroppedVariant = {
  term: string;
  reason: string;
};

function sanitizeDeepSearchVariants(baseQuery: string, variants: string[]): { variants: string[]; dropped: DroppedVariant[] } {
  const base = normalizeQuery(baseQuery);
  const baseTokens = new Set(queryTokens(base));
  const accepted: string[] = [];
  const dropped: DroppedVariant[] = [];
  const seen = new Set<string>();

  for (const variant of variants) {
    const term = normalizeQuery(variant);
    if (!term) continue;
    if (seen.has(term)) {
      dropped.push({ term, reason: "duplicate" });
      continue;
    }
    seen.add(term);

    if (hasRepeatedTokenSequence(term)) {
      dropped.push({ term, reason: "repeated phrase" });
      continue;
    }

    const terms = queryTokens(term);
    if (!terms.some((token) => !baseTokens.has(token))) {
      dropped.push({ term, reason: "no new terms" });
      continue;
    }

    accepted.push(term);
  }

  return { variants: accepted, dropped };
}

function queryTokens(value: string): string[] {
  return normalizeQuery(value).split(/\s+/).filter(Boolean);
}

function hasRepeatedTokenSequence(value: string): boolean {
  const tokens = queryTokens(value);
  for (let size = 2; size <= Math.min(3, Math.floor(tokens.length / 2)); size += 1) {
    const seen = new Set<string>();
    for (let index = 0; index <= tokens.length - size; index += 1) {
      const sequence = tokens.slice(index, index + size).join(" ");
      if (seen.has(sequence)) return true;
      seen.add(sequence);
    }
  }
  return false;
}

function searchPlanForCap(
  queries: string[],
  requestedResolves: number,
  autoEnrich: boolean,
  cap: number,
): { queries: string[]; maxResolves: number } {
  const cleaned = uniqueTerms(queries.map(normalizeQuery).filter(Boolean)).slice(0, 5);
  if (cleaned.length === 0) return { queries: [], maxResolves: requestedResolves };
  if (!Number.isFinite(cap)) return { queries: cleaned, maxResolves: requestedResolves };
  const multiplier = autoEnrich ? 2 : 1;
  const cappedResolves = Math.floor((cap - cleaned.length) / (cleaned.length * multiplier));
  if (cappedResolves >= 1) {
    return { queries: cleaned, maxResolves: Math.min(requestedResolves, cappedResolves) };
  }
  return searchPlanForCap(cleaned.slice(0, -1), requestedResolves, autoEnrich, cap);
}

function searchPlanMaxCost(queryCount: number, maxResolves: number, autoEnrich: boolean): number {
  return queryCount * (1 + maxResolves * (autoEnrich ? 2 : 1));
}

function searchRunToast(
  result: { done: number; total: number; creditsSpent: number; failures: Array<{ label: string; error: string }>; cancelled: boolean },
  summaries: SearchSummary[],
  enrichedTitles: string[],
  droppedVariants: DroppedVariant[] = [],
): string {
  const perVariant = summaries
    .map((summary) => `${summary.query}: ${summary.channels_resolved}`)
    .join(" | ");
  const failures = result.failures.length
    ? ` Failures: ${result.failures.map((failure) => `${failure.label}: ${failure.error}`).join(" | ")}.`
    : "";
  const enriched = enrichedTitles.length ? ` Auto-enriched ${enrichedTitles.length}.` : "";
  const dropped = droppedVariants.length
    ? ` Dropped variants: ${droppedVariants.map((variant) => `${variant.term} (${variant.reason})`).join(" | ")}.`
    : "";
  const prefix = result.cancelled ? "Cancelled: " : "";
  return `${prefix}Search ran ${result.done}/${result.total}, spent ${result.creditsSpent} credit(s). ${perVariant}${enriched}${dropped}${failures}`;
}

function normalizeQuery(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function uniqueTerms(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = normalizeQuery(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function daysAgo(value: string): number {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.round((Date.now() - date.getTime()) / (24 * 60 * 60 * 1000)));
}

function isStaleOutreach(channel: ChannelCardRow): boolean {
  if (channel.outreach_status !== "sent" && channel.outreach_status !== "ghosted") return false;
  return daysAgo(channel.last_touch_at ?? "") > 14;
}

function outreachLabel(value: OutreachStatus): string {
  return value.replace(/_/g, " ");
}

function hotChannel(channel: ChannelCardRow): boolean {
  return (
    (channel.subscriber_count ?? 0) >= HOT_CONFIG.minSubscribers &&
    effectiveReach(channel) >= HOT_CONFIG.minReach &&
    daysAgo(channel.last_upload_at ?? "") <= HOT_CONFIG.maxLastUploadDays
  );
}

function moverChannel(channel: ChannelCardRow): boolean {
  return (
    (channel.subs_growth_7d ?? Number.NEGATIVE_INFINITY) >= MOVER_CONFIG.subsGrowth7d ||
    (channel.subs_growth_30d ?? Number.NEGATIVE_INFINITY) >= MOVER_CONFIG.subsGrowth30d
  );
}

function effectiveReach(channel: ChannelCardRow): number {
  const rawReach = Math.max(0, channel.recent_velocity ?? 0);
  const recencyFactor = uploadRecencyFactor(channel.last_upload_at);
  const subscriberFactor = Math.min(
    1,
    Math.max(0, channel.subscriber_count ?? 0) / REACH_CONFIG.dampingSubscriberFloor,
  );
  const reach = rawReach * recencyFactor * subscriberFactor;
  return Math.min(REACH_CONFIG.displayAndScoreCap, reach);
}

function uploadRecencyFactor(lastUploadAt: string | null): number {
  if (!lastUploadAt) return 0;
  const days = daysAgo(lastUploadAt);
  if (!Number.isFinite(days)) return 0;
  if (days <= REACH_CONFIG.fullRecencyDays) return 1;
  if (days >= REACH_CONFIG.zeroRecencyDays) return 0;
  return 1 -
    ((days - REACH_CONFIG.fullRecencyDays) /
      (REACH_CONFIG.zeroRecencyDays - REACH_CONFIG.fullRecencyDays));
}

function iconText(type: string): string {
  const map: Record<string, string> = {
    email: "@",
    instagram: "IG",
    tiktok: "TK",
    twitter: "X",
    facebook: "FB",
    website: "WWW",
  };
  return map[type] ?? "LINK";
}

function linkLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "link";
  }
}

function searchedTermSet(searches: SearchRecord[]): Set<string> {
  return new Set(searches.map((search) => normalizeChipTerm(search.query)).filter(Boolean));
}

function mergeSearchTerms(searches: SearchRecord[], terms: string[]): SearchRecord[] {
  const existing = searchedTermSet(searches);
  const additions = terms
    .map(normalizeChipTerm)
    .filter((term) => term && !existing.has(term))
    .map((term, index) => ({
      id: -1 - index,
      query: term,
      pages_used: 0,
      refs_found: 0,
      resolved: 0,
      credits_spent: 0,
      created_at: new Date().toISOString(),
    }));
  return [...additions, ...searches];
}

function normalizeChipTerm(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}
