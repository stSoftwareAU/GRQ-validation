// Yahoo Finance quote-link helpers (issue #570).
//
// The single-stock detail view carries a low-prominence "confirm our numbers
// against Yahoo Finance" link at the very bottom — the lowest-priority item on
// the view. Symbols are stored as `EXCHANGE:TICKER` (e.g. `NASDAQ:UCTT`) but
// Yahoo's quote URL uses the bare ticker, so this module strips the exchange
// prefix and builds the AU Yahoo Finance quote URL
// (https://au.finance.yahoo.com/quote/UCTT/).
//
// Like docs/stock_selection.js, this file is loaded as a classic <script> in
// docs/index.html and is also imported by the Deno tests. It uses no module
// syntax, publishes its helpers on globalThis.GRQYahooFinance, and touches no
// DOM, so it imports cleanly in a non-browser (test) environment.
(function () {
  "use strict";

  const YAHOO_QUOTE_BASE = "https://au.finance.yahoo.com/quote/";

  // Extract the bare ticker from an `EXCHANGE:TICKER` symbol. Returns the
  // trimmed ticker, or null when the symbol is missing/blank or has no ticker
  // after the colon. Splitting on the LAST colon keeps the part Yahoo expects
  // even if a stray namespace prefix is ever present.
  function tickerFromSymbol(symbol) {
    if (typeof symbol !== "string") {
      return null;
    }
    const trimmed = symbol.trim();
    if (trimmed === "") {
      return null;
    }
    const ticker = trimmed.slice(trimmed.lastIndexOf(":") + 1).trim();
    return ticker === "" ? null : ticker;
  }

  // Build the Yahoo Finance quote URL for a stored `EXCHANGE:TICKER` symbol.
  // Returns null when no usable ticker can be derived, so the caller can omit
  // the link rather than emit a broken one. The ticker is percent-encoded as a
  // single path segment for defence in depth.
  function yahooQuoteUrl(symbol) {
    const ticker = tickerFromSymbol(symbol);
    if (ticker === null) {
      return null;
    }
    return YAHOO_QUOTE_BASE + encodeURIComponent(ticker) + "/";
  }

  globalThis.GRQYahooFinance = {
    tickerFromSymbol,
    yahooQuoteUrl,
  };
})();
