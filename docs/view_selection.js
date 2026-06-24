// View deep-link selection helpers (issue #479).
//
// The dashboard can be deep-linked to a specific top-level view with a
// `?view=portfolio|trend` query parameter:
//   - `index.html?view=trend`     → the Prediction Trend page (trend.html).
//   - `index.html?view=portfolio` → the default aggregate ("portfolio") view.
// The Trend view is the SEPARATE page docs/trend.html (reached via the
// `#trendViewLink` nav anchor), not an in-page toggle, so `?view=trend` on
// index.html routes to trend.html; for symmetry `trend.html?view=portfolio`
// routes back. Single-stock detail is already reachable via `?stock=`, so
// `?view=` does not duplicate it.
//
// Mirrors the precedence model of `?theme=` (issue #233): read on page load
// only (one-way), applies for the current load, and never writes localStorage.
//
// Like docs/escape.js, docs/projection.js, docs/theme.js,
// docs/stock_selection.js and docs/date_selection.js, this file is loaded as a
// classic <script> in docs/index.html and is also imported by the Deno tests.
// It uses no module syntax, publishes its helpers on
// `globalThis.GRQViewSelection`, and touches no DOM, so it imports cleanly in a
// non-browser (test) environment.
(function () {
  "use strict";

  const VALID_VIEWS = ["portfolio", "trend"];

  // Extract the requested view from a URL query string. Returns "portfolio" or
  // "trend" (lower-cased, trimmed), or null when the parameter is absent,
  // blank or unrecognised — so callers fall back to the current default rather
  // than guessing.
  function viewFromSearch(search) {
    try {
      const value = new URLSearchParams(search || "").get("view");
      if (value === null) {
        return null;
      }
      const normalised = value.trim().toLowerCase();
      return VALID_VIEWS.includes(normalised) ? normalised : null;
    } catch (_err) {
      return null;
    }
  }

  // Identify the current top-level page from a URL pathname. Returns "trend"
  // for the Prediction Trend page (trend.html), else "index" (the aggregate
  // portfolio page, which is also the default for "/" and unknown paths).
  function currentPageFromPath(pathname) {
    const path = typeof pathname === "string" ? pathname.toLowerCase() : "";
    return path.endsWith("trend.html") ? "trend" : "index";
  }

  // Resolve a `?view=` request for the current page into the page to navigate
  // to. Returns "trend.html" or "index.html" when a redirect is required, or
  // null when the view is absent/invalid or already matches the current page
  // (so no navigation happens). Pure: performs no navigation itself.
  function viewRedirectTarget(pathname, search) {
    const requested = viewFromSearch(search);
    if (requested === null) {
      return null;
    }
    const current = currentPageFromPath(pathname);
    if (requested === "trend" && current !== "trend") {
      return "trend.html";
    }
    if (requested === "portfolio" && current !== "index") {
      return "index.html";
    }
    return null;
  }

  globalThis.GRQViewSelection = {
    viewFromSearch,
    currentPageFromPath,
    viewRedirectTarget,
  };
})();
