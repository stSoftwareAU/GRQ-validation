// Transient grouping deep-link for the Prediction Trend view (issue #481, part
// of milestone #450 — URL parameters for more dashboard state).
//
// Adds a visit-only `?group=day|week|month|quarter` deep-link that overrides
// the trend grouping granularity for the current page load, mirroring the
// `?theme=` (docs/theme.js) transient-override model. The override is read on
// page load only (one-way), takes precedence over the saved
// `grq.trend.grouping` choice, and is NEVER persisted to localStorage.
//
// Like docs/theme.js, docs/view_selection.js and docs/trend_settings.js this
// file is loaded as a classic <script> and is also imported by the Deno tests.
// It uses no module syntax, publishes its helpers on
// globalThis.GRQTrendGroupingLink, and touches no DOM, so it imports cleanly in
// a non-browser (test) environment. It reuses GRQTrendSettings.GRANULARITIES /
// normaliseGrouping as the single source of truth for what counts as a valid
// granularity (resolved lazily so script load order does not matter).
(function () {
  "use strict";

  // The trend settings module, when it has loaded — our source of truth for
  // the granularities and the default grouping. Resolved lazily so this file
  // parses and the helpers work regardless of <script> ordering.
  function settings() {
    return globalThis.GRQTrendSettings || null;
  }

  // Pure: extract a valid grouping granularity from a URL query string, e.g.
  // `?group=week`. Returns the granularity ("day"/"week"/"month"/"quarter") or
  // null when the parameter is absent, blank or unrecognised — so callers fall
  // back to the saved/default grouping rather than guessing.
  function groupingFromSearch(search) {
    try {
      const raw = new URLSearchParams(search || "").get("group");
      if (raw === null) {
        return null;
      }
      const value = raw.trim();
      if (value === "") {
        return null;
      }
      const s = settings();
      const granularities = (s && s.GRANULARITIES) ||
        ["day", "week", "month", "quarter"];
      return granularities.includes(value) ? value : null;
    } catch (_err) {
      return null;
    }
  }

  // The grouping that should apply for this visit: a valid `?group=` override
  // wins (visit-only, never persisted); otherwise the saved/default grouping
  // stands, normalised so a corrupt saved value falls back to the month
  // default. Mirrors GRQChartWindow.effectiveWindowDays.
  function effectiveGrouping(search, savedGrouping) {
    const override = groupingFromSearch(search);
    if (override !== null) {
      return override;
    }
    const s = settings();
    return s ? s.normaliseGrouping(savedGrouping) : savedGrouping;
  }

  // Publish the pure helpers for the Trend view and the tests.
  globalThis.GRQTrendGroupingLink = {
    groupingFromSearch,
    effectiveGrouping,
  };
})();
