import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ApiError,
  BrandRow,
  ChannelCardRow,
  ChannelKind,
  ChannelStatus,
  EnrichSummary,
  ExpandAllSeedsSummary,
  MineQueriesPlan,
  MineQueriesTarget,
  OutreachStatus,
  RawChannelRow,
  ScoutApi,
  SeedMiningFreshness,
  SearchRecord,
  SearchSuggestion,
  SearchSummary,
  SponsorScanSummary,
  StatusPayload,
} from "./api";
import { BulkController, BulkProgress, runBulkOperation } from "./bulk";
import { HOT_CONFIG, REACH_CONFIG } from "./config";
import { seedFreshnessPacingMs } from "./seed-freshness";

type StageTab = "pool" | "shortlist" | "watchlist" | "snoozed" | "rejected";
type Tab = StageTab | "outreach" | "seeds" | "brands";
type SortMode = "score" | "growth" | "wake" | "subs_desc" | "subs_asc";
type SeedSortMode = "unmined" | "yield" | "latest_upload";
type PoolDensity = "cards" | "rows";
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
type SponsorScanState = Record<string, SponsorScanSummary>;
type SponsorScanTarget = {
  channel: ChannelCardRow;
  summary: SponsorScanSummary;
};
type SnoozeInput = { snoozed_until: string; snooze_reason: string };

