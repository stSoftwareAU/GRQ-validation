// Client-side settings helper for the optional minimum-star-rating filter
// (issue #654, foundation sub-issue of milestone #653).
//
// This remembers the user's chosen minimum whole-star threshold — 0 ("All", the
// off/default state) or 1–5 — backed by localStorage under the namespaced
// `grq.filter.*` key. A SINGLE setting drives both views: the portfolio table
// on docs/index.html (#653 follow-up) and the Trend chart on docs/trend.html
// (#653 follow-up). Because the key is shared, a choice made on one page is
// reflected on the other across reloads.
//
// Like docs/chart_window_settings.js and docs/trend_settings.js this file is
// loaded as a classic <script> and is also imported by the Deno tests. It uses
// no module syntax, publishes its helpers on globalThis.GRQStarFilter, and
// guards EVERY storage access so absent / corrupt / unavailable storage (e.g.
// private mode) falls back to the default (0 = All) without ever throwing.
//
// Integration contract (consumed by the two sibling #653 sub-issues):
//   - globalThis.GRQStarFilter.getMinStars() -> 0 (All/off) or 1..5.
//   - globalThis.GRQStarFilter.setMinStars(n) persists the normalised value and
//     dispatches a `grq:star-filter-change` CustomEvent on the global (window)
//     target, with `event.detail.minStars` carrying the new threshold. The two
//     views subscribe to this event to re-render when the threshold changes.
//
// This module owns only persistence and the change-event contract — it adds no
// DOM, no chart, and changes no aggregate or chart maths. With the threshold at
// its 0 ("All") default, both views behave byte-for-byte as before.
//
// Storage is injectable: every read/write takes an optional `storage` argument
// (any Web Storage-like { getItem, setItem }). When omitted it defaults to the
// ambient `localStorage`; passing an explicit `null` models a no-storage
// environment. This keeps the helpers pure and deterministically testable.
(function () {
  "use strict";

  // The user-facing default threshold: 0 means "All" (filter off). The control
  // defaults here so dashboard behaviour is unchanged until the user opts in.
  const DEFAULT_MIN_STARS = 0;

  // The only allowed thresholds: 0 (All/off) plus the whole stars 1–5.
  const ALLOWED_MIN_STARS = [0, 1, 2, 3, 4, 5];

  // Namespaced localStorage key (issue #654: key under `grq.filter.*`). A single
  // key shared by both pages so the threshold persists and stays in sync.
  const STORAGE_KEY = "grq.filter.minStars";

  // The documented DOM event dispatched on the global (window) target whenever
  // the threshold changes via setMinStars. `event.detail.minStars` carries the
  // new normalised value. This is the integration surface the two sibling #653
  // sub-issues subscribe to.
  const CHANGE_EVENT = "grq:star-filter-change";

  // Coerce an arbitrary value to one of the allowed thresholds, defaulting to 0
  // ("All") so a missing / corrupt / out-of-range stored value never breaks the
  // view. Accepts both numbers and their string forms (localStorage only stores
  // strings); non-whole numbers and values outside 0–5 fall back to 0.
  function normaliseMinStars(value) {
    const num = typeof value === "string" ? Number(value) : value;
    return ALLOWED_MIN_STARS.includes(num) ? num : DEFAULT_MIN_STARS;
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

  // --- read / write (storage-injectable, pure) -------------------------------

  // Read the persisted threshold, normalised to 0 or 1..5. Falls back to 0 when
  // storage is empty / corrupt / unavailable.
  function readMinStars(storage) {
    return normaliseMinStars(safeGet(storage, STORAGE_KEY));
  }

  // Persist a threshold (normalised first). Returns whether it was saved.
  function writeMinStars(value, storage) {
    return safeSet(storage, STORAGE_KEY, String(normaliseMinStars(value)));
  }

  // --- accessor contract (ambient storage + change event) --------------------

  // Public getter: the current threshold from the ambient localStorage (0 for
  // All). This is what the portfolio and Trend views read on init and on each
  // `grq:star-filter-change` event.
  function getMinStars() {
    return readMinStars();
  }

  // Dispatch the documented change event on the global (window) target, guarded
  // so a non-browser / no-EventTarget environment never throws.
  function dispatchChange(minStars) {
    try {
      if (
        typeof globalThis.dispatchEvent === "function" &&
        typeof CustomEvent === "function"
      ) {
        globalThis.dispatchEvent(
          new CustomEvent(CHANGE_EVENT, { detail: { minStars } }),
        );
      }
    } catch (_err) {
      // A failed dispatch must never break the setter — the value is still
      // persisted and the caller can re-render directly if needed.
    }
  }

  // Public setter: normalise, persist to the ambient localStorage, then dispatch
  // `grq:star-filter-change` so subscribers re-render. Returns the normalised
  // threshold so the caller can drive its own view even when storage is
  // unavailable. Storage is injectable for tests (defaults to ambient).
  function setMinStars(value, storage) {
    const minStars = normaliseMinStars(value);
    writeMinStars(minStars, storage);
    dispatchChange(minStars);
    return minStars;
  }

  // Publish the helpers for the dashboard, the Trend view, and the tests.
  globalThis.GRQStarFilter = {
    STORAGE_KEY,
    CHANGE_EVENT,
    DEFAULT_MIN_STARS,
    ALLOWED_MIN_STARS,
    normaliseMinStars,
    readMinStars,
    writeMinStars,
    getMinStars,
    setMinStars,
  };
})();
