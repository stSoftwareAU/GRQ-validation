// Tests for the shared exclusion + re-weighting helpers (issue #288).
//
// These import the REAL shipped helpers from docs/projection.js — the single
// source of truth for the "is this stock included?" rule, mirroring the Rust
// backend's `is_priceable` predicate (src/utils.rs). The dashboard's app.js
// aggregate and strikethrough work reuses this same tested rule.
import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import "../docs/projection.js";

const g = globalThis as unknown as {
  GRQProjection: {
    isStockIncluded: (
      buyPrice: number | null | undefined,
      currentPrice: number | null | undefined,
      splitReliable?: boolean,
    ) => boolean;
    calculateIncludedPortfolioPerformance: (
      stocks: Array<{
        buyPrice?: number | null;
        currentPrice?: number | null;
        totalDividends?: number;
      }>,
    ) => number | null;
  };
};
const GRQProjection = g.GRQProjection;

Deno.test("projection.js publishes the exclusion helpers on globalThis", () => {
  assertEquals(typeof GRQProjection.isStockIncluded, "function");
  assertEquals(
    typeof GRQProjection.calculateIncludedPortfolioPerformance,
    "function",
  );
});

// --- isStockIncluded: the single inclusion predicate -----------------------

Deno.test("isStockIncluded - both prices present and positive -> included", () => {
  assert(GRQProjection.isStockIncluded(10.5, 12.0));
});

Deno.test("isStockIncluded - missing buy price -> excluded", () => {
  assertEquals(GRQProjection.isStockIncluded(null, 12.0), false);
  assertEquals(GRQProjection.isStockIncluded(undefined, 12.0), false);
  assertEquals(GRQProjection.isStockIncluded(0, 12.0), false);
});

Deno.test("isStockIncluded - missing current price -> excluded", () => {
  assertEquals(GRQProjection.isStockIncluded(10.5, null), false);
  assertEquals(GRQProjection.isStockIncluded(10.5, undefined), false);
  assertEquals(GRQProjection.isStockIncluded(10.5, 0), false);
});

Deno.test("isStockIncluded - both missing -> excluded", () => {
  assertEquals(GRQProjection.isStockIncluded(null, null), false);
  assertEquals(GRQProjection.isStockIncluded(undefined, undefined), false);
  assertEquals(GRQProjection.isStockIncluded(0, 0), false);
});

Deno.test("isStockIncluded - split-unreliable -> excluded even with both prices", () => {
  assertEquals(GRQProjection.isStockIncluded(10.5, 12.0, false), false);
  assertEquals(GRQProjection.isStockIncluded(10.5, 12.0, true), true);
  assert(GRQProjection.isStockIncluded(10.5, 12.0));
});

Deno.test("isStockIncluded - negative prices -> excluded", () => {
  assertEquals(GRQProjection.isStockIncluded(-1, 12.0), false);
  assertEquals(GRQProjection.isStockIncluded(10.5, -1), false);
});

Deno.test("isStockIncluded - non-numeric prices -> excluded", () => {
  assertEquals(
    GRQProjection.isStockIncluded(
      "10" as unknown as number,
      12.0,
    ),
    false,
  );
  assertEquals(GRQProjection.isStockIncluded(NaN, 12.0), false);
});

// --- calculateIncludedPortfolioPerformance: equal-weight re-weighting ------

Deno.test("re-weighting - averages returns over included stocks only", () => {
  // Two included stocks: +10% and +20% -> equal-weight average +15%.
  const stocks = [
    { buyPrice: 100, currentPrice: 110 }, // +10%
    { buyPrice: 100, currentPrice: 120 }, // +20%
  ];
  const perf = GRQProjection.calculateIncludedPortfolioPerformance(stocks);
  assert(perf !== null);
  assertAlmostEquals(perf as number, 15);
});

Deno.test("re-weighting - excluding one redistributes weight over the remainder", () => {
  // Three stocks but the middle one has no current price (delisted/merged).
  // It must be dropped entirely: the result is the equal-weight average of
  // the two priceable stocks (1/2 each), NOT 1/3 each over all three.
  const stocks = [
    { buyPrice: 100, currentPrice: 110 }, // +10% included
    { buyPrice: 100, currentPrice: null }, // excluded (no current price)
    { buyPrice: 100, currentPrice: 130 }, // +30% included
  ];
  const perf = GRQProjection.calculateIncludedPortfolioPerformance(stocks);
  assert(perf !== null);
  // Average of the two included stocks = (10 + 30) / 2 = 20.
  assertAlmostEquals(perf as number, 20);
});

Deno.test("re-weighting - includes dividend return for included stocks", () => {
  // Single included stock: +10% price return + 5% dividend return = 15%.
  const stocks = [
    { buyPrice: 100, currentPrice: 110, totalDividends: 5 },
  ];
  const perf = GRQProjection.calculateIncludedPortfolioPerformance(stocks);
  assert(perf !== null);
  assertAlmostEquals(perf as number, 15);
});

Deno.test("re-weighting - all stocks excluded -> null", () => {
  const stocks = [
    { buyPrice: 0, currentPrice: 110 },
    { buyPrice: 100, currentPrice: null },
  ];
  assertEquals(
    GRQProjection.calculateIncludedPortfolioPerformance(stocks),
    null,
  );
});

Deno.test("re-weighting - empty or invalid input -> null", () => {
  assertEquals(GRQProjection.calculateIncludedPortfolioPerformance([]), null);
  assertEquals(
    GRQProjection.calculateIncludedPortfolioPerformance(
      null as unknown as [],
    ),
    null,
  );
});