const SESSION_KEY = "scout_admin_key";
const EXPAND_ALL_CLIENT_CREDIT_CAP = 150;
const KIND_OPTIONS: ChannelKind[] = ["creator", "brand"];
const ALL_KIND_OPTIONS: ChannelKind[] = ["creator", "brand", "alt"];
const TABS: Tab[] = ["pool", "shortlist", "outreach", "watchlist", "snoozed", "seeds", "rejected", "brands"];
const OUTREACH_OPTIONS: OutreachStatus[] = ["sent", "replied", "in_talks", "pitched", "signed", "passed"];

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
        {adminKey && (tab === "pool" || tab === "shortlist" || tab === "watchlist" || tab === "snoozed" || tab === "rejected") && (
          <StageView
            stage={tab}
            api={api}
            status={status}
            onError={showError}
            onToast={setToast}
            onChanged={refreshStatus}
            bulk={bulkUi}
            onOpenSeeds={() => setTab("seeds")}
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
  onOpenSeeds,
}: {
  stage: StageTab;
  api: ScoutApi;
  status: StatusPayload | null;
  onError: (error: unknown) => void;
  onToast: (toast: ToastState) => void;
  onChanged: () => void;
  bulk: BulkUi;
  onOpenSeeds: () => void;
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
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const [density, setDensity] = useState<PoolDensity>(() => sessionStorage.getItem("scout_pool_density") === "rows" ? "rows" : "cards");
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null);
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
  const [autoScan, setAutoScan] = useState(true);
  const [deepVariants, setDeepVariants] = useState<string[]>([]);
  const [deepVariantsLoading, setDeepVariantsLoading] = useState(false);
  const [deepVariantSource, setDeepVariantSource] = useState<"llm" | "mixed" | "fallback" | null>(null);
  const [recentOpen, setRecentOpen] = useState(false);
  const [highlightIds, setHighlightIds] = useState<Set<string>>(() => new Set());
  const [newArrivalIds, setNewArrivalIds] = useState<Set<string>>(() => new Set());
  const [outreachChannel, setOutreachChannel] = useState<ChannelCardRow | null>(null);
  const [sponsorScans, setSponsorScans] = useState<SponsorScanState>({});
  const [sponsorScanTarget, setSponsorScanTarget] = useState<SponsorScanTarget | null>(null);
  const [scanningSponsorId, setScanningSponsorId] = useState<string | null>(null);
  const showPoolFilters = stage === "pool";

  useEffect(() => {
    if (!showPoolFilters) return;
    sessionStorage.setItem("scout_pool_density", density);
  }, [density, showPoolFilters]);

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
              : stage === "snoozed"
                ? "snoozed"
                : "rejected";
      const result = await api.getShortlist({
        min_score: showPoolFilters ? minScore : 0,
        min_subs: showPoolFilters ? minSubs : null,
        max_subs: showPoolFilters ? maxSubs : null,
        kind: showPoolFilters ? kinds.join(",") : ALL_KIND_OPTIONS.join(","),
        discovered_via: showPoolFilters && source !== "all" ? source : null,
        status: stageStatus,
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
    const query = searchQuery.trim();
    if (!deepSearch || !query) {
      setDeepVariants([]);
      setDeepVariantsLoading(false);
      setDeepVariantSource(null);
      return;
    }

    let cancelled = false;
    setDeepVariants([]);
    setDeepVariantSource(null);
    setDeepVariantsLoading(true);
    const timeout = window.setTimeout(() => {
      api.deepVariants(query)
        .then((result) => {
          if (cancelled) return;
          const sanitized = sanitizeDeepSearchVariants(query, result.variants);
          setDeepVariants(sanitized.variants);
          setDeepVariantSource(result.source);
        })
        .catch((error) => {
          if (cancelled) return;
          setDeepVariants([]);
          setDeepVariantSource(null);
          onError(error);
        })
        .finally(() => {
          if (!cancelled) setDeepVariantsLoading(false);
        });
    }, 500);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [api, deepSearch, onError, searchQuery]);

  const visible = useMemo(() => {
    const sorted = sortChannels(
      showPoolFilters
        ? channels.filter((channel) =>
            (channel.title ?? "").toLowerCase().includes(titleFilter.toLowerCase()),
          )
        : channels,
      stage === "watchlist" ? "growth" : stage === "snoozed" ? "wake" : showPoolFilters ? sort : "score",
    );

    if (!showPoolFilters || newArrivalIds.size === 0) return sorted;
    return [...sorted].sort((left, right) =>
      Number(newArrivalIds.has(right.channel_id)) - Number(newArrivalIds.has(left.channel_id)),
    );
  }, [channels, newArrivalIds, showPoolFilters, sort, stage, titleFilter]);

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
          const undoBody = previousStatus === "snoozed"
            ? {
                status: previousStatus,
                snoozed_until: channel.snoozed_until ?? "",
                snooze_reason: channel.snooze_reason ?? "",
              }
            : { status: previousStatus };
          void api.patchChannel(channel.channel_id, undoBody)
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

  useEffect(() => {
    if (!showPoolFilters || density !== "rows" || !focusedRowId) return;
    const focusedChannel = visible.find((channel) => channel.channel_id === focusedRowId);
    if (!focusedChannel) return;
    const channel = focusedChannel;

    function triageFocusedRow(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || isEditableTarget(event.target)) return;
      const key = event.key.toLowerCase();
      if (key !== "s" && key !== "x") return;
      event.preventDefault();
      setFocusedRowId(null);
      void patchStatus(channel, key === "s" ? "shortlisted" : "rejected");
    }

    document.addEventListener("keydown", triageFocusedRow);
    return () => document.removeEventListener("keydown", triageFocusedRow);
  }, [density, focusedRowId, showPoolFilters, visible]);

  async function saveSnooze(channel: ChannelCardRow, input: SnoozeInput) {
    try {
      await api.patchChannel(channel.channel_id, {
        status: "snoozed",
        snoozed_until: input.snoozed_until,
        snooze_reason: input.snooze_reason,
      });
      await load();
      onChanged();
      onToast({ message: `${channel.title ?? "Channel"} snoozed until ${shortDate(input.snoozed_until)}.` });
    } catch (error) {
      onError(error);
      throw error;
    }
  }

  async function wakeChannel(channel: ChannelCardRow) {
    setChannels((rows) => rows.filter((row) => row.channel_id !== channel.channel_id));
    try {
      await api.patchChannel(channel.channel_id, { status: "candidate" });
      onChanged();
      onToast({ message: `${channel.title ?? "Channel"} woke and returned to Pool.` });
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

  async function toggleEmailConfirmed(channel: ChannelCardRow) {
    const nextConfirmed = !channel.email_confirmed;
    try {
      await api.patchChannel(channel.channel_id, { email_confirmed: nextConfirmed });
      await load();
      onChanged();
      onToast({
        message: `${channel.title ?? "Channel"} business email ${nextConfirmed ? "confirmed" : "unmarked"}.`,
      });
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

  async function scanSponsors(channel: ChannelCardRow) {
    setScanningSponsorId(channel.channel_id);
    try {
      const summary = await api.sponsorScan(channel.channel_id);
      setSponsorScans((scans) => ({ ...scans, [channel.channel_id]: summary }));
      setSponsorScanTarget({ channel, summary });
      onToast({
        message: `${channel.title ?? "Channel"} sponsor scan complete: ${summary.sponsoredCount} of ${summary.totalScanned}.`,
      });
    } catch (error) {
      onError(error);
    } finally {
      setScanningSponsorId(null);
    }
  }

  async function scanSponsorsDeepHistory(channel: ChannelCardRow) {
    setScanningSponsorId(channel.channel_id);
    try {
      const summary = await api.sponsorScanDeepHistory(channel.channel_id);
      setSponsorScans((scans) => ({ ...scans, [channel.channel_id]: summary }));
      setSponsorScanTarget({ channel, summary });
      onChanged();
      onToast({
        message: `${channel.title ?? "Channel"} deep sponsor scan complete: ${summary.sponsoredCount} of ${summary.totalScanned}.`,
      });
    } catch (error) {
      onError(error);
    } finally {
      setScanningSponsorId(null);
    }
  }

  async function autoScanArrivals(arrivals: ChannelCardRow[]) {
    for (const arrival of arrivals) {
      if (sponsorScanFresh(arrival)) continue;
      try {
        const summary = await api.sponsorScan(arrival.channel_id);
        setSponsorScans((scans) => ({ ...scans, [arrival.channel_id]: summary }));
      } catch (error) {
        onError(error);
      }
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
    setNewArrivalIds(new Set());
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
      const arrivalsThisRun = new Set<string>();
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
          for (const id of arrivedIds) arrivalsThisRun.add(id);
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
      const latestChannels = await load();
      if (autoScan && arrivalsThisRun.size > 0) {
        await autoScanArrivals(latestChannels.filter((channel) => arrivalsThisRun.has(channel.channel_id)));
      }
      setNewArrivalIds(arrivalsThisRun);
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
  const searchCreditCap = deepSearch ? 40 : null;
  const searchCreditCapLabel = searchCreditCap && searchCreditCap > 0 ? `${searchCreditCap} credits` : "NO CAP";

  return (
    <section className="view">
      {showPoolFilters ? (
        <>
          <form className="discovery-console discovery-console-folded clipped" onSubmit={(event) => void runPoolSearch(event)}>
            <div className="discovery-summary-row">
              <span className="field-label">DISCOVERY</span>
              <div className="keyword-control">
                <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="keyword discovery" />
                <button className="primary" type="submit" disabled={bulk.active || !searchQuery.trim()}>
                  {bulk.active && bulk.progress?.action.toLowerCase().includes("search") ? <><Spinner /> Running</> : "Run"}
                </button>
              </div>
              <span className="discovery-parameter-echo">
                {searchParameterEcho(uploadedWithin, searchMinSubs, searchMaxResolves, deepSearch, autoEnrich, autoScan, searchCreditCapLabel)}
              </span>
              <span className="discovery-library-count">
                {suggestions.length + contentSuggestions.length} topics / {searches.length} saved queries
              </span>
              <button className="discovery-expand" type="button" aria-expanded={discoveryOpen} onClick={() => setDiscoveryOpen((value) => !value)}>
                {discoveryOpen ? "Collapse" : "Expand"}
              </button>
            </div>
            {discoveryOpen && (
              <div className="discovery-expanded">
                <div className="discovery-control-row">
                  <label className="discovery-field">
                    <span className="field-label">UPLOADS</span>
                    <select value={uploadedWithin} onChange={(event) => setUploadedWithin(event.target.value)}>
                      <option value="">any upload date</option>
                      <option value="today">today</option>
                      <option value="this_week">this week</option>
                      <option value="this_month">this month</option>
                      <option value="this_year">this year</option>
                    </select>
                  </label>
                  <label className="discovery-field">
                    <span className="field-label">MIN SUBS</span>
                    <input
                      type="number"
                      min={0}
                      max={100000000}
                      value={searchMinSubs}
                      onChange={(event) => setSearchMinSubs(clamp(Number(event.target.value), 0, 100000000))}
                    />
                  </label>
                  <label className="discovery-field">
                    <span className="field-label">RESOLVES</span>
                    <input
                      type="number"
                      min={1}
                      max={25}
                      value={searchMaxResolves}
                      onChange={(event) => setSearchMaxResolves(clamp(Number(event.target.value), 1, 25))}
                    />
                  </label>
                  <div className="discovery-field toggle-field" title="expands search with 4 query variants">
                    <span className="field-label">DEEP</span>
                    <button type="button" className={`toggle-chip ${deepSearch ? "active" : ""}`} aria-pressed={deepSearch} onClick={() => setDeepSearch((value) => !value)}>
                      DEEP
                    </button>
                  </div>
                  <div className="discovery-field toggle-field" title="enrich new arrivals on landing">
                    <span className="field-label">AUTO-ENRICH</span>
                    <button type="button" className={`toggle-chip ${autoEnrich ? "active" : ""}`} aria-pressed={autoEnrich} onClick={() => setAutoEnrich((value) => !value)}>
                      AUTO-ENRICH
                    </button>
                  </div>
                  <div className="discovery-field toggle-field" title="scan new arrivals for SponsorBlock signals">
                    <span className="field-label">AUTO-SCAN</span>
                    <button type="button" className={`toggle-chip ${autoScan ? "active" : ""}`} aria-pressed={autoScan} onClick={() => setAutoScan((value) => !value)}>
                      AUTO-SCAN
                    </button>
                  </div>
                  <div className="discovery-field cap-field" title={`estimated max ${currentSearchMaxCost} credits`}>
                    <span className="field-label">CAP</span>
                    <strong>{searchCreditCapLabel}</strong>
                  </div>
                </div>
                {deepSearch && (deepVariantsLoading || currentSanitizedVariants.variants.length > 0) && (
                  <div className="variant-row">
                    <span>{deepVariantsLoading ? "VARIANTS..." : `VARIANTS${deepVariantSource ? ` / ${deepVariantSource}` : ""}`}</span>
                    {currentSanitizedVariants.variants.map((variant) => (
                      <span className="suggestion-chip" key={variant}>
                        <button type="button" onClick={() => setSearchQuery(variant)}>{variant}</button>
                        <button className="suggestion-dismiss" type="button" aria-label={`Remove ${variant}`} title="Remove variant" onClick={() => setDeepVariants((items) => items.filter((item) => normalizeQuery(item) !== normalizeQuery(variant)))}>
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
                  onLowPool={onOpenSeeds}
                />
                <button className="recent-toggle" type="button" onClick={() => setRecentOpen((value) => !value)}>
                  Saved queries {recentOpen ? "hide" : "show"}
                </button>
                {recentOpen && (
                  <div className="recent-strip">
                    {searches.length === 0 ? <span className="muted">No saved queries yet</span> : <SearchesTable searches={searches.slice(0, 6)} compact />}
                  </div>
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
            <div className="density-toggle" role="group" aria-label="Pool density">
              <button type="button" className={density === "cards" ? "active" : ""} aria-pressed={density === "cards"} onClick={() => setDensity("cards")}>Cards</button>
              <button type="button" className={density === "rows" ? "active" : ""} aria-pressed={density === "rows"} onClick={() => setDensity("rows")}>Rows</button>
            </div>
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
      ) : showPoolFilters && density === "rows" ? (
        <ProspectRows
          channels={visible}
          focusedRowId={focusedRowId}
          onFocusRow={setFocusedRowId}
          onShortlist={(channel) => void patchStatus(channel, "shortlisted")}
          onReject={(channel) => void patchStatus(channel, "rejected")}
        />
      ) : (
        <div className="card-grid">
          {visible.map((channel) => (
            <ChannelCard
              key={channel.channel_id}
              channel={channel}
              onShortlist={stage === "pool" || stage === "watchlist" ? () => void patchStatus(channel, "shortlisted") : undefined}
              onReject={stage !== "rejected" ? () => void patchStatus(channel, "rejected") : undefined}
              onToggleSeed={stage !== "rejected" && stage !== "snoozed" ? () => void toggleSeed(channel) : undefined}
              onWatchlist={stage === "pool" || stage === "shortlist" ? () => void patchStatus(channel, "watchlist", "watchlist") : undefined}
              onBackToPool={stage === "shortlist" || stage === "watchlist" ? () => void patchStatus(channel, "candidate", "candidate") : undefined}
              onRestoreToPool={stage === "rejected" ? () => void patchStatus(channel, "candidate", "candidate") : undefined}
              onWake={stage === "snoozed" ? () => void wakeChannel(channel) : undefined}
              onSnooze={stage === "pool" || stage === "watchlist" || stage === "snoozed" ? (input) => saveSnooze(channel, input) : undefined}
              snoozedCount={status?.channel_counts.by_status.snoozed ?? 0}
              onToggleKind={stage !== "rejected" && stage !== "snoozed" ? () => void toggleKind(channel) : undefined}
              onToggleEmailConfirmed={() => void toggleEmailConfirmed(channel)}
              onEnrich={stage !== "rejected" && stage !== "snoozed" ? () => void enrichCard(channel) : undefined}
              onLogOutreach={stage === "shortlist" ? () => setOutreachChannel(channel) : undefined}
              onSponsorScan={stage !== "rejected" && stage !== "snoozed" ? () => void scanSponsors(channel) : undefined}
              sponsorScan={sponsorScans[channel.channel_id]}
              sponsorScanLoading={scanningSponsorId === channel.channel_id}
              tab={stage}
              highlighted={highlightIds.has(channel.channel_id)}
              newArrival={newArrivalIds.has(channel.channel_id)}
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
      {sponsorScanTarget && (
        <SponsorScanDialog
          channel={sponsorScanTarget.channel}
          summary={sponsorScanTarget.summary}
          loading={scanningSponsorId === sponsorScanTarget.channel.channel_id}
          onClose={() => setSponsorScanTarget(null)}
          onRescan={() => void scanSponsors(sponsorScanTarget.channel)}
          onDeepHistory={() => void scanSponsorsDeepHistory(sponsorScanTarget.channel)}
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
  const [working, setWorking] = useState<ChannelCardRow[]>([]);
  const [live, setLive] = useState<ChannelCardRow[]>([]);
  const [closed, setClosed] = useState<ChannelCardRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [outreachChannel, setOutreachChannel] = useState<ChannelCardRow | null>(null);
  const [sponsorScans, setSponsorScans] = useState<SponsorScanState>({});
  const [sponsorScanTarget, setSponsorScanTarget] = useState<SponsorScanTarget | null>(null);
  const [scanningSponsorId, setScanningSponsorId] = useState<string | null>(null);
  const [rosterInput, setRosterInput] = useState("");
  const [rosterConfirmation, setRosterConfirmation] = useState<{
    input: string;
    expectedCredits: number;
    maxCredits: number;
  } | null>(null);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [rosterBusy, setRosterBusy] = useState(false);
  const closedCounts = useMemo(() => ({
    signed: closed.filter((channel) => channel.outreach_status === "signed").length,
    passed: closed.filter((channel) => channel.outreach_status === "passed").length,
  }), [closed]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.getOutreach();
      setWorking(result.working);
      setLive(result.live);
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

  async function toggleEmailConfirmed(channel: ChannelCardRow) {
    const nextConfirmed = !channel.email_confirmed;
    try {
      await api.patchChannel(channel.channel_id, { email_confirmed: nextConfirmed });
      await load();
      onChanged();
      onToast({
        message: `${channel.title ?? "Channel"} business email ${nextConfirmed ? "confirmed" : "unmarked"}.`,
      });
    } catch (error) {
      onError(error);
    }
  }

  async function toggleActive(channel: ChannelCardRow) {
    const nextActive = !channel.is_active;
    try {
      await api.setChannelActive(channel.channel_id, nextActive);
      await load();
      onChanged();
      onToast({
        message: `${channel.title ?? "Channel"} ${nextActive ? "marked ACTIVE / WORKING WITH" : "removed from ACTIVE"}.`,
      });
    } catch (error) {
      onError(error);
    }
  }

  async function submitRoster(event: FormEvent) {
    event.preventDefault();
    if (!rosterInput.trim() || rosterBusy) return;
    setRosterBusy(true);
    setRosterError(null);
    setRosterConfirmation(null);
    try {
      const result = await api.addToRoster(rosterInput.trim());
      if (result.outcome === "confirmation_required") {
        setRosterConfirmation({
          input: result.input,
          expectedCredits: result.expected_credits,
          maxCredits: result.max_credits,
        });
        return;
      }
      await finishRosterAdd(result);
    } catch (error) {
      setRosterError(errorMessage(error));
    } finally {
      setRosterBusy(false);
    }
  }

  async function confirmRosterSpend() {
    if (!rosterConfirmation || rosterBusy) return;
    setRosterBusy(true);
    setRosterError(null);
    try {
      const result = await api.addToRoster(rosterConfirmation.input, true);
      if (result.outcome === "confirmation_required") {
        setRosterError("Confirmation was not accepted; no lookup was performed.");
        return;
      }
      await finishRosterAdd(result);
    } catch (error) {
      setRosterError(errorMessage(error));
    } finally {
      setRosterBusy(false);
    }
  }

  async function finishRosterAdd(result: {
    outcome: "created" | "activated_existing" | "already_active";
    credits_spent: number;
    channel: RawChannelRow;
  }) {
    setRosterInput("");
    setRosterConfirmation(null);
    await load();
    onChanged();
    const label = result.channel.title ?? result.channel.handle ?? result.channel.channel_id;
    const action = result.outcome === "created"
      ? "created in SCOUT and added to ACTIVE"
      : result.outcome === "activated_existing"
        ? "found in SCOUT and marked ACTIVE"
        : "was already ACTIVE";
    onToast({
      message: `${label} ${action}. ${result.credits_spent} ScrapeCreators credit${result.credits_spent === 1 ? "" : "s"} spent.`,
    });
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

  async function scanSponsors(channel: ChannelCardRow) {
    setScanningSponsorId(channel.channel_id);
    try {
      const summary = await api.sponsorScan(channel.channel_id);
      setSponsorScans((scans) => ({ ...scans, [channel.channel_id]: summary }));
      setSponsorScanTarget({ channel, summary });
      onToast({
        message: `${channel.title ?? "Channel"} sponsor scan complete: ${summary.sponsoredCount} of ${summary.totalScanned}.`,
      });
    } catch (error) {
      onError(error);
    } finally {
      setScanningSponsorId(null);
    }
  }

  return (
    <section className="view">
      <div className="stage-heading clipped">
        <strong>Active / working with</strong>
        <span>Roster + live brand relationships — independent of funnel status. Funnel position rides as a chip.</span>
      </div>
      <form className="roster-add clipped" onSubmit={(event) => void submitRoster(event)}>
        <div className="roster-add-controls">
          <input
            value={rosterInput}
            onChange={(event) => {
              setRosterInput(event.target.value);
              setRosterConfirmation(null);
              setRosterError(null);
            }}
            placeholder="YouTube channel URL or @handle"
            aria-label="YouTube channel URL or handle"
            disabled={rosterBusy}
          />
          <button className="primary" type="submit" disabled={rosterBusy || !rosterInput.trim()}>
            {rosterBusy ? "Checking..." : "Add to roster"}
          </button>
          <span className="roster-cost-note">Existing SCOUT channels 0 CR · New channels need a confirmed lookup</span>
        </div>
        {rosterConfirmation && (
          <div className="roster-confirmation">
            <span>
              Not found in SCOUT. Expected cost: {rosterConfirmation.expectedCredits} credit
              {rosterConfirmation.expectedCredits === 1 ? "" : "s"}
              {rosterConfirmation.maxCredits > rosterConfirmation.expectedCredits
                ? `; max ${rosterConfirmation.maxCredits} if the lookup retries.`
                : "."}
            </span>
            <button type="button" onClick={() => void confirmRosterSpend()} disabled={rosterBusy}>
              Confirm spend & add
            </button>
          </div>
        )}
        {rosterError && <div className="roster-error" role="alert">{rosterError}</div>}
      </form>
      {loading ? <Loading /> : working.length === 0 ? (
        <EmptyState title="No active relationships" detail="Add a channel above or mark it ACTIVE from an Outreach card." />
      ) : (
        <div className="card-grid">
          {working.map((channel) => (
            <ChannelCard
              key={channel.channel_id}
              channel={channel}
              stale={isStaleOutreach(channel)}
              onLogOutreach={!channel.seed_locked ? () => setOutreachChannel(channel) : undefined}
              onToggleActive={!channel.seed_locked ? () => void toggleActive(channel) : undefined}
              onToggleSeed={!channel.seed_locked ? () => void toggleSeed(channel) : undefined}
              onToggleEmailConfirmed={!channel.seed_locked ? () => void toggleEmailConfirmed(channel) : undefined}
              onEnrich={!channel.seed_locked ? () => void enrichCard(channel) : undefined}
              onSponsorScan={!channel.seed_locked ? () => void scanSponsors(channel) : undefined}
              sponsorScan={sponsorScans[channel.channel_id]}
              sponsorScanLoading={scanningSponsorId === channel.channel_id}
              tab="outreach"
            />
          ))}
        </div>
      )}
      <div className="stage-heading clipped outreach-live-heading">
        <strong>Live</strong>
        <span>SENT, REPLIED, IN TALKS, and PITCHED — stalest touch first.</span>
      </div>
      {!loading && (live.length === 0 ? (
        <EmptyState title="No live outreach" detail="Log outreach from a Shortlist card to start follow-up tracking." />
      ) : (
        <div className="card-grid">
          {live.map((channel) => (
            <ChannelCard
              key={channel.channel_id}
              channel={channel}
              stale={isStaleOutreach(channel)}
              onLogOutreach={!channel.seed_locked ? () => setOutreachChannel(channel) : undefined}
              onToggleActive={!channel.seed_locked ? () => void toggleActive(channel) : undefined}
              onToggleSeed={!channel.seed_locked ? () => void toggleSeed(channel) : undefined}
              onToggleEmailConfirmed={!channel.seed_locked ? () => void toggleEmailConfirmed(channel) : undefined}
              onEnrich={!channel.seed_locked ? () => void enrichCard(channel) : undefined}
              onSponsorScan={!channel.seed_locked ? () => void scanSponsors(channel) : undefined}
              sponsorScan={sponsorScans[channel.channel_id]}
              sponsorScanLoading={scanningSponsorId === channel.channel_id}
              tab="outreach"
            />
          ))}
        </div>
      ))}
      <details className="closed-section clipped">
        <summary>
          <strong>Closed — {closed.length}</strong>
          <span>Signed {closedCounts.signed} · Passed {closedCounts.passed}</span>
          <em>Expand</em>
        </summary>
        {closed.length === 0 ? (
          <EmptyState title="No closed outreach" detail="SIGNED and PASSED channels will collect here." />
        ) : (
          <div className="card-grid">
            {closed.map((channel) => (
              <ChannelCard
                key={channel.channel_id}
                channel={channel}
                onLogOutreach={!channel.seed_locked ? () => setOutreachChannel(channel) : undefined}
                onToggleActive={!channel.seed_locked ? () => void toggleActive(channel) : undefined}
                onToggleSeed={!channel.seed_locked && channel.outreach_status === "signed" ? () => void toggleSeed(channel) : undefined}
                onToggleEmailConfirmed={!channel.seed_locked ? () => void toggleEmailConfirmed(channel) : undefined}
                onEnrich={!channel.seed_locked ? () => void enrichCard(channel) : undefined}
                onSponsorScan={!channel.seed_locked ? () => void scanSponsors(channel) : undefined}
                sponsorScan={sponsorScans[channel.channel_id]}
                sponsorScanLoading={scanningSponsorId === channel.channel_id}
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
      {sponsorScanTarget && (
        <SponsorScanDialog
          channel={sponsorScanTarget.channel}
          summary={sponsorScanTarget.summary}
          loading={scanningSponsorId === sponsorScanTarget.channel.channel_id}
          onClose={() => setSponsorScanTarget(null)}
          onRescan={() => void scanSponsors(sponsorScanTarget.channel)}
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
  const [seedSort, setSeedSort] = useState<SeedSortMode>("unmined");
  const freshnessRunRef = useRef(0);
  const freshnessQueueRef = useRef<Promise<void>>(Promise.resolve());
  const freshnessHasDispatchedRef = useRef(false);
  const searchedTerms = useMemo(() => searchedTermSet(searches), [searches]);
  const unlockedSeeds = useMemo(() => seeds.filter((seed) => !seed.seed_locked), [seeds]);
  const sortedSeeds = useMemo(() => sortSeeds(seeds, seedSort), [seeds, seedSort]);
  const oreSeeds = useMemo(() => sortedSeeds.filter((seed) => !isMinedOutSeed(seed)), [sortedSeeds]);
  const minedOutSeeds = useMemo(() => sortedSeeds.filter(isMinedOutSeed), [sortedSeeds]);
  const seedGardenStats = useMemo(() => summarizeSeedGarden(seeds), [seeds]);

  const applyFreshness = useCallback((channelId: string, freshness: SeedMiningFreshness) => {
    setSeeds((rows) => rows.map((seed) => (
      seed.channel_id === channelId
        ? { ...seed, mining_freshness: freshness }
        : seed
    )));
  }, []);

  const requestSeedFreshness = useCallback((channelId: string, force = false) => {
    const request = freshnessQueueRef.current.then(async () => {
      if (freshnessHasDispatchedRef.current) {
        await pause(seedFreshnessPacingMs());
      }
      freshnessHasDispatchedRef.current = true;
      return api.refreshSeedFreshness(channelId, force);
    });
    freshnessQueueRef.current = request.then(
      () => undefined,
      () => undefined,
    );
    return request;
  }, [api]);

  const refreshStaleFreshness = useCallback(async (rows: RawChannelRow[]) => {
    const runId = freshnessRunRef.current + 1;
    freshnessRunRef.current = runId;
    const staleSeeds = rows.filter((seed) => !seed.mining_freshness || seed.mining_freshness.stale);

    for (let index = 0; index < staleSeeds.length; index += 1) {
      const seed = staleSeeds[index];
      if (freshnessRunRef.current !== runId) return;
      try {
        applyFreshness(seed.channel_id, await requestSeedFreshness(seed.channel_id));
      } catch {
        // Automatic checks fail quietly per seed; the manual check reports failures.
      }
    }
  }, [applyFreshness, requestSeedFreshness]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const loadedSeeds = (await api.listChannels("seed")).channels;
      setSeeds(loadedSeeds);
      setSearches((await api.listSearches()).searches);
      void refreshStaleFreshness(loadedSeeds);
    } catch (error) {
      onError(error);
    } finally {
      setLoading(false);
    }
  }, [api, onError, refreshStaleFreshness]);

  useEffect(() => {
    void load();
    return () => {
      freshnessRunRef.current += 1;
    };
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
    if (unlockedSeeds.length === 0) return;
    const controller = bulk.start();
    try {
      const result = await runClientExpandAllSeeds(api, unlockedSeeds, controller, bulk.update, onChanged);
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
    let plan: MineQueriesPlan;
    try {
      plan = await api.mineQueriesPlan();
    } catch (error) {
      onError(error);
      return;
    }
    if (plan.target_count === 0) {
      onToast({
        message: `No seeds are eligible for query regeneration. ${plan.locked_count} locked; ${plan.insufficient_video_count} below ${plan.minimum_stored_videos} stored videos.`,
      });
      return;
    }
    const confirmed = window.confirm(
      `Regenerate queries for exactly ${plan.target_count} unlocked seed(s)?\n\n${plan.locked_count} locked seed(s) will be skipped. ${plan.insufficient_video_count} seed(s) with fewer than ${plan.minimum_stored_videos} stored videos will be skipped.`,
    );
    if (!confirmed) return;
    const controller = bulk.start();
    try {
      const result = await runBulkOperation({
        action: "Regenerating queries",
        items: plan.targets.map((target) => ({
          id: target.channel_id,
          label: target.title ?? target.handle ?? target.channel_id,
          value: target,
        })),
        controller,
        runItem: (target: MineQueriesTarget) => api.mineQueries({ channel_id: target.channel_id, force: true }),
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

  async function checkFreshness() {
    if (bulk.active || seeds.length === 0) return;
    freshnessRunRef.current += 1;
    const controller = bulk.start();
    try {
      const result = await runBulkOperation({
        action: "Checking seed freshness",
        items: seeds.map((seed) => ({
          id: seed.channel_id,
          label: seed.title ?? seed.handle ?? seed.channel_id,
          value: seed,
        })),
        controller,
        runItem: async (seed: RawChannelRow) => {
          const freshness = await requestSeedFreshness(seed.channel_id, true);
          applyFreshness(seed.channel_id, freshness);
          if (freshness.error) {
            throw new Error(freshness.error ?? "YouTube RSS freshness check failed.");
          }
          return freshness;
        },
        getCredits: () => 0,
        getErrorMessage: errorMessage,
        onProgress: bulk.update,
      });
      onToast({ message: bulkResultToast("Checked freshness for", result, "seed") });
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
    <section className="view seeds-garden">
      <form className="seed-garden-toolbar clipped" onSubmit={(event) => void addSeed(event)}>
        <div className="seed-add-control">
          <input value={handle} onChange={(event) => setHandle(event.target.value)} placeholder="@handle or channel URL" />
          <button className="primary" type="submit">Add Seed</button>
        </div>
        <div className="seed-bulk-controls">
          <button
            type="button"
            onClick={() => void expandAll()}
            disabled={bulk.active || unlockedSeeds.length === 0}
            title="Runs maxPages 1 and maxResolves 10 per unlocked seed, stopping before the 150-credit cap."
          >
            Expand All ≤{EXPAND_ALL_CLIENT_CREDIT_CAP} CR
          </button>
          <button
            type="button"
            onClick={() => void snapshotAllSeeds()}
            disabled={bulk.active || seeds.length === 0}
            title="Snapshots seed channels, skipping any taken within the last 48 hours."
          >
            Snapshot All ≤{Math.min(seeds.length, 60)} CR
          </button>
          <button
            type="button"
            onClick={() => void regenerateQueries()}
            disabled={bulk.active || seeds.length === 0}
            title="Regenerates stored LLM query chips. Uses Anthropic, not ScrapeCreators credits."
          >
            Regen Queries 0 CR
          </button>
          <button
            type="button"
            onClick={() => void checkFreshness()}
            disabled={bulk.active || seeds.length === 0}
            title="Refreshes public YouTube RSS only. Costs zero ScrapeCreators credits."
          >
            Check freshness
          </button>
          <label className="seed-sort-control">
            <span>SORT</span>
            <select value={seedSort} onChange={(event) => setSeedSort(event.target.value as SeedSortMode)}>
              <option value="unmined">Unmined desc</option>
              <option value="latest_upload">Latest upload</option>
              <option value="yield">Yield desc</option>
            </select>
          </label>
        </div>
      </form>
      <div className="seed-garden-stats" aria-label="Seed garden totals">
        <SeedGardenStat label="Seeds" value={String(seedGardenStats.seeds)} />
        <SeedGardenStat label="Unmined uploads" value={`${seedGardenStats.unmined}${seedGardenStats.unminedLowerBound ? "+" : ""}`} />
        <SeedGardenStat label="Lifetime yield" value={String(seedGardenStats.yield)} />
        <SeedGardenStat label="Locked" value={String(seedGardenStats.locked)} />
        <p>The garden is supply, not funnel. No scores here—only what remains to mine and what each seed has yielded.</p>
      </div>
      {summary && <RunSummary summary={summary} />}
      {batchSummary && <ExpandAllSummary summary={batchSummary} />}
      {loading ? <Loading /> : seeds.length === 0 ? (
        <EmptyState title="No seeds yet" detail="Add a handle or promote a shortlist card into seed coverage." />
      ) : (
        <>
          <div className="seed-honesty-line">
            <strong>ORE REMAINING</strong>
            <span>{oreSeeds.length} SEEDS · SORTED {seedSort.replace(/_/g, " ").toUpperCase()} · RSS COUNTS CAP AT 15+ PER SEED · INCLUDES SHORTS</span>
          </div>
          <div className="seed-rows" role="table" aria-label="Seeds with ore remaining">
            {oreSeeds.map((seed) => (
              <SeedRow
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
          <section className="seed-mined-out" aria-label="Mined out seeds">
            <div className="seed-honesty-line">
              <strong>MINED OUT</strong>
              <span>{minedOutSeeds.length} SEEDS · NOTHING LEFT IN THE CURRENT RSS WINDOW · SNAPSHOT STILL RUNS</span>
            </div>
            <div className="seed-rows seed-rows-muted" role="table">
              {minedOutSeeds.map((seed) => (
                <SeedRow
                  key={seed.channel_id}
                  seed={seed}
                  onExpand={() => setDialogSeed(seed)}
                  onSnapshot={() => void snapshotSeed(seed)}
                  onUnseed={() => void unseed(seed)}
                  onQuery={onQuery}
                  onDismissQuery={(term) => void dismissSeedQuery(term)}
                  searchedTerms={searchedTerms}
                  muted
                />
              ))}
            </div>
          </section>
        </>
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
            <BrandCard
              key={brand.channel_id}
              brand={brand}
              onNotBrand={() => void patchBrand(brand, { kind: "creator", status: "candidate", is_seed: false }, `${brand.title ?? "Channel"} returned to Pool.`)}
              onReject={() => void patchBrand(brand, { status: "rejected" }, `${brand.title ?? "Brand"} rejected.`)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function BrandCard({
  brand,
  onNotBrand,
  onReject,
}: {
  brand: BrandRow;
  onNotBrand: () => void;
  onReject: () => void;
}) {
  const [linksOpen, setLinksOpen] = useState(false);
  const links = brand.links.map((url) => ({ label: brandLinkLabel(url), url }));
  const visibleLinks = linksOpen ? links : links.slice(0, 4);
  const hiddenCount = Math.max(0, links.length - visibleLinks.length);
  const sponsorStats = sponsorStatsFromRollup(brand);
  const hasStats = hasMetricValue(brand.subscriber_count) || Boolean(brand.country) || Boolean(sponsorStats);

  return (
    <article className="channel-card brand-card clipped">
      <div className="card-head">
        <div className="thumb-fallback large">{(brand.title ?? brand.handle ?? "?").charAt(0).toUpperCase()}</div>
        <div className="card-identity">
          <a className="channel-title" href={`https://youtube.com/channel/${brand.channel_id}`} target="_blank" rel="noreferrer">
            {brand.title ?? brand.channel_id}
          </a>
          <div className="muted">{brand.handle ? `@${brand.handle}` : "no handle"}</div>
        </div>
        <div className="score score-mid brand-score" title="Brand intelligence">BR</div>
      </div>
      {hasStats && (
        <div className="stat-grid">
          {hasMetricValue(brand.subscriber_count) && <CardStat label="subs" value={compact(brand.subscriber_count)} />}
          {brand.country && <CardStat label="country" value={brand.country} />}
          {sponsorStats && (
            <CardStat
              label="sponsors"
              value={sponsorStatValue(sponsorStats)}
              title={sponsorStatTitle(sponsorStats)}
              className={sponsorStats.state === "found" ? undefined : `muted-stat sponsor-${sponsorStats.state}`}
            />
          )}
        </div>
      )}
      <div className="status-chip-row">
        <span className="chip badge-attribute kind-brand">BRAND</span>
        {brand.is_active && <span className="chip badge-attribute active-relationship-chip">ACTIVE</span>}
      </div>
      {brand.source_seed_title && (
        <div className="provenance-line">seed: {brand.source_seed_title}</div>
      )}
      {links.length > 0 && (
        <div className="card-footer">
          <BrandLinks
            links={visibleLinks}
            hiddenCount={hiddenCount}
            expanded={linksOpen}
            onToggle={() => setLinksOpen((value) => !value)}
          />
        </div>
      )}
      <div className="card-actions">
        <button onClick={onNotBrand}>Not a brand</button>
        <button onClick={onReject}>Reject</button>
      </div>
    </article>
  );
}

function ProspectRows({
  channels,
  focusedRowId,
  onFocusRow,
  onShortlist,
  onReject,
}: {
  channels: ChannelCardRow[];
  focusedRowId: string | null;
  onFocusRow: (channelId: string) => void;
  onShortlist: (channel: ChannelCardRow) => void;
  onReject: (channel: ChannelCardRow) => void;
}) {
  return (
    <div className="prospect-rows" role="table" aria-label="Pool prospects">
      <div className="prospect-row prospect-row-head" role="row">
        <span role="columnheader">Score</span>
        <span role="columnheader">Channel</span>
        <span role="columnheader">Provenance</span>
        <span role="columnheader">Subs</span>
        <span role="columnheader">V/Vid</span>
        <span role="columnheader">Reach</span>
        <span role="columnheader">Triage</span>
      </div>
      {channels.map((channel) => {
        const reach = effectiveReach(channel);
        const provenance = provenanceLine(channel, provenanceText(channel)).join(" · ") || "--";
        return (
          <div
            className={`prospect-row prospect-row-data ${focusedRowId === channel.channel_id ? "focused" : ""}`}
            role="row"
            tabIndex={0}
            aria-selected={focusedRowId === channel.channel_id}
            key={channel.channel_id}
            onFocus={() => onFocusRow(channel.channel_id)}
            onClick={() => onFocusRow(channel.channel_id)}
          >
            <div role="cell"><ScoreTile channel={channel} compact /></div>
            <div className="prospect-row-channel" role="cell">
              <a href={`https://youtube.com/channel/${channel.channel_id}`} target="_blank" rel="noreferrer">{channel.title ?? channel.channel_id}</a>
              <span>{channel.handle ? `@${channel.handle}` : ""}</span>
            </div>
            <div className="prospect-row-provenance" role="cell" title={provenance}>{provenance}</div>
            <strong role="cell">{channel.subscriber_count === null ? "--" : compact(channel.subscriber_count)}</strong>
            <strong role="cell">{channel.median_recent_views === null ? "--" : `~${compact(channel.median_recent_views)}`}</strong>
            <strong className={reach >= 0.3 ? "signal-value" : ""} role="cell">{reach.toFixed(2)}</strong>
            <div className="prospect-row-triage" role="cell">
              <button type="button" onClick={(event) => { event.stopPropagation(); onShortlist(channel); }} title="Shortlist (S)">S</button>
              <button type="button" className="reject-key" onClick={(event) => { event.stopPropagation(); onReject(channel); }} title="Reject (X)">X</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ScoreTile({ channel, compact: compactTile = false }: { channel: ChannelCardRow; compact?: boolean }) {
  const [pinned, setPinned] = useState(false);
  return (
    <div className={`score-popover-anchor ${pinned ? "pinned" : ""}`}>
      <button
        className={`score score-${scoreTier(channel.score)} ${compactTile ? "score-compact" : ""}`}
        type="button"
        aria-expanded={pinned}
        aria-label={`${channel.title ?? "Channel"} score ${channel.score?.toFixed(0) ?? "unscored"}; show decomposition`}
        onClick={(event) => {
          event.stopPropagation();
          setPinned((value) => !value);
        }}
      >
        {channel.score?.toFixed(0) ?? "--"}
      </button>
      <ScoreBreakdownPopover channel={channel} />
    </div>
  );
}

function ChannelCard({
  channel,
  onShortlist,
  onReject,
  onToggleSeed,
  onWatchlist,
  onBackToPool,
  onRestoreToPool,
  onWake,
  onSnooze,
  snoozedCount = 0,
  onToggleKind,
  onToggleEmailConfirmed,
  onToggleActive,
  onEnrich,
  onLogOutreach,
  onSponsorScan,
  sponsorScan,
  sponsorScanLoading = false,
  tab,
  highlighted = false,
  newArrival = false,
  stale = false,
}: {
  channel: ChannelCardRow;
  onShortlist?: () => void;
  onReject?: () => void;
  onToggleSeed?: () => void;
  onWatchlist?: () => void;
  onBackToPool?: () => void;
  onRestoreToPool?: () => void;
  onWake?: () => void;
  onSnooze?: (input: SnoozeInput) => Promise<void>;
  snoozedCount?: number;
  onToggleKind?: () => void;
  onToggleEmailConfirmed?: () => void;
  onToggleActive?: () => void;
  onEnrich?: () => void;
  onLogOutreach?: () => void;
  onSponsorScan?: () => void;
  sponsorScan?: SponsorScanSummary;
  sponsorScanLoading?: boolean;
  tab?: Tab;
  highlighted?: boolean;
  newArrival?: boolean;
  stale?: boolean;
}) {
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const actions = cardActions({
    channel,
    tab,
    onShortlist,
    onReject,
    onToggleSeed,
    onWatchlist,
    onBackToPool,
    onRestoreToPool,
    onWake,
    onSnooze: onSnooze ? () => setSnoozeOpen((value) => !value) : undefined,
    onToggleKind,
    onToggleEmailConfirmed,
    onToggleActive,
    onEnrich,
    onLogOutreach,
    onSponsorScan,
    sponsorScanLoading,
    enrichFreshDays: enrichmentFreshDays(channel),
  });
  const primaryAction = actions.find((action) => action.primary);
  const secondaryActions = actions.filter((action) => action.visibleSecondary);
  const overflowActions = actions.filter((action) => !action.primary && !action.visibleSecondary);
  const provenance = provenanceText(channel);
  const provenanceItems = provenanceLine(channel, provenance);
  const footerDates = footerDateLine(channel);
  const showConfirmedEmail = channel.email_confirmed && !channel.email_present;
  const hasFooter = channel.contact_links.length > 0 || showConfirmedEmail || footerDates.length > 0;
  const sponsorStats = sponsorStatsForCard(channel, sponsorScan);
  const reach = effectiveReach(channel);

  return (
    <article className={`channel-card prospect-card ${highlighted ? "new-arrival" : ""} ${stale ? "stale-card" : ""}`}>
      <div className="card-head">
        <ChannelImage
          src={channel.thumbnail_url}
          title={channel.title ?? channel.handle ?? channel.channel_id}
          size="large"
        />
        <div className="card-identity">
          <a className="channel-title" href={`https://youtube.com/channel/${channel.channel_id}`} target="_blank" rel="noreferrer">
            {channel.title ?? channel.channel_id}
          </a>
          <div className="muted">{channel.handle ? `@${channel.handle}` : "no handle"}</div>
        </div>
        <ScoreTile channel={channel} />
      </div>
      <div className="stat-grid prospect-stat-grid">
        <CardStat label="subs" value={channel.subscriber_count === null ? "--" : compact(channel.subscriber_count)} />
        <CardStat label="v/vid" value={channel.median_recent_views === null ? "--" : `~${compact(channel.median_recent_views)}`} title="median views across recent uploads" />
        <CardStat label="reach" value={reach.toFixed(2)} className={reach >= 0.3 ? "signal-stat" : undefined} />
        <CardStat label="spons" value={compactSponsorStatValue(sponsorStats)} title={sponsorStatTitle(sponsorStats)} className={sponsorStats.state === "found" ? undefined : `muted-stat sponsor-${sponsorStats.state}`} />
      </div>
      <div className="status-chip-row">
        {tab === "outreach" && channel.outreach_status && channel.outreach_status !== "none" && (
          <span className="chip badge-stage outreach-chip">{outreachLabel(channel.outreach_status)}</span>
        )}
        {channel.kind === "brand" && <span className="chip badge-attribute kind-brand">BRAND</span>}
        {hotChannel(channel) && <span className="chip badge-alert hot-chip">HOT</span>}
        {newArrival && <span className="chip badge-alert new-chip">NEW</span>}
        {channel.woke_at && channel.status === "candidate" && <span className="chip badge-alert woke-chip">WOKE</span>}
        {channel.is_active && <span className="chip badge-attribute active-relationship-chip">ACTIVE</span>}
        <GrowthChipItems row={channel} />
      </div>
      {provenanceItems.length > 0 && (
        <div className="provenance-line">
          {provenanceItems.join(" · ")}
        </div>
      )}
      {channel.snooze_reason && (channel.status === "snoozed" || Boolean(channel.woke_at)) && (
        <div className={`snooze-context ${channel.status === "snoozed" ? "active" : "woken"}`}>
          <strong>{channel.snooze_reason}</strong>
          {channel.status === "snoozed" && (
            <span>
              Snoozed {channel.snoozed_at ? shortDate(channel.snoozed_at) : "--"}
              {channel.snoozed_until ? ` / wakes ${shortDate(channel.snoozed_until)}` : ""}
            </span>
          )}
        </div>
      )}
      <Sparkline points={channel.snapshots ?? []} />
      {hasFooter && (
        <div className="card-footer">
          <IconLinks links={channel.contact_links} confirmedEmail={showConfirmedEmail} />
          {footerDates.length > 0 && (
            <div className={`footer-dates ${uploadAgeClass(channel.last_upload_at)}`}>{footerDates.join(" / ")}</div>
          )}
        </div>
      )}
      {snoozeOpen && onSnooze && (
        <SnoozeEditor
          channel={channel}
          snoozedCount={snoozedCount}
          onCancel={() => setSnoozeOpen(false)}
          onSubmit={async (input) => {
            await onSnooze(input);
            setSnoozeOpen(false);
          }}
        />
      )}
      {actions.length > 0 && (
        <div className="card-actions">
          {primaryAction && (
            <button className={`primary-action ${primaryAction.className ?? ""}`} onClick={primaryAction.onClick}>
              {primaryAction.label}
            </button>
          )}
          {secondaryActions.map((action) => (
            <button key={action.key} className={`secondary-action ${action.className ?? ""}`} onClick={action.onClick} title={action.title} disabled={action.disabled}>
              {action.label}
            </button>
          ))}
          {overflowActions.length > 0 && (
            <OverflowMenu actions={overflowActions} />
          )}
        </div>
      )}
    </article>
  );
}

function SnoozeEditor({
  channel,
  snoozedCount,
  onSubmit,
  onCancel,
}: {
  channel: ChannelCardRow;
  snoozedCount: number;
  onSubmit: (input: SnoozeInput) => Promise<void>;
  onCancel: () => void;
}) {
  const editing = channel.status === "snoozed";
  const [duration, setDuration] = useState<"1" | "3" | "6" | "custom">(editing ? "custom" : "3");
  const [customDate, setCustomDate] = useState(channel.snoozed_until ? dateInputValue(channel.snoozed_until) : "");
  const [reason, setReason] = useState(channel.snooze_reason ?? "");
  const [saving, setSaving] = useState(false);
  const valid = reason.trim().length > 0 && (duration !== "custom" || Boolean(customDate));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    try {
      await onSubmit({
        snoozed_until: snoozeUntil(duration, customDate),
        snooze_reason: reason.trim(),
      });
    } catch {
      return;
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="snooze-editor clipped" onSubmit={(event) => void submit(event)}>
      {!editing && snoozedCount >= 15 && (
        <div className="snooze-cap-warning">{snoozedCount} snoozed - wake or reject something</div>
      )}
      <div className="snooze-duration" role="group" aria-label="Snooze duration">
        {(["1", "3", "6", "custom"] as const).map((option) => (
          <button
            key={option}
            type="button"
            className={duration === option ? "active" : ""}
            onClick={() => setDuration(option)}
          >
            {option === "custom" ? "CUSTOM" : `${option} MONTH${option === "1" ? "" : "S"}`}
          </button>
        ))}
      </div>
      {duration === "custom" && (
        <label>
          Wake date
          <input
            type="date"
            min={dateInputValue(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString())}
            value={customDate}
            onChange={(event) => setCustomDate(event.target.value)}
          />
        </label>
      )}
      <label>
        Why snooze?
        <input
          value={reason}
          maxLength={240}
          placeholder="e.g. B2B infra, no matching brand yet"
          onChange={(event) => setReason(event.target.value)}
          autoFocus
        />
      </label>
      <div className="snooze-editor-actions">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="submit" className="primary-action" disabled={!valid || saving}>
          {saving ? "Saving..." : editing ? "Save" : "Snooze"}
        </button>
      </div>
    </form>
  );
}

function OverflowMenu({ actions }: { actions: CardAction[] }) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const positionMenu = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setAnchor({
      top: Math.max(8, rect.top),
      right: Math.max(8, window.innerWidth - rect.right),
    });
  }, []);

  const setMenuNode = useCallback((node: HTMLDivElement | null) => {
    menuRef.current = node;
    if (node && anchor) {
      node.style.setProperty("--menu-top", `${anchor.top}px`);
      node.style.setProperty("--menu-right", `${anchor.right}px`);
    }
  }, [anchor]);

  useEffect(() => {
    if (!open) return;
    positionMenu();
  }, [open, positionMenu]);

  useEffect(() => {
    if (!open) return;

    function closeOnOutside(event: PointerEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    function closeOnViewportChange() {
      setOpen(false);
    }

    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", closeOnViewportChange);
    window.addEventListener("scroll", closeOnViewportChange, true);

    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", closeOnViewportChange);
      window.removeEventListener("scroll", closeOnViewportChange, true);
    };
  }, [open]);

  return (
    <div className="action-overflow">
      <button
        ref={buttonRef}
        className="overflow-trigger"
        type="button"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        title="More actions"
        onClick={() => {
          if (!open) positionMenu();
          setOpen((value) => !value);
        }}
      >
        ...
      </button>
      {open && anchor && createPortal(
        <div className="overflow-list overflow-portal" ref={setMenuNode} role="menu">
          {actions.map((action) => (
            <button
              key={action.key}
              className={action.className}
              onClick={() => {
                if (action.disabled) return;
                setOpen(false);
                action.onClick();
              }}
              title={action.title}
              disabled={action.disabled}
              role="menuitem"
            >
              {action.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
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
  disabled?: boolean;
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
  onWake,
  onSnooze,
  onToggleKind,
  onToggleEmailConfirmed,
  onToggleActive,
  onEnrich,
  onLogOutreach,
  onSponsorScan,
  sponsorScanLoading,
  enrichFreshDays,
}: {
  channel: ChannelCardRow;
  tab?: Tab;
  onShortlist?: () => void;
  onReject?: () => void;
  onToggleSeed?: () => void;
  onWatchlist?: () => void;
  onBackToPool?: () => void;
  onRestoreToPool?: () => void;
  onWake?: () => void;
  onSnooze?: () => void;
  onToggleKind?: () => void;
  onToggleEmailConfirmed?: () => void;
  onToggleActive?: () => void;
  onEnrich?: () => void;
  onLogOutreach?: () => void;
  onSponsorScan?: () => void;
  sponsorScanLoading?: boolean;
  enrichFreshDays?: number | null;
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
    const updateOutreach =
      tab === "outreach" &&
      (channel.outreach_status === "sent" ||
        channel.outreach_status === "replied" ||
        channel.outreach_status === "in_talks" ||
        channel.outreach_status === "pitched");
    actions.push({
      key: "outreach",
      label: updateOutreach ? "Update status" : "Log outreach",
      onClick: onLogOutreach,
      primary: tab === "shortlist" || tab === "outreach",
    });
  }
  if (onWatchlist) actions.push({ key: "watchlist", label: "Eyes Peeled", onClick: onWatchlist });
  if (onWake) actions.push({ key: "wake", label: "Wake now", onClick: onWake, primary: tab === "snoozed" });
  if (onReject) {
    actions.push({
      key: "reject",
      label: "Reject",
      onClick: onReject,
      visibleSecondary: tab === "pool" || tab === "shortlist" || tab === "snoozed",
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
  if (onSnooze) actions.push({ key: "snooze", label: tab === "snoozed" ? "Edit" : "Snooze", onClick: onSnooze });
  if (onToggleKind && channel.kind !== "alt") {
    actions.push({
      key: "kind",
      label: channel.kind === "brand" ? "Mark creator" : "Mark brand",
      onClick: onToggleKind,
    });
  }
  if (onToggleEmailConfirmed && (!channel.email_present || channel.email_confirmed)) {
    actions.push({
      key: "email-confirmed",
      label: channel.email_confirmed ? "Unmark business email" : "Mark business email exists",
      onClick: onToggleEmailConfirmed,
      title: channel.email_confirmed
        ? "Remove the manual business-email confirmation"
        : "Manually confirm that YouTube shows a business-email button",
    });
  }
  if (onToggleActive && tab === "outreach") {
    actions.push({
      key: "active-relationship",
      label: channel.is_active ? "Stop working with" : "Mark ACTIVE / working with",
      onClick: onToggleActive,
      className: channel.is_active ? "active-action" : undefined,
    });
  }
  if (onEnrich) {
    const disabled = enrichFreshDays !== null && enrichFreshDays !== undefined;
    actions.push({
      key: "enrich",
      label: "Enrich",
      onClick: onEnrich,
      title: disabled ? `enriched ${enrichFreshDays}d ago` : "Enrich activity",
      disabled,
    });
  }
  if (onSponsorScan) {
    actions.push({
      key: "sponsor-scan",
      label: sponsorScanLoading ? "Scanning..." : "Scan sponsors",
      onClick: onSponsorScan,
      className: sponsorScanLoading ? "active-action" : undefined,
      title: "Scan recent videos for SponsorBlock signals",
      disabled: sponsorScanLoading,
    });
  }

  return actions;
}

function provenanceText(channel: ChannelCardRow): string | null {
  const parts: string[] = [];
  if (channel.source_seed_title) parts.push(`seed: ${channel.source_seed_title}`);
  if (channel.mention_count > 0) parts.push(`${channel.mention_count} mention${channel.mention_count === 1 ? "" : "s"}`);
  return parts.length ? parts.join(" / ") : null;
}

function provenanceLine(channel: ChannelCardRow, provenance: string | null): string[] {
  const parts: string[] = [];
  if (provenance) parts.push(provenance);
  if (channel.search_query) parts.push(`query: ${channel.search_query}`);
  if (channel.discovered_via) parts.push(`via ${channel.discovered_via}`);
  if (channel.kind_reason && channel.status === "rejected") parts.push(channel.kind_reason);
  return parts;
}

function footerDateLine(channel: ChannelCardRow): string[] {
  const parts: string[] = [];
  if (channel.last_upload_at) parts.push(`LAST UP ${daysAgo(channel.last_upload_at)}D`);
  if (channel.next_followup_at) parts.push(`follow up ${shortDate(channel.next_followup_at)}`);
  return parts;
}

function uploadAgeClass(lastUploadAt: string | null): string {
  return lastUploadAt && daysAgo(lastUploadAt) > 30 ? "last-upload-stale" : "";
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA", "BUTTON", "A"].includes(target.tagName);
}

function searchParameterEcho(
  uploadedWithin: string,
  minSubs: number,
  resolves: number,
  deep: boolean,
  autoEnrich: boolean,
  autoScan: boolean,
  cap: string,
): string {
  const uploads = uploadedWithin ? uploadedWithin.replace(/_/g, " ") : "any uploads";
  return `${uploads} · min subs ${compact(minSubs)} · resolves ${resolves} · deep ${deep ? "on" : "off"} · auto-enrich ${autoEnrich ? "on" : "off"} · auto-scan ${autoScan ? "on" : "off"} · ${cap.toLowerCase()}`;
}

function CardStat({ label, value, title, className }: { label: string; value: string; title?: string; className?: string }) {
  return (
    <div className={`stat-block ${className ?? ""}`} title={title}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

type SponsorCardState = "found" | "none" | "unscanned";

interface SponsorCardStats {
  rate: number;
  sponsoredCount: number;
  totalScanned: number;
  lastSponsoredDate: string | null;
  state: SponsorCardState;
}

function sponsorStatsForCard(channel: ChannelCardRow, scan?: SponsorScanSummary): SponsorCardStats {
  if (scan) {
    const scanned = scan.totalScanned > 0 || scan.scans.length > 0;
    return {
      rate: scan.sponsorshipRate,
      sponsoredCount: scan.sponsoredCount,
      totalScanned: scan.totalScanned,
      lastSponsoredDate: scan.lastSponsoredDate,
      state: !scanned ? "unscanned" : scan.sponsoredCount > 0 ? "found" : "none",
    };
  }

  return sponsorStatsFromRollup(channel);
}

function sponsorStatsFromRollup(channel: {
  sponsor_scan_sponsored: number;
  sponsorship_rate: number | null;
  sponsor_scan_total: number;
  last_sponsored_date: string | null;
  sponsor_scan_scanned_at?: string | null;
}): SponsorCardStats {
  if (channel.sponsor_scan_scanned_at && channel.sponsorship_rate !== null) {
    return {
      rate: channel.sponsorship_rate,
      sponsoredCount: channel.sponsor_scan_sponsored,
      totalScanned: channel.sponsor_scan_total,
      lastSponsoredDate: channel.last_sponsored_date,
      state: channel.sponsor_scan_sponsored > 0 ? "found" : "none",
    };
  }

  return {
    rate: 0,
    sponsoredCount: 0,
    totalScanned: 0,
    lastSponsoredDate: null,
    state: "unscanned",
  };
}

function sponsorStatValue(stats: SponsorCardStats): string {
  if (stats.state === "found") return `${Math.round(stats.rate * 100)}%`;
  if (stats.state === "none") return "NONE FOUND (SB)";
  return "?";
}

function compactSponsorStatValue(stats: SponsorCardStats): string {
  return stats.state === "found" ? `${Math.round(stats.rate * 100)}%` : "—";
}

function sponsorStatTitle(stats: SponsorCardStats): string {
  if (stats.state === "found") {
    return `${stats.sponsoredCount} of ${stats.totalScanned} recent videos have SponsorBlock segments`;
  }
  if (stats.state === "none") {
    return "SponsorBlock community data found no submitted segments. Absence is not proof of no sponsors.";
  }
  return "No sponsor scan batch exists yet.";
}

function sponsorScanFresh(channel: { sponsor_scan_scanned_at?: string | null }): boolean {
  if (!channel.sponsor_scan_scanned_at) return false;
  const scannedAt = Date.parse(channel.sponsor_scan_scanned_at);
  if (Number.isNaN(scannedAt)) return false;
  return Date.now() - scannedAt < 7 * 24 * 60 * 60 * 1000;
}

function enrichmentFreshDays(channel: { enriched_at?: string | null }): number | null {
  if (!channel.enriched_at) return null;
  const enrichedAt = Date.parse(channel.enriched_at);
  if (Number.isNaN(enrichedAt)) return null;
  const days = Math.max(0, Math.floor((Date.now() - enrichedAt) / (24 * 60 * 60 * 1000)));
  return days < 7 ? days : null;
}

function hasMetricValue(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
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
  const [note, setNote] = useState(channel.latest_outreach_note ?? "");
  const [nextFollowup, setNextFollowup] = useState(channel.next_followup_at ? dateInputValue(channel.next_followup_at) : "");
  const closed = outreachStatus === "signed" || outreachStatus === "passed";
  const updating =
    channel.outreach_status === "sent" ||
    channel.outreach_status === "replied" ||
    channel.outreach_status === "in_talks" ||
    channel.outreach_status === "pitched";

  useEffect(() => {
    if (closed) setNextFollowup("");
  }, [closed]);

  return (
    <div className="dialog-backdrop" role="presentation">
      <form
        className="dialog clipped outreach-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={updating ? "Update outreach status" : "Log outreach"}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit({
            outreach_status: outreachStatus,
            note,
            next_followup_at: nextFollowup || null,
          });
        }}
      >
        <div className="dialog-header">
          <div>
            <h2>{updating ? "Update status" : "Log outreach"}</h2>
            <div className="dialog-subtitle">{channel.title ?? channel.handle ?? channel.channel_id}</div>
          </div>
        </div>
        <label className="outreach-field">
          <span>Status</span>
          <select className="outreach-control" value={outreachStatus} onChange={(event) => setOutreachStatus(event.target.value as OutreachStatus)}>
            {OUTREACH_OPTIONS.map((option) => (
              <option key={option} value={option}>{outreachLabel(option)}</option>
            ))}
          </select>
        </label>
        <label className="outreach-field">
          <span>Note</span>
          <textarea
            className="outreach-control"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="sent intro, replied with rates, follow-up context..."
            required
          />
        </label>
        <label className="outreach-field">
          <span>
            Next follow-up <em className="optional">optional</em>
          </span>
          <input
            className="outreach-control"
            type="date"
            value={nextFollowup}
            onChange={(event) => setNextFollowup(event.target.value)}
            disabled={closed}
          />
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

function SponsorScanDialog({
  channel,
  summary,
  loading,
  onClose,
  onRescan,
  onDeepHistory,
}: {
  channel: ChannelCardRow;
  summary: SponsorScanSummary;
  loading: boolean;
  onClose: () => void;
  onRescan: () => void;
  onDeepHistory?: () => void;
}) {
  const cachedAt = summary.scans[0]?.scanned_at ?? null;
  const sponsoredLabel = `${summary.sponsoredCount} of ${summary.totalScanned} recent videos`;
  const coverageLabel = summary.coverageLabel ?? sponsoredLabel;
  const sponsoredVideos = summary.scans.filter((scan) => scan.verdict === "sponsored");
  const [blockedSponsoredUrls, setBlockedSponsoredUrls] = useState<Array<{ title: string; url: string }>>([]);

  function openSponsoredVideos() {
    if (sponsoredVideos.length === 0) return;
    setBlockedSponsoredUrls([]);
    if (
      sponsoredVideos.length > 15 &&
      !window.confirm(`Open ${sponsoredVideos.length} sponsored videos in new tabs?`)
    ) {
      return;
    }

    const blocked: Array<{ title: string; url: string }> = [];
    for (const scan of sponsoredVideos) {
      const url = `https://youtube.com/watch?v=${encodeURIComponent(scan.video_id)}`;
      const opened = window.open("about:blank", "_blank");
      if (!opened) {
        blocked.push({ title: scan.video_title ?? scan.video_id, url });
        continue;
      }

      opened.opener = null;
      opened.location.href = url;
    }
    setBlockedSponsoredUrls(blocked);
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <div className="dialog clipped sponsor-dialog" role="dialog" aria-modal="true" aria-label="Sponsor scan results">
        <div className="sponsor-dialog-head">
          <div>
            <h2>Sponsor scan</h2>
            <div className="dialog-subtitle">{channel.title ?? channel.handle ?? channel.channel_id}</div>
          </div>
          <button type="button" onClick={onClose}>Close</button>
        </div>
        <div className="sponsor-rollup">
          <span className="chip sponsor-chip">SPONSORSHIP RATE {Math.round(summary.sponsorshipRate * 100)}%</span>
          <span className="chip">{coverageLabel}</span>
          <span className="chip">LAST {summary.lastSponsoredDate ? shortDate(summary.lastSponsoredDate) : "NONE"}</span>
          {cachedAt && (
            <span className="chip">CACHED {shortDateTime(cachedAt)}</span>
          )}
          {summary.cached && (
            <button type="button" onClick={onRescan} disabled={loading}>
              {loading ? "Scanning..." : "Re-scan"}
            </button>
          )}
          <button type="button" onClick={openSponsoredVideos} disabled={sponsoredVideos.length === 0}>
            Open {sponsoredVideos.length} sponsored
          </button>
          {onDeepHistory && (
            <button type="button" onClick={onDeepHistory} disabled={loading} title="Uses one ScrapeCreators channel-videos page, then SponsorBlock only">
              {loading ? "Scanning..." : "Deep history (1 credit)"}
            </button>
          )}
        </div>
        {summary.sponsoredCount === 0 && (
          <p className="scan-empty">
            No signals found. Unconfirmed, not unsponsored. Thin coverage is common on smaller channels.
          </p>
        )}
        {blockedSponsoredUrls.length > 0 && (
          <div className="scan-open-fallback">
            <strong>{blockedSponsoredUrls.length} tab{blockedSponsoredUrls.length === 1 ? "" : "s"} blocked</strong>
            <span>Open the remaining sponsored videos manually:</span>
            {blockedSponsoredUrls.map((item) => (
              <a key={item.url} href={item.url} target="_blank" rel="noopener noreferrer">
                {item.title}
              </a>
            ))}
          </div>
        )}
        <div className="scan-table-wrap">
          <table className="data-table scan-table">
            <thead>
              <tr>
                <th>Video</th>
                <th>Published</th>
                <th>Verdict</th>
                <th>Segments</th>
              </tr>
            </thead>
            <tbody>
              {summary.scans.map((scan) => (
                <tr key={`${scan.scanned_at}-${scan.video_id}`}>
                  <td>
                    <a href={`https://youtube.com/watch?v=${scan.video_id}`} target="_blank" rel="noopener noreferrer">
                      {scan.video_title ?? scan.video_id}
                    </a>
                    {scan.error && <div className="scan-error">{scan.error}</div>}
                  </td>
                  <td>{scan.published_at ? shortDate(scan.published_at) : "--"}</td>
                  <td>
                    <span className={`chip verdict-chip ${scan.verdict === "sponsored" ? "hot-chip" : "unknown-chip"}`}>
                      {scan.verdict === "sponsored" ? "SPONSORED" : "UNKNOWN"}
                    </span>
                  </td>
                  <td>
                    {scan.verdict === "sponsored"
                      ? `${durationLabel(scan.totalDurationSeconds)} of sponsor segments`
                      : "--"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SeedGardenStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SeedRow({
  seed,
  onExpand,
  onSnapshot,
  onUnseed,
  onQuery,
  onDismissQuery,
  searchedTerms,
  muted = false,
}: {
  seed: RawChannelRow;
  onExpand: () => void;
  onSnapshot: () => void;
  onUnseed: () => void;
  onQuery: (query: string) => void;
  onDismissQuery: (query: string) => void;
  searchedTerms: Set<string>;
  muted?: boolean;
}) {
  const phrases = seed.query_phrases ?? [];
  return (
    <article className={`seed-row ${muted ? "seed-row-muted" : ""}`} role="row">
      <SeedOreTile freshness={seed.mining_freshness ?? null} />
      <div className="seed-row-channel" role="cell">
        <ChannelImage
          src={seed.thumbnail_url}
          title={seed.title ?? seed.handle ?? seed.channel_id}
          size="small"
        />
        <div className="seed-row-identity">
          <a className="channel-title" href={`https://youtube.com/channel/${seed.channel_id}`} target="_blank" rel="noreferrer">
            {seed.title ?? seed.channel_id}
          </a>
          <span>{seed.handle ? `@${seed.handle}` : "NO HANDLE"}</span>
        </div>
        {seed.is_active && <span className="chip badge-attribute active-relationship-chip">ACTIVE</span>}
        {seed.seed_locked && (
          <span className="chip badge-alert locked-chip" title={seed.seed_lock_reason ?? "LOCK REASON NOT RECORDED"}>
            ⌑ LOCKED
          </span>
        )}
      </div>
      <div className="seed-row-stat" role="cell">
        <span>YIELD</span>
        <strong>{seed.yield_count ?? 0}</strong>
      </div>
      <div className="seed-row-stat" role="cell">
        <span>SUBS</span>
        <strong>{compact(seed.subscriber_count)}</strong>
      </div>
      <div className="seed-row-stat" role="cell">
        <span>ADDED</span>
        <strong>{shortDate(seed.created_at)}</strong>
      </div>
      <div className={`seed-row-stat seed-last-upload ${seedLastUploadClass(seed.mining_freshness ?? null)}`} role="cell">
        <span>LAST UPLOAD</span>
        <strong><SeedFreshnessRecency freshness={seed.mining_freshness ?? null} /></strong>
      </div>
      <details className="seed-query-dropdown" role="cell">
        <summary>QUERIES {phrases.length}</summary>
        {phrases.length > 0 ? (
          <div className="seed-query-popover">
            <div className="suggestions seed-query-list">
              {phrases.map((phrase) => (
                <span className={`suggestion-chip ${searchedTerms.has(normalizeChipTerm(phrase)) ? "searched" : ""}`} key={phrase}>
                  <button
                    type="button"
                    onClick={() => onQuery(phrase)}
                    disabled={seed.seed_locked}
                    title={seed.seed_locked ? "Locked seed queries cannot be searched" : undefined}
                  >
                    {searchedTerms.has(normalizeChipTerm(phrase)) && <span aria-hidden="true">✓ </span>}
                    {phrase}
                  </button>
                  <button
                    className="suggestion-dismiss"
                    type="button"
                    aria-label={`Hide ${phrase}`}
                    title="Hide suggestion"
                    onClick={() => onDismissQuery(phrase)}
                    disabled={seed.seed_locked}
                  >
                    x
                  </button>
                </span>
              ))}
            </div>
          </div>
        ) : <span className="seed-query-empty">NO STORED QUERIES</span>}
      </details>
      <div className="seed-row-actions" role="cell">
        <button onClick={onExpand} disabled={seed.seed_locked} title={seed.seed_locked ? "Locked seeds cannot be expanded" : undefined}>Expand</button>
        <button onClick={onSnapshot}>Snapshot</button>
        <button onClick={onUnseed} disabled={seed.seed_locked} title={seed.seed_locked ? "Locked seeds cannot be unseeded" : undefined}>Unseed</button>
      </div>
    </article>
  );
}

function SeedOreTile({ freshness }: { freshness: SeedMiningFreshness | null }) {
  if (!freshness) return <div className="seed-ore-tile ore-pending"><strong>--</strong><span>CHECKING</span></div>;
  if (freshness.never_mined) return <div className="seed-ore-tile ore-never"><strong>!</strong><span>NEVER MINED</span></div>;
  if (freshness.status === "error") return <div className="seed-ore-tile ore-error" title={freshness.error ?? undefined}><strong>!</strong><span>RSS ERROR</span></div>;
  if (freshness.status === "empty") return <div className="seed-ore-tile ore-pending"><strong>0</strong><span>NO RSS</span></div>;
  const count = freshness.unmined_count ?? 0;
  return (
    <div className={`seed-ore-tile ${count >= 8 ? "ore-high" : count > 0 ? "ore-low" : "ore-mined"}`} title={freshness.error ?? undefined}>
      <strong>{count}{freshness.unmined_is_lower_bound ? "+" : ""}</strong>
      <span>{count > 0 ? "UNMINED" : "MINED"}{freshness.stale ? " · STALE" : ""}</span>
    </div>
  );
}

function SeedFreshnessRecency({ freshness }: { freshness: SeedMiningFreshness | null }) {
  if (!freshness) return <span>PENDING</span>;
  if (freshness.latest_upload_at) {
    return <span>{relativeTime(freshness.latest_upload_at)}</span>;
  }
  if (freshness.status === "empty") return <span>NO RSS</span>;
  if (freshness.status === "error") return <span>RSS ERROR</span>;
  return <span>UNKNOWN</span>;
}

type GrowthRow = Pick<
  ChannelCardRow,
  | "subs_growth_7d"
  | "subs_growth_7d_days"
  | "subs_growth_30d"
  | "subs_growth_30d_days"
  | "views_growth_30d"
  | "views_growth_30d_days"
  | "tracking_days"
  | "snapshots"
>;

function GrowthChips({ row }: { row: Partial<GrowthRow> }) {
  const hasGrowth = row.subs_growth_7d !== null && row.subs_growth_7d !== undefined
    || row.subs_growth_30d !== null && row.subs_growth_30d !== undefined
    || row.views_growth_30d !== null && row.views_growth_30d !== undefined;
  const snapshotCount = row.snapshots?.length ?? 0;
  if (!hasGrowth && snapshotCount === 0) return null;
  return <div className="growth-row"><GrowthChipItems row={row} /></div>;
}

function GrowthChipItems({ row }: { row: Partial<GrowthRow> }) {
  const hasGrowth = row.subs_growth_7d !== null && row.subs_growth_7d !== undefined
    || row.subs_growth_30d !== null && row.subs_growth_30d !== undefined
    || row.views_growth_30d !== null && row.views_growth_30d !== undefined;
  const snapshotCount = row.snapshots?.length ?? 0;

  if (!hasGrowth) {
    if (snapshotCount === 0) return null;
    return (
      <span className="chip badge-attribute no-trend-chip">NO TREND</span>
    );
  }

  return (
    <>
      {row.subs_growth_7d !== null && row.subs_growth_7d !== undefined && (
        <span className="chip badge-attribute growth-chip">{growthWindowLabel("SUBS", 7, row.subs_growth_7d_days)} {formatPercent(row.subs_growth_7d)}</span>
      )}
      {row.subs_growth_30d !== null && row.subs_growth_30d !== undefined && (
        <span className="chip badge-attribute growth-chip">{growthWindowLabel("SUBS", 30, row.subs_growth_30d_days)} {formatPercent(row.subs_growth_30d)}</span>
      )}
      {row.views_growth_30d !== null && row.views_growth_30d !== undefined && (
        <span className="chip badge-attribute growth-chip dim">{growthWindowLabel("VIEWS", 30, row.views_growth_30d_days)} {formatPercent(row.views_growth_30d)}</span>
      )}
    </>
  );
}

function Sparkline({ points }: { points: ChannelCardRow["snapshots"] }) {
  const plotted = (points ?? [])
    .map((point) => ({
      value: point.subscriber_count,
      timestamp: Date.parse(point.taken_at),
    }))
    .filter((point): point is { value: number; timestamp: number } => (
      typeof point.value === "number"
      && Number.isFinite(point.value)
      && Number.isFinite(point.timestamp)
    ))
    .sort((a, b) => a.timestamp - b.timestamp);
  if (plotted.length < 2) return null;

  const values = plotted.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const width = 160;
  const height = 34;
  const firstTime = plotted[0].timestamp;
  const lastTime = plotted[plotted.length - 1].timestamp;
  const timeRange = Math.max(1, lastTime - firstTime);
  const d = plotted.map((point, index) => {
    const x = ((point.timestamp - firstTime) / timeRange) * width;
    const y = height - ((point.value - min) / range) * (height - 4) - 2;
    return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");
  const netChange = values[0] > 0
    ? ((values[values.length - 1] - values[0]) / values[0]) * 100
    : 0;

  return (
    <div className="sparkline-wrap" title={`Subscriber change over plotted span: ${formatPercent(netChange)}`}>
      <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
        <path d={d} />
      </svg>
      <span className="sparkline-change">{formatPercent(netChange)}</span>
    </div>
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

function LegacySuggestionRows({
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

function SuggestionRows({
  topics,
  content,
  onPick,
  onDismiss,
  searchedTerms,
  onLowPool,
}: {
  topics: SearchSuggestion[];
  content: SearchSuggestion[];
  onPick: (term: string) => void;
  onDismiss: (term: string) => void;
  searchedTerms: Set<string>;
  onLowPool: () => void;
}) {
  const [searchedOpen, setSearchedOpen] = useState(false);
  const topicGroups = splitSearchedSuggestions(topics, searchedTerms);
  const contentGroups = splitSearchedSuggestions(content, searchedTerms);
  const searchedSuggestions = uniqueSuggestions([
    ...topicGroups.searched,
    ...contentGroups.searched,
  ]);
  const unsearchedCount = topicGroups.unsearched.length + contentGroups.unsearched.length;

  if (topics.length === 0 && content.length === 0) {
    return (
      <div className="suggestion-rows">
        <QueryPoolPrompt onOpenSeeds={onLowPool} />
      </div>
    );
  }

  return (
    <div className="suggestion-rows">
      <DiscoverySuggestionRow label="TOPICS" suggestions={topicGroups.unsearched} onPick={onPick} onDismiss={onDismiss} searchedTerms={searchedTerms} />
      <DiscoverySuggestionRow label="CONTENT" suggestions={contentGroups.unsearched} onPick={onPick} onDismiss={onDismiss} searchedTerms={searchedTerms} />
      {searchedSuggestions.length > 0 && (
        <div className="suggestions searched-collapse">
          <span className={`suggestion-chip searched-summary ${searchedOpen ? "active" : ""}`}>
            <button type="button" onClick={() => setSearchedOpen((value) => !value)}>
              {searchedSuggestions.length} searched
            </button>
          </span>
          {searchedOpen && searchedSuggestions.map((suggestion) => (
            <DiscoverySuggestionChip
              key={`searched-${suggestion.term}`}
              suggestion={suggestion}
              label="SEARCHED"
              searched
              onPick={onPick}
              onDismiss={onDismiss}
            />
          ))}
        </div>
      )}
      {unsearchedCount < 5 && <QueryPoolPrompt onOpenSeeds={onLowPool} />}
    </div>
  );
}

function splitSearchedSuggestions(suggestions: SearchSuggestion[], searchedTerms: Set<string>) {
  return suggestions.reduce<{ searched: SearchSuggestion[]; unsearched: SearchSuggestion[] }>((groups, suggestion) => {
    if (searchedTerms.has(normalizeChipTerm(suggestion.term))) {
      groups.searched.push(suggestion);
    } else {
      groups.unsearched.push(suggestion);
    }
    return groups;
  }, { searched: [], unsearched: [] });
}

function uniqueSuggestions(suggestions: SearchSuggestion[]) {
  const seen = new Set<string>();
  const unique: SearchSuggestion[] = [];
  for (const suggestion of suggestions) {
    const key = normalizeChipTerm(suggestion.term);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(suggestion);
  }
  return unique;
}

function QueryPoolPrompt({ onOpenSeeds }: { onOpenSeeds: () => void }) {
  return (
    <div className="suggestions">
      <span className="suggestion-chip query-pool-prompt">
        <button type="button" onClick={onOpenSeeds} title="Open Seeds to regenerate query suggestions">
          Query pool low. Regen from seeds
        </button>
      </span>
    </div>
  );
}

function DiscoverySuggestionRow({
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
      {suggestions.slice(0, 12).map((suggestion) => (
        <DiscoverySuggestionChip
          key={`${text}-${suggestion.term}`}
          suggestion={suggestion}
          label={text}
          searched={searchedTerms.has(normalizeChipTerm(suggestion.term))}
          onPick={onPick}
          onDismiss={onDismiss}
        />
      ))}
    </div>
  );
}

function DiscoverySuggestionChip({
  suggestion,
  label,
  searched,
  onPick,
  onDismiss,
}: {
  suggestion: SearchSuggestion;
  label: string;
  searched: boolean;
  onPick: (term: string) => void;
  onDismiss: (term: string) => void;
}) {
  return (
    <span className={`suggestion-chip ${searched ? "searched" : ""}`} key={`${label}-${suggestion.term}`}>
      <button
        type="button"
        title={`shared by ${suggestion.seed_count} seed${suggestion.seed_count === 1 ? "" : "s"}: ${suggestion.seeds.map((seed) => seed.title ?? seed.handle ?? seed.channel_id).join(", ")}`}
        onClick={() => onPick(suggestion.term)}
      >
        {searched && <span aria-hidden="true">OK </span>}
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
  const unlockedSeeds = seeds.filter((seed) => !seed.seed_locked);
  const result = await runBulkOperation({
    action: "Expanding",
    items: unlockedSeeds.map((seed) => ({
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
    seeds_total: unlockedSeeds.length,
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

function ScoreBreakdownPopover({ channel }: { channel: ChannelCardRow }) {
  const breakdown = channel.score_breakdown;
  const components = Object.entries(breakdown?.components ?? {});
  return (
    <aside className="score-popover" aria-label="Real score decomposition">
      <div className="score-popover-head">
        <strong>{channel.title ?? channel.channel_id} — {channel.score?.toFixed(0) ?? "--"}</strong>
        <span>REAL SCORE</span>
      </div>
      {components.length === 0 ? (
        <p>No score decomposition available.</p>
      ) : components.map(([name, component]) => (
        <div className="score-component" key={name}>
          <div>
            <span>{scoreComponentLabel(name)}</span>
            <strong>{component.points?.toFixed(1) ?? "0.0"} / {component.weight ?? 0}</strong>
          </div>
          <progress max={component.weight ?? 1} value={component.points ?? 0} />
          <small>{component.reason ?? ""}</small>
        </div>
      ))}
      {(breakdown?.notes?.length ?? 0) > 0 && <div className="score-notes">{breakdown?.notes?.join(" · ")}</div>}
    </aside>
  );
}

function scoreComponentLabel(name: string): string {
  const labels: Record<string, string> = {
    subRangeFit: "subscriber fit",
    engagementReach: "engagement + reach",
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

function IconLinks({
  links,
  confirmedEmail = false,
}: {
  links: Array<{ type: string; label: string; url: string }>;
  confirmedEmail?: boolean;
}) {
  if (links.length === 0 && !confirmedEmail) return null;
  return (
    <div className="icon-row">
      {links.map((link, index) => (
        <a key={`${link.type}-${index}`} href={link.url} target="_blank" rel="noopener noreferrer" title={link.label}>
          {iconText(link.type)}
        </a>
      ))}
      {confirmedEmail && (
        <span
          className="contact-indicator manual-email"
          title="EMAIL (CONFIRMED) - manual confirmation"
          aria-label="Email confirmed manually"
        >
          {iconText("email")}
        </span>
      )}
    </div>
  );
}

function BrandLinks({
  links,
  hiddenCount,
  expanded,
  onToggle,
}: {
  links: Array<{ label: string; url: string }>;
  hiddenCount: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="brand-link-row">
      {links.map((link) => (
        <a key={link.url} className="brand-link-chip" href={link.url} target="_blank" rel="noopener noreferrer" title={link.url}>
          {link.label}
        </a>
      ))}
      {(hiddenCount > 0 || expanded) && (
        <button type="button" className="brand-link-chip more" onClick={onToggle}>
          {expanded ? "show less" : `+${hiddenCount} more`}
        </button>
      )}
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
  if (tab === "snoozed") return "SNOOZED";
  return tab.toUpperCase();
}

function tabCount(tab: Tab, status: StatusPayload | null): number | null {
  if (!status) return null;
  if (tab === "pool") return status.channel_counts.pool ?? 0;
  if (tab === "shortlist") return status.channel_counts.shortlist ?? 0;
  if (tab === "outreach") return status.channel_counts.outreach_total ?? 0;
  if (tab === "watchlist") return status.channel_counts.by_status.watchlist ?? 0;
  if (tab === "snoozed") return status.channel_counts.by_status.snoozed ?? 0;
  if (tab === "seeds") return status.channel_counts.seeds ?? 0;
  if (tab === "rejected") return status.channel_counts.by_status.rejected ?? 0;
  if (tab === "brands") return status.channel_counts.by_kind.brand ?? 0;
  return null;
}

function stageTitle(stage: StageTab): string {
  if (stage === "shortlist") return "Outreach potentials";
  if (stage === "watchlist") return "Eyes peeled";
  if (stage === "snoozed") return "Snoozed channels";
  if (stage === "rejected") return "Rejected channels";
  return "Triage pool";
}

function stageDetail(stage: StageTab): string {
  if (stage === "shortlist") return "Shortlisted channels, including any that are also seeds.";
  if (stage === "watchlist") return "Early channels worth watching before outreach.";
  if (stage === "snoozed") return "Good channels parked until inventory catches up.";
  if (stage === "rejected") return "Channels removed from active consideration.";
  return "Candidate channels that have not been seeded, shortlisted, or rejected.";
}

function emptyTitle(stage: StageTab): string {
  if (stage === "shortlist") return "No shortlisted channels";
  if (stage === "watchlist") return "No channels on watch";
  if (stage === "snoozed") return "Nothing snoozed";
  if (stage === "rejected") return "No rejected channels";
  return "Pool is clear";
}

function emptyDetail(stage: StageTab): string {
  if (stage === "shortlist") return "Shortlist cards from Pool or Search to build the outreach list.";
  if (stage === "watchlist") return "Move early prospects here with Eyes Peeled.";
  if (stage === "snoozed") return "Snoozed channels return to Pool when their wake date arrives.";
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

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  if (value === "wake") return value;
  if (value === "subs_desc" || value === "subs_asc") return value;
  return "score";
}

function compact(value: number | null | undefined): string {
  if (value === null || value === undefined) return "--";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}K`;
  return String(value);
}

function durationLabel(seconds: number | null | undefined): string {
  const totalSeconds = Math.max(0, Math.round(seconds ?? 0));
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = totalSeconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
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
    if (sort === "wake") {
      const aWake = a.snoozed_until ? Date.parse(a.snoozed_until) : Number.POSITIVE_INFINITY;
      const bWake = b.snoozed_until ? Date.parse(b.snoozed_until) : Number.POSITIVE_INFINITY;
      if (aWake !== bWake) return aWake - bWake;
    }
    return (b.score ?? 0) - (a.score ?? 0);
  });
}

function sortSeeds(seeds: RawChannelRow[], sort: SeedSortMode): RawChannelRow[] {
  return [...seeds].sort((a, b) => {
    if (sort === "yield") {
      const yieldDifference = (b.yield_count ?? 0) - (a.yield_count ?? 0);
      if (yieldDifference !== 0) return yieldDifference;
    }
    if (sort === "latest_upload") {
      const latestDifference = freshnessUploadTime(b) - freshnessUploadTime(a);
      if (latestDifference !== 0) return latestDifference;
    }
    if (sort === "unmined") {
      const unminedDifference = freshnessSortValue(b) - freshnessSortValue(a);
      if (unminedDifference !== 0) return unminedDifference;
      const latestDifference = freshnessUploadTime(b) - freshnessUploadTime(a);
      if (latestDifference !== 0) return latestDifference;
    }
    return (a.title ?? a.handle ?? a.channel_id).localeCompare(
      b.title ?? b.handle ?? b.channel_id,
    );
  });
}

function freshnessSortValue(seed: RawChannelRow): number {
  const freshness = seed.mining_freshness;
  if (!freshness) return -2;
  if (freshness.never_mined) return 1_000_000;
  if (freshness.status !== "ok") return -1;
  return freshness.unmined_count ?? 0;
}

function freshnessUploadTime(seed: RawChannelRow): number {
  const parsed = Date.parse(seed.mining_freshness?.latest_upload_at ?? "");
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function isMinedOutSeed(seed: RawChannelRow): boolean {
  const freshness = seed.mining_freshness;
  return Boolean(
    freshness
    && freshness.status === "ok"
    && !freshness.never_mined
    && (freshness.unmined_count ?? 0) === 0,
  );
}

function seedLastUploadClass(freshness: SeedMiningFreshness | null): string {
  if (!freshness?.latest_upload_at) return "";
  const published = Date.parse(freshness.latest_upload_at);
  if (!Number.isFinite(published)) return "";
  return Date.now() - published < 24 * 60 * 60 * 1000 ? "seed-upload-fresh" : "";
}

function summarizeSeedGarden(seeds: RawChannelRow[]): {
  seeds: number;
  unmined: number;
  unminedLowerBound: boolean;
  yield: number;
  locked: number;
} {
  return seeds.reduce<{
    seeds: number;
    unmined: number;
    unminedLowerBound: boolean;
    yield: number;
    locked: number;
  }>((summary, seed) => {
    const freshness = seed.mining_freshness;
    if (freshness?.status === "ok" && !freshness.never_mined) {
      summary.unmined += freshness.unmined_count ?? 0;
      summary.unminedLowerBound ||= freshness.unmined_is_lower_bound;
    }
    summary.yield += seed.yield_count ?? 0;
    summary.locked += seed.seed_locked ? 1 : 0;
    return summary;
  }, {
    seeds: seeds.length,
    unmined: 0,
    unminedLowerBound: false,
    yield: 0,
    locked: 0,
  });
}

function snoozeUntil(duration: "1" | "3" | "6" | "custom", customDate: string): string {
  if (duration === "custom") return new Date(`${customDate}T12:00:00`).toISOString();
  const until = new Date();
  until.setMonth(until.getMonth() + Number(duration));
  return until.toISOString();
}

function formatPercent(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(Math.abs(value) >= 10 ? 0 : 1)}%`;
}

function growthWindowLabel(
  metric: "SUBS" | "VIEWS",
  targetDays: number,
  actualDays: number | null | undefined,
): string {
  const days = typeof actualDays === "number"
    ? Math.min(targetDays, Math.max(0, actualDays))
    : targetDays;
  return `${metric} ${days}D`;
}

function scoreTier(score: number | null): string {
  if (score === null) return "low";
  if (score >= 70) return "high";
  if (score >= 55) return "mid";
  return "low";
}

function enrichToastMessage(result: EnrichSummary): string {
  const breakdown = result.credits_breakdown;
  const base = `Enriched ${result.channels_enriched} channel(s), spent ${result.credits_spent_this_run} credit(s).`;
  if (!breakdown) return base;
  if (breakdown.retry_credits === 0 && breakdown.other_credits === 0) return base;
  return `${base} Breakdown: ${breakdown.channel_video_pages} video page(s), ${breakdown.retry_credits} retry, ${breakdown.other_credits} other.`;
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
  if (channel.outreach_status !== "sent") return false;
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

function brandLinkLabel(url: string): string {
  const host = linkLabel(url).toLowerCase();
  if (host.includes("instagram")) return "instagram";
  if (host.includes("tiktok")) return "tiktok";
  if (host.includes("twitter") || host === "x.com") return "x";
  if (host.includes("facebook")) return "facebook";
  if (host.includes("youtube")) return "youtube";
  if (host.includes("linktr.ee")) return "linktree";
  return host || "link";
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
