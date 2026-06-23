// Client-side settings helper for the "Portfolio Actual vs Target over time"
// Trend view (issue #432, part of milestone #422).
//
// This remembers the user's Trend-view choices across visits, backed by
// localStorage under namespaced `grq.trend.*` keys:
//   - the grouping granularity (day / week / month / quarter), and
//   - each benchmark-index on/off toggle (SP500 / NASDAQ / Russell 2000).
//
// Like docs/theme.js, docs/trend_series.js and docs/index_overlay.js this file
// is loaded as a classic <script> and is also imported by the Deno tests. It
// uses no module syntax, publishes its helpers on globalThis.GRQTrendSettings,
// and guards EVERY storage access so absent / corrupt / unavailable storage
// (e.g. private mode) falls back to defaults without ever throwing.
//
// This module owns only persistence — it adds no DOM and no chart. The Trend
// view UI sub-issue (#430) calls `readTrendSettings()` on view init to restore
// the controls, and `writeGrouping(...)` / `setIndexToggle(...)` on change.
//
// Storage is injectable: every read/write takes an optional `storage` argument
// (any Web Storage-like { getItem, setItem }). When omitted it defaults to the
// ambient `localStorage`; passing an explicit `null` models a no-storage
// environment. This keeps the helpers pure and deterministically testable.
(function () {
  "use strict";

  // The grouping granularities, mirroring GRQTrendSeries.GRANULARITIES (reused
  // when that engine has loaded, else a local copy so this module parses and
  // tests independently).
  const GRANULARITIES =
    (globalThis.GRQTrendSeries && globalThis.GRQTrendSeries.GRANULARITIES) ||
    ["day", "week", "month", "quarter"];

  // The user-facing default grouping (issue #432: grouping = month).
  const DEFAULT_GROUPING = "month";

  // The benchmark indices whose toggles we persist, reusing the overlay
  // engine's single source of truth when present, else a local fallback list.
  const INDEX_KEYS =
    (globalThis.GRQIndexOverlay && globalThis.GRQIndexOverlay.OVERLAY_INDICES &&
      globalThis.GRQIndexOverlay.OVERLAY_INDICES.map((i) => i.key)) ||
    ["sp500", "nasdaq", "russell2000"];

  // Namespaced localStorage keys (issue #432: keys under `grq.trend.*`).
  const STORAGE_KEYS = {
    grouping: "grq.trend.grouping",
    indices: "grq.trend.indices",
  };

  // Coerce an arbitrary value to a known granularity, defaulting to month so a
  // corrupt or missing stored value never breaks the view.
  function normaliseGrouping(value) {
    return GRANULARITIES.includes(value) ? value : DEFAULT_GROUPING;
  }

  // Coerce an arbitrary (possibly partial / null) toggle object into a full
  // boolean map. Delegates to the overlay engine when present (one source of
  // truth) so the persisted shape matches what the chart consumes; otherwise
  // applies the same all-off default locally.
  function normaliseToggles(toggles) {
    if (
      globalThis.GRQIndexOverlay &&
      typeof globalThis.GRQIndexOverlay.normaliseToggles === "function"
    ) {
      return globalThis.GRQIndexOverlay.normaliseToggles(toggles);
    }
    const source = toggles && typeof toggles === "object" ? toggles : {};
    const result = {};
    for (const key of INDEX_KEYS) {
      result[key] = key in source ? Boolean(source[key]) : false;
    }
    return result;
  }

  // Resolve the storage to use: an explicitly-passed value (which may be null)
  // wins; otherwise fall back to the ambient localStorage, tolerating an
  // environment where even touching it throws.
  function resolveStorage(storage) {
    if (storage !== undefined) {
      return storage;
    }
    try {
      return typeof localStorage !== "undefined" ? localStorage : null;
    } catch (_err) {
      return null;
    }
  }

  // Read one key, returning null on any failure (no storage, throws, missing).
  function safeGet(storage, key) {
    const store = resolveStorage(storage);
    if (!store || typeof store.getItem !== "function") {
      return null;
    }
    try {
      return store.getItem(key);
    } catch (_err) {
      return null;
    }
  }

  // Write one key, returning whether it was persisted (false on any failure).
  function safeSet(storage, key, value) {
    const store = resolveStorage(storage);
    if (!store || typeof store.setItem !== "function") {
      return false;
    }
    try {
      store.setItem(key, value);
      return true;
    } catch (_err) {
      return false;
    }
  }

  // --- grouping ------------------------------------------------------------

  function readGrouping(storage) {
    return normaliseGrouping(safeGet(storage, STORAGE_KEYS.grouping));
  }

  function writeGrouping(value, storage) {
    return safeSet(storage, STORAGE_KEYS.grouping, normaliseGrouping(value));
  }

  // --- index toggles -------------------------------------------------------

  function readToggles(storage) {
    const raw = safeGet(storage, STORAGE_KEYS.indices);
    if (raw === null) {
      return normaliseToggles(null);
    }
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (_err) {
      parsed = null; // corrupt JSON -> defaults
    }
    return normaliseToggles(parsed);
  }

  function writeToggles(toggles, storage) {
    return safeSet(
      storage,
      STORAGE_KEYS.indices,
      JSON.stringify(normaliseToggles(toggles)),
    );
  }

  // Read-modify-write a single index toggle (the "write on change" path the UI
  // calls when the user flips one benchmark). Returns the resulting normalised
  // map regardless of whether the save succeeded, so the caller can still drive
  // the live chart when storage is unavailable. Unknown keys are ignored.
  function setIndexToggle(key, on, storage) {
    const toggles = readToggles(storage);
    if (INDEX_KEYS.includes(key)) {
      toggles[key] = Boolean(on);
    }
    writeToggles(toggles, storage);
    return toggles;
  }

  // --- combined ------------------------------------------------------------

  function readTrendSettings(storage) {
    return {
      grouping: readGrouping(storage),
      toggles: readToggles(storage),
    };
  }

  // Persist both parts. Returns true only when BOTH writes succeeded. A missing
  // part falls back to its default before being written.
  function writeTrendSettings(settings, storage) {
    const source = settings && typeof settings === "object" ? settings : {};
    const groupingOk = writeGrouping(source.grouping, storage);
    const togglesOk = writeToggles(source.toggles, storage);
    return groupingOk && togglesOk;
  }

  // Publish the helpers for the dashboard and the tests.
  globalThis.GRQTrendSettings = {
    GRANULARITIES,
    DEFAULT_GROUPING,
    STORAGE_KEYS,
    normaliseGrouping,
    normaliseToggles,
    readGrouping,
    writeGrouping,
    readToggles,
    writeToggles,
    setIndexToggle,
    readTrendSettings,
    writeTrendSettings,
  };
})();
