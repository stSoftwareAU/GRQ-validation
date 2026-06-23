// Date deep-link selection helpers (issue #436).
//
// The dashboard can be deep-linked to a specific score date with a
// `?date=<YYYY-MM-DD>` query parameter, e.g. `index.html?date=2026-03-23`.
// This is friendlier than the existing `?file=` parameter, which needs the
// URL-encoded score-file path (`?file=2026%2FMarch%2F23.tsv`).
//
// Like docs/escape.js, docs/projection.js, docs/theme.js and
// docs/stock_selection.js, this file is loaded as a classic <script> in
// docs/index.html and is also imported by the Deno tests. It uses no module
// syntax, publishes its helpers on `globalThis.GRQDateSelection`, and touches
// no DOM, so it imports cleanly in a non-browser (test) environment.
(function () {
  "use strict";

  // Extract the requested date from a URL query string. Returns the trimmed
  // raw value, or null when the parameter is absent or blank.
  function dateFromSearch(search) {
    try {
      const value = new URLSearchParams(search || "").get("date");
      if (value === null) {
        return null;
      }
      const trimmed = value.trim();
      return trimmed === "" ? null : trimmed;
    } catch (_err) {
      return null;
    }
  }

  // Normalise a date string to canonical YYYY-MM-DD, accepting unpadded month
  // and day (e.g. 2026-3-3). Returns null when the value is not a plausible
  // calendar date, so callers fall back rather than guessing.
  function normaliseDate(value) {
    if (typeof value !== "string") {
      return null;
    }
    const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value.trim());
    if (!match) {
      return null;
    }
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      return null;
    }
    const mm = String(month).padStart(2, "0");
    const dd = String(day).padStart(2, "0");
    return `${match[1]}-${mm}-${dd}`;
  }

  // Resolve a requested date against the loaded score index. Returns the
  // matching score file path when a score has that date, else null so the
  // caller can fall back to the default selection. Each entry is expected to
  // expose a `.date` (YYYY-MM-DD) and a `.file` (path) property.
  function resolveDateSelection(scores, requested) {
    if (!Array.isArray(scores)) {
      return null;
    }
    const wanted = normaliseDate(requested);
    if (wanted === null) {
      return null;
    }
    const match = scores.find(
      (row) =>
        row && typeof row.date === "string" &&
        normaliseDate(row.date) === wanted,
    );
    return match && typeof match.file === "string" ? match.file : null;
  }

  globalThis.GRQDateSelection = {
    dateFromSearch,
    resolveDateSelection,
  };
})();
