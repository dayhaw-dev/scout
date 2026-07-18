export const DISCOVERY_DEFAULTS_STORAGE_KEY = "scout_search_defaults_v1";

export const UPLOAD_WINDOWS = ["", "today", "this_week", "this_month", "this_year"] as const;

export type UploadWindow = (typeof UPLOAD_WINDOWS)[number];
export type SearchCreditCapMode = "none" | "40";

export type DiscoveryDefaults = {
  uploadedWithin: UploadWindow;
  minSubs: number;
  maxResolves: number;
  deepSearch: boolean;
  autoEnrich: boolean;
  autoScan: boolean;
  creditCap: SearchCreditCapMode;
};

export const BASE_DISCOVERY_DEFAULTS: DiscoveryDefaults = {
  uploadedWithin: "",
  minSubs: 5000,
  maxResolves: 10,
  deepSearch: false,
  autoEnrich: true,
  autoScan: true,
  creditCap: "none",
};

type DiscoveryDefaultsStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

export function validateDiscoveryDefaults(value: unknown): DiscoveryDefaults {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...BASE_DISCOVERY_DEFAULTS };
  }

  const candidate = value as Record<string, unknown>;
  return {
    uploadedWithin: isUploadWindow(candidate.uploadedWithin)
      ? candidate.uploadedWithin
      : BASE_DISCOVERY_DEFAULTS.uploadedWithin,
    minSubs: boundedInteger(candidate.minSubs, 0, 100_000_000, BASE_DISCOVERY_DEFAULTS.minSubs),
    maxResolves: boundedInteger(candidate.maxResolves, 1, 25, BASE_DISCOVERY_DEFAULTS.maxResolves),
    deepSearch: booleanOrFallback(candidate.deepSearch, BASE_DISCOVERY_DEFAULTS.deepSearch),
    autoEnrich: booleanOrFallback(candidate.autoEnrich, BASE_DISCOVERY_DEFAULTS.autoEnrich),
    autoScan: booleanOrFallback(candidate.autoScan, BASE_DISCOVERY_DEFAULTS.autoScan),
    creditCap: candidate.creditCap === "40" || candidate.creditCap === "none"
      ? candidate.creditCap
      : BASE_DISCOVERY_DEFAULTS.creditCap,
  };
}

export function loadDiscoveryDefaults(storage: DiscoveryDefaultsStorage | null): DiscoveryDefaults {
  if (!storage) return { ...BASE_DISCOVERY_DEFAULTS };
  try {
    const stored = storage.getItem(DISCOVERY_DEFAULTS_STORAGE_KEY);
    return stored ? validateDiscoveryDefaults(JSON.parse(stored)) : { ...BASE_DISCOVERY_DEFAULTS };
  } catch {
    return { ...BASE_DISCOVERY_DEFAULTS };
  }
}

export function saveDiscoveryDefaults(storage: DiscoveryDefaultsStorage, defaults: DiscoveryDefaults): DiscoveryDefaults {
  const validated = validateDiscoveryDefaults(defaults);
  storage.setItem(DISCOVERY_DEFAULTS_STORAGE_KEY, JSON.stringify(validated));
  return validated;
}

function isUploadWindow(value: unknown): value is UploadWindow {
  return typeof value === "string" && (UPLOAD_WINDOWS as readonly string[]).includes(value);
}

function boundedInteger(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function booleanOrFallback(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}
