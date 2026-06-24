// Transient `?indices=` deep-link for the Trend view's benchmark-index overlays
// (issue #480, part of milestone #450 — URL parameters for more dashboard
// state).
//
// `trend.html?indices=sp500,nasdaq,russell2000` turns the listed benchmark
// indices ON for this visit; any index NOT listed is OFF. The keys are the
// canonical index keys defined in docs/trend_settings.js (GRQTrendSettings) /
// GRQIndexOverlay.OVERLAY_INDICES: `sp500`, `nasdaq`, `russell2000`. Unknown
// keys are ignored; an ABSENT param leaves the saved/default toggles unchanged.
//
// Precedence mirrors `?theme=` (docs/theme.js) and `?view=`
// (docs/view_selection.js): the URL value wins for this visit but is NEVER
// persisted to localStorage — read on page load only, one-way.
//
// Like docs/trend_settings.js and docs/view_selection.js this file is loaded as
// a classic <script> and is also imported by the Deno tests. It uses no module
// syntax, publishes its helpers on `globalThis.GRQTrendDeepLink`, and touches no
// DOM, so it imports cleanly in a non-browser (test) environment. It reuses
// `GRQTrendSettings.normaliseToggles` (the single source of truth for the toggle
// shape) at call time, falling back to a local normaliser only when that helper
// has not loaded — so the parsed map always matches what the chart consumes.
(function () {
  "use strict";

  // The benchmark indices whose toggles a `?indices=` link can drive, reusing
  // the overlay engine's single source of truth when present, else a local
  // fallback list (so this module parses and tests independently).
  const INDEX_KEYS =
    (globalThis.GRQIndexOverlay && globalThis.GRQIndexOverlay.OVERLAY_INDICES &&
      globalThis.GRQIndexOverlay.OVERLAY_INDICES.map((i) => i.key)) ||
    ["sp500", "nasdaq", "russell2000"];

  // Coerce a (possibly partial) toggle object into a full boolean map. Delegates
  // to GRQTrendSettings.normaliseToggles when present (one source of truth) so
  // the shape matches exactly what the chart consumes; otherwise applies the
  // same all-off default locally. Unknown keys are dropped.
  function normaliseToggles(toggles) {
    if (
      globalThis.GRQTrendSettings &&
      typeof globalThis.GRQTrendSettings.normaliseToggles === "function"
    ) {
      return globalThis.GRQTrendSettings.normaliseToggles(toggles);
    }
    const source = toggles && typeof toggles === "object" ? toggles : {};
    const result = {};
    for (const key of INDEX_KEYS) {
      result[key] = key in source ? Boolean(source[key]) : false;
    }
    return result;
  }

  // Parse a transient `?indices=` override from a URL query string. Returns a
  // normalised boolean map (listed canonical keys ON, the rest OFF) when the
  // param is present, or `null` when it is ABSENT so callers fall back to the
  // saved/default toggles. Unknown / blank keys are ignored; a present-but-empty
  // value (`?indices=`) therefore turns every overlay OFF for this visit. Pure:
  // no DOM, no storage, never throws.
  function togglesFromSearch(search) {
    try {
      const value = new URLSearchParams(search || "").get("indices");
      if (value === null) {
        return null;
      }
      const source = {};
      for (const token of value.split(",")) {
        const key = token.trim().toLowerCase();
        if (key) {
          source[key] = true;
        }
      }
      return normaliseToggles(source);
    } catch (_err) {
      return null;
    }
  }

  // Resolve the toggles to apply for this visit, mirroring
  // GRQChartWindow.effectiveWindowDays: a `?indices=` URL override wins for the
  // current page load; otherwise the saved toggles are used. The result is
  // always a full normalised boolean map. Never writes storage.
  function effectiveToggles(search, savedToggles) {
    const fromUrl = togglesFromSearch(search);
    return fromUrl !== null ? fromUrl : normaliseToggles(savedToggles);
  }

  // Publish the pure helpers for the Trend view and the tests.
  globalThis.GRQTrendDeepLink = {
    INDEX_KEYS,
    togglesFromSearch,
    effectiveToggles,
  };
})();
