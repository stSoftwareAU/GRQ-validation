// Behavioural tests for the stock deep-link helpers (issue #281).
//
// These import the REAL shipped helpers from docs/stock_selection.js — the same
// pure functions the dashboard uses to honour a `?stock=<symbol>` URL parameter
// and render the single-stock detail view directly. The module publishes its
// helpers on globalThis and touches no DOM, so it imports cleanly under Deno.
import { assert, assertEquals } from "@std/assert";
import "../docs/stock_selection.js";

const g = globalThis as unknown as {
  GRQStockSelection: {
    stockFromSearch: (search: unknown) => string | null;
    resolveStockSelection: (
      stocks: unknown,
      requested: unknown,
    ) => string | null;
    searchWithStock: (search: unknown, stock: unknown) => string;
  };
};
const GRQStockSelection = g.GRQStockSelection;

Deno.test("GRQStockSelection is published on globalThis", () => {
  assert(
    GRQStockSelection,
    "stock_selection.js should publish globalThis.GRQStockSelection",
  );
});

Deno.test("stockFromSearch extracts the requested symbol", () => {
  assertEquals(
    GRQStockSelection.stockFromSearch("?stock=NASDAQ:MGRC"),
    "NASDAQ:MGRC",
  );
  // Works alongside other params and tolerates URL-encoded colons.
  assertEquals(
    GRQStockSelection.stockFromSearch(
      "?file=2026%2FMarch%2F23.tsv&stock=NYSE%3ADD",
    ),
    "NYSE:DD",
  );
  assertEquals(GRQStockSelection.stockFromSearch("stock=AAA"), "AAA");
  // Surrounding whitespace is trimmed.
  assertEquals(GRQStockSelection.stockFromSearch("?stock=%20AAA%20"), "AAA");
});

Deno.test("stockFromSearch returns null when absent or blank", () => {
  assertEquals(GRQStockSelection.stockFromSearch(""), null);
  assertEquals(GRQStockSelection.stockFromSearch("?file=x.tsv"), null);
  assertEquals(GRQStockSelection.stockFromSearch("?stock="), null);
  assertEquals(GRQStockSelection.stockFromSearch("?stock=%20%20"), null);
  assertEquals(GRQStockSelection.stockFromSearch(null), null);
  assertEquals(GRQStockSelection.stockFromSearch(undefined), null);
});

Deno.test("resolveStockSelection returns the matching symbol when present", () => {
  const stocks = [
    { stock: "NASDAQ:MGRC" },
    { stock: "NYSE:DD" },
    { stock: "NYSE:ELME" },
  ];
  assertEquals(
    GRQStockSelection.resolveStockSelection(stocks, "NYSE:DD"),
    "NYSE:DD",
  );
  // Match is case-insensitive but returns the canonical (file) casing.
  assertEquals(
    GRQStockSelection.resolveStockSelection(stocks, "nasdaq:mgrc"),
    "NASDAQ:MGRC",
  );
});

Deno.test("resolveStockSelection returns null for an unknown or invalid request", () => {
  const stocks = [{ stock: "NASDAQ:MGRC" }];
  // Unknown symbol -> null so the caller leaves the aggregate view untouched.
  assertEquals(
    GRQStockSelection.resolveStockSelection(stocks, "NYSE:XYZ"),
    null,
  );
  assertEquals(GRQStockSelection.resolveStockSelection(stocks, ""), null);
  assertEquals(GRQStockSelection.resolveStockSelection(stocks, "   "), null);
  // Defensive: non-array stocks / non-string request never throw.
  assertEquals(GRQStockSelection.resolveStockSelection(null, "AAA"), null);
  assertEquals(GRQStockSelection.resolveStockSelection([], "AAA"), null);
  assertEquals(
    GRQStockSelection.resolveStockSelection([{ stock: "AAA" }], null),
    null,
  );
});

Deno.test("searchWithStock writes ?stock= and preserves other params", () => {
  // Drill-down: write the selected stock, keeping the existing ?date= (#517).
  assertEquals(
    GRQStockSelection.searchWithStock("?date=2026-03-23", "NASDAQ:MGRC"),
    "date=2026-03-23&stock=NASDAQ%3AMGRC",
  );
  // No prior params -> just the stock param.
  assertEquals(
    GRQStockSelection.searchWithStock("", "NYSE:DD"),
    "stock=NYSE%3ADD",
  );
  // An existing stock value is replaced, not duplicated.
  assertEquals(
    GRQStockSelection.searchWithStock("?stock=OLD&date=2026-03-23", "NEW"),
    "stock=NEW&date=2026-03-23",
  );
  // Surrounding whitespace is trimmed before writing.
  assertEquals(
    GRQStockSelection.searchWithStock("", "  AAA  "),
    "stock=AAA",
  );
});

Deno.test("searchWithStock strips ?stock= when the stock is blank or missing", () => {
  // Back to aggregate: drop the stock but keep the day's ?date= (#517).
  assertEquals(
    GRQStockSelection.searchWithStock("?date=2026-03-23&stock=NYSE:DD", null),
    "date=2026-03-23",
  );
  assertEquals(
    GRQStockSelection.searchWithStock("?stock=NYSE:DD", ""),
    "",
  );
  assertEquals(
    GRQStockSelection.searchWithStock("?stock=NYSE:DD", "   "),
    "",
  );
  // Non-string stock values strip rather than throw.
  assertEquals(
    GRQStockSelection.searchWithStock("?stock=NYSE:DD&date=2026-03-23", 123),
    "date=2026-03-23",
  );
});
