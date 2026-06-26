// Behavioural tests for the Yahoo Finance quote-link helpers (issue #570).
//
// The single-stock detail view carries a low-prominence external link that lets
// the user confirm our numbers against Yahoo Finance. Symbols are stored as
// `EXCHANGE:TICKER` (e.g. `NASDAQ:UCTT`) but Yahoo's quote URL uses the bare
// ticker, so these helpers strip the exchange prefix and build the AU Yahoo
// quote URL. The module publishes its helpers on globalThis and touches no DOM,
// so it imports cleanly under Deno.
import { assert, assertEquals } from "@std/assert";
import "../docs/yahoo_finance.js";

const g = globalThis as unknown as {
  GRQYahooFinance: {
    tickerFromSymbol: (symbol: unknown) => string | null;
    yahooQuoteUrl: (symbol: unknown) => string | null;
  };
};
const GRQYahooFinance = g.GRQYahooFinance;

Deno.test("GRQYahooFinance is published on globalThis", () => {
  assert(
    GRQYahooFinance,
    "yahoo_finance.js should publish globalThis.GRQYahooFinance",
  );
});

Deno.test("tickerFromSymbol drops the EXCHANGE: prefix", () => {
  assertEquals(GRQYahooFinance.tickerFromSymbol("NASDAQ:UCTT"), "UCTT");
  assertEquals(GRQYahooFinance.tickerFromSymbol("NYSE:RBC"), "RBC");
  // A bare ticker (no colon) is already usable.
  assertEquals(GRQYahooFinance.tickerFromSymbol("UCTT"), "UCTT");
  // Surrounding whitespace is trimmed.
  assertEquals(GRQYahooFinance.tickerFromSymbol("  NASDAQ:UCTT  "), "UCTT");
});

Deno.test("tickerFromSymbol returns null for unusable input", () => {
  assertEquals(GRQYahooFinance.tickerFromSymbol(""), null);
  assertEquals(GRQYahooFinance.tickerFromSymbol("   "), null);
  // A trailing colon leaves no ticker.
  assertEquals(GRQYahooFinance.tickerFromSymbol("NASDAQ:"), null);
  assertEquals(GRQYahooFinance.tickerFromSymbol(null), null);
  assertEquals(GRQYahooFinance.tickerFromSymbol(undefined), null);
  assertEquals(GRQYahooFinance.tickerFromSymbol(123), null);
});

Deno.test("yahooQuoteUrl builds the AU Yahoo Finance quote URL from the bare ticker", () => {
  assertEquals(
    GRQYahooFinance.yahooQuoteUrl("NASDAQ:UCTT"),
    "https://au.finance.yahoo.com/quote/UCTT/",
  );
  assertEquals(
    GRQYahooFinance.yahooQuoteUrl("NYSE:RBC"),
    "https://au.finance.yahoo.com/quote/RBC/",
  );
  // Matches the example from the issue exactly.
  assertEquals(
    GRQYahooFinance.yahooQuoteUrl("UCTT"),
    "https://au.finance.yahoo.com/quote/UCTT/",
  );
});

Deno.test("yahooQuoteUrl returns null when no ticker can be derived", () => {
  assertEquals(GRQYahooFinance.yahooQuoteUrl(""), null);
  assertEquals(GRQYahooFinance.yahooQuoteUrl("NASDAQ:"), null);
  assertEquals(GRQYahooFinance.yahooQuoteUrl(null), null);
});

Deno.test("yahooQuoteUrl percent-encodes an unusual ticker so the URL is safe", () => {
  // Defence in depth: a ticker with a URL-significant character must not break
  // out of the path segment.
  assertEquals(
    GRQYahooFinance.yahooQuoteUrl("NASDAQ:A B"),
    "https://au.finance.yahoo.com/quote/A%20B/",
  );
});
