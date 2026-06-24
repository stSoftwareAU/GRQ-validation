// Client-side settings helper for the per-device chart-window choice
// (issue #447, sub-issue of milestone #445; desktop added in issue #465).
//
// This remembers, per device, the user's choice of chart window — 90 days or
// the full 180 days — backed by localStorage under namespaced `grq.chart.*`
// keys (mirroring `grq.trend.*`). Mobile and desktop have SEPARATE keys and
// SEPARATE defaults (mobile 90, desktop 180) so a desktop choice can never
// regress mobile's required 90-day default (parent invariant #457).
//
// Like docs/trend_settings.js and docs/theme.js this file is loaded as a
// classic <script> and is also imported by the Deno tests. It uses no module
// syntax, publishes its helpers on globalThis.GRQChartWindow, and guards EVERY
// storage access so absent / corrupt / unavailable storage (e.g. private mode)
// falls back to the default without ever throwing.
//
// This module owns only persistence — it adds no DOM and no chart. The toggle
// UI sub-issue reads `readMobileWindowDays()` on init to restore the control,
// and calls `writeMobileWindowDays(...)` on change.
//
// Storage is injectable: every read/write takes an optional `storage` argument
// (any Web Storage-like { getItem, setItem }). When omitted it defaults to the
// ambient `localStorage`; passing an explicit `null` models a no-storage
// environment. This keeps the helpers pure and deterministically testable.
(function () {
  "use strict";

  // The user-facing default mobile chart window, in days (issue #447: 90).
  const MOBILE_WINDOW_DAYS_DEFAULT = 90;

  // The user-facing default desktop chart window, in days (issue #465: 180).
  const DESKTOP_WINDOW_DAYS_DEFAULT = 180;

  // The only two allowed window choices.
  const ALLOWED_WINDOW_DAYS = [90, 180];

  // Namespaced localStorage key (issue #447: key under `grq.chart.*`).
  const STORAGE_KEY = "grq.chart.mobileWindowDays";

  // Namespaced localStorage key for the per-device desktop choice (issue #465).
  // Desktop keeps its OWN key so a desktop write can never change what mobile
  // reads — preserving mobile's required 90-day default (parent #457).
  const DESKTOP_STORAGE_KEY = "grq.chart.desktopWindowDays";

  // Coerce an arbitrary value to one of the allowed windows, defaulting to the
  // supplied fallback so a missing / corrupt stored value never breaks the
  // view. Accepts both numbers and their string forms (localStorage only stores
  // strings). The fallback is parameterised (issue #465) so mobile falls back
  // to 90 and desktop falls back to 180; an omitted fallback keeps the original
  // mobile-90 behaviour for existing callers.
  function normaliseWindowDays(value, fallback) {
    const def = fallback === undefined ? MOBILE_WINDOW_DAYS_DEFAULT : fallback;
    const num = typeof value === "string" ? Number(value) : value;
    return ALLOWED_WINDOW_DAYS.includes(num) ? num : def;
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

  // --- mobile chart window ---------------------------------------------------

  function readMobileWindowDays(storage) {
    return normaliseWindowDays(safeGet(storage, STORAGE_KEY));
  }

  function writeMobileWindowDays(value, storage) {
    return safeSet(storage, STORAGE_KEY, String(normaliseWindowDays(value)));
  }

  // --- desktop chart window --------------------------------------------------
  // Separate key + 180 default (issue #465). A missing / corrupt / out-of-range
  // desktop value falls back to 180, NOT 90, and writing here never touches the
  // mobile key.

  function readDesktopWindowDays(storage) {
    return normaliseWindowDays(
      safeGet(storage, DESKTOP_STORAGE_KEY),
      DESKTOP_WINDOW_DAYS_DEFAULT,
    );
  }

  function writeDesktopWindowDays(value, storage) {
    return safeSet(
      storage,
      DESKTOP_STORAGE_KEY,
      String(normaliseWindowDays(value, DESKTOP_WINDOW_DAYS_DEFAULT)),
    );
  }

  // --- transient `?window=` deep link (issues #450, #467) --------------------
  // The single shared `?window=` parser. Parsing of `?window=` is owned by
  // #450 (which mirrors `?theme=` / `?date=`); it lives here — beside
  // `normaliseWindowDays` and `ALLOWED_WINDOW_DAYS` — so the parameter is
  // implemented ONCE and both #450 and the desktop wiring (#467) consume the
  // same helper. The value is TRANSIENT: applying it must never write storage.

  // Read a transient chart-window override from a URL query string, e.g.
  // `?window=90` or `?window=180`. Returns 90 or 180 when the value is a
  // permitted window, else null (absent / blank / disallowed) so callers fall
  // back to the saved choice or device default. Mirrors theme.js's
  // preferenceFromSearch — guarded so malformed input never throws.
  function windowDaysFromSearch(search) {
    try {
      const value = new URLSearchParams(search || "").get("window");
      if (value === null) {
        return null;
      }
      const num = Number(value.trim());
      return ALLOWED_WINDOW_DAYS.includes(num) ? num : null;
    } catch (_err) {
      return null;
    }
  }

  // Resolve the effective chart window for a visit, applying the visit-only
  // precedence (issue #467): a `?window=` URL override (transient, never
  // persisted) wins over `savedWindowDays` — the already-resolved saved
  // per-device choice or device default (mobile 90 / desktop 180). An absent or
  // invalid override leaves the saved value in place. Pure: writes nothing, so
  // a URL-supplied window is honoured for the visit without persisting.
  function effectiveWindowDays(search, savedWindowDays) {
    const fromUrl = windowDaysFromSearch(search);
    return fromUrl === null ? savedWindowDays : fromUrl;
  }

  // Publish the helpers for the dashboard and the tests.
  globalThis.GRQChartWindow = {
    STORAGE_KEY,
    DESKTOP_STORAGE_KEY,
    MOBILE_WINDOW_DAYS_DEFAULT,
    DESKTOP_WINDOW_DAYS_DEFAULT,
    ALLOWED_WINDOW_DAYS,
    normaliseWindowDays,
    readMobileWindowDays,
    writeMobileWindowDays,
    readDesktopWindowDays,
    writeDesktopWindowDays,
    windowDaysFromSearch,
    effectiveWindowDays,
  };
})();
