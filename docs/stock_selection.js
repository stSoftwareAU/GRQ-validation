// Stock deep-link selection helpers (issue #281).
//
// The dashboard can be deep-linked straight into the single-stock detail view
// with a `?stock=<symbol>` query parameter, e.g.
// `index.html?stock=NASDAQ:MGRC`. This also lets the automated a11y check
// (pa11y-ci) audit the single-stock view deterministically, which the previous
// config never did (it only scanned the aggregate page).
//
// Like docs/escape.js, docs/projection.js and docs/theme.js, this file is
// loaded as a classic <script> in docs/index.html and is also imported by the
// Deno tests. It uses no module syntax, publishes its helpers on
// `globalThis.GRQStockSelection`, and touches no DOM, so it imports cleanly in
// a non-browser (test) environment.
(function () {
  "use strict";

  // Extract the requested stock symbol from a URL query string. Returns the
  // trimmed symbol, or null when the parameter is absent or blank.
  function stockFromSearch(search) {
    try {
      const value = new URLSearchParams(search || "").get("stock");
      if (value === null) {
        return null;
      }
      const trimmed = value.trim();
      return trimmed === "" ? null : trimmed;
    } catch (_err) {
      return null;
    }
  }

  // Resolve a requested symbol against the loaded score rows. Returns the
  // matching symbol (exact, case-insensitive) when present, else null so the
  // caller can fall back to the aggregate view rather than guessing. Each row
  // is expected to expose its symbol on a `.stock` property.
  function resolveStockSelection(stocks, requested) {
    if (!Array.isArray(stocks) || typeof requested !== "string") {
      return null;
    }
    const wanted = requested.trim().toLowerCase();
    if (wanted === "") {
      return null;
    }
    const match = stocks.find(
      (row) =>
        row && typeof row.stock === "string" &&
        row.stock.toLowerCase() === wanted,
    );
    return match ? match.stock : null;
  }

  globalThis.GRQStockSelection = {
    stockFromSearch,
    resolveStockSelection,
  };
})();
