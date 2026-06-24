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

  // Reverse of resolveDateSelection: given the loaded score index and a selected
  // score-file path, return that file's canonical YYYY-MM-DD date, or null when
  // the file is unknown. Used to mirror the dropdown selection into the
  // dashboard URL (issue #517). Each entry is expected to expose a `.file` path
  // and a `.date` (YYYY-MM-DD).
  function dateForFile(scores, file) {
    if (!Array.isArray(scores) || typeof file !== "string" || file === "") {
      return null;
    }
    const match = scores.find((row) => row && row.file === file);
    return match && typeof match.date === "string"
      ? normaliseDate(match.date)
      : null;
  }

  // Build a query string (no leading "?") that carries the selected score date,
  // for the dashboard's OWN URL (issue #517). The `date` param is set to the
  // normalised value and the `file` param is removed — the loader resolves
  // `?file=` before `?date=`, so a stale file would otherwise win on reload.
  // Every other param is preserved. An invalid/missing date leaves `date`
  // untouched so the caller can choose not to write the URL.
  function searchWithDate(search, date) {
    const params = new URLSearchParams(search || "");
    const norm = normaliseDate(date);
    if (norm === null) {
      return params.toString();
    }
    params.set("date", norm);
    params.delete("file");
    return params.toString();
  }

  // Build a navigation href carrying the selected date, e.g.
  // linkWithDate("trend.html", "2026-03-25") → "trend.html?date=2026-03-25".
  // Used for the dashboard's "📈 Prediction Trend" link and the Trend page's
  // "← Dashboard" link so the chosen date survives the round trip (issue #517).
  // Any existing query params (with `date` replaced) and hash on `base` are
  // preserved; an invalid/missing date returns `base` unchanged so the link
  // stays the plain page (the Trend page must not depend on the date).
  function linkWithDate(base, date) {
    const raw = base == null ? "" : String(base);
    const hashIndex = raw.indexOf("#");
    const hash = hashIndex >= 0 ? raw.slice(hashIndex) : "";
    const withoutHash = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw;
    const queryIndex = withoutHash.indexOf("?");
    const path = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
    const search = queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : "";
    const params = new URLSearchParams(search);
    const norm = normaliseDate(date);
    if (norm !== null) {
      params.set("date", norm);
    }
    const query = params.toString();
    return query ? `${path}?${query}${hash}` : `${path}${hash}`;
  }

  globalThis.GRQDateSelection = {
    dateFromSearch,
    resolveDateSelection,
    dateForFile,
    searchWithDate,
    linkWithDate,
  };
})();
