import assert from "node:assert/strict";
import test from "node:test";
import {
  BASE_DISCOVERY_DEFAULTS,
  DISCOVERY_DEFAULTS_STORAGE_KEY,
  loadDiscoveryDefaults,
  saveDiscoveryDefaults,
  validateDiscoveryDefaults,
} from "../ui/src/discovery-defaults.js";

function fakeStorage(initial: string | null = null) {
  let value = initial;
  return {
    getItem(key: string) {
      assert.equal(key, DISCOVERY_DEFAULTS_STORAGE_KEY);
      return value;
    },
    setItem(key: string, next: string) {
      assert.equal(key, DISCOVERY_DEFAULTS_STORAGE_KEY);
      value = next;
    },
    value: () => value,
  };
}

test("discovery defaults safely fall back when browser storage is empty or malformed", () => {
  assert.deepEqual(loadDiscoveryDefaults(null), BASE_DISCOVERY_DEFAULTS);
  assert.deepEqual(loadDiscoveryDefaults(fakeStorage("not json")), BASE_DISCOVERY_DEFAULTS);
  assert.deepEqual(loadDiscoveryDefaults(fakeStorage(JSON.stringify(["obsolete"]))), BASE_DISCOVERY_DEFAULTS);
});

test("discovery defaults validate every persisted field and preserve valid preferences", () => {
  assert.deepEqual(validateDiscoveryDefaults({
    uploadedWithin: "this_month",
    minSubs: -40,
    maxResolves: 99,
    deepSearch: true,
    autoEnrich: false,
    autoScan: true,
    creditCap: "40",
  }), {
    uploadedWithin: "this_month",
    minSubs: 0,
    maxResolves: 25,
    deepSearch: true,
    autoEnrich: false,
    autoScan: true,
    creditCap: "40",
  });

  assert.deepEqual(validateDiscoveryDefaults({
    uploadedWithin: "forever",
    minSubs: "5000",
    maxResolves: null,
    deepSearch: "yes",
    autoEnrich: 1,
    autoScan: undefined,
    creditCap: "100",
  }), BASE_DISCOVERY_DEFAULTS);
});

test("saving browser-local discovery defaults writes the versioned validated payload", () => {
  const storage = fakeStorage();
  const saved = saveDiscoveryDefaults(storage, {
    uploadedWithin: "this_year",
    minSubs: 12_500,
    maxResolves: 20,
    deepSearch: true,
    autoEnrich: true,
    autoScan: false,
    creditCap: "40",
  });

  assert.deepEqual(JSON.parse(storage.value() ?? "null"), saved);
  assert.deepEqual(loadDiscoveryDefaults(storage), saved);
});
