// WHAT-tests for the benchmark-index data-extraction path (issue #279, part of
// milestone #269 item F).
//
// docs/market_index.js holds the PURE logic that turns the locally-loaded
// market-index data (`this.marketIndexData`, sourced same-origin from
// docs/market-indices.json) into the SP500 / NASDAQ / Russell 2000 performance
// figures shown on BOTH the aggregate and single-stock views. The browser
// dashboard's updateMarketComparison()/getMarketPerformanceData() (in
// docs/app.js) are thin wrappers around these helpers, so these tests exercise
// the REAL shipped extraction logic rather than a copy.
//
// Acceptance criteria covered:
//   - the index numbers are derived only from the supplied local data (no fetch);
//   - a missing/partial index yields no figure (rendered blank, not an error);
//   - null/undefined input is tolerated (empty result, never throws).
import { assert, assertEquals } from "@std/assert";
import "../docs/market_index.js";

const g = globalThis as unknown as {
  GRQMarketIndex: {
    BENCHMARK_INDICES: Array<{ key: string; name: string }>;
    indexPerformance: (
      indexData: unknown,
    ) =>
      | { performance: number; initialPrice: number; currentPrice: number }
      | null;
    marketPerformanceData: (
      marketIndexData: unknown,
    ) => Record<
      string,
      { performance: number; initialPrice: number; currentPrice: number }
    >;
  };
};
const GRQMarketIndex = g.GRQMarketIndex;

Deno.test("market_index.js publishes the helpers on globalThis", () => {
  assertEquals(typeof GRQMarketIndex.indexPerformance, "function");
  assertEquals(typeof GRQMarketIndex.marketPerformanceData, "function");
  assertEquals(GRQMarketIndex.BENCHMARK_INDICES.map((i) => i.key), [
    "sp500",
    "nasdaq",
    "russell2000",
  ]);
});

Deno.test("indexPerformance - computes percent change from initial to current", () => {
  const perf = GRQMarketIndex.indexPerformance({
    initialPrice: 4000,
    currentPrice: 4400,
  });
  assert(perf !== null);
  assertEquals(perf.performance, 10);
  assertEquals(perf.initialPrice, 4000);
  assertEquals(perf.currentPrice, 4400);
});

Deno.test("indexPerformance - handles a negative move", () => {
  const perf = GRQMarketIndex.indexPerformance({
    initialPrice: 2000,
    currentPrice: 1800,
  });
  assert(perf !== null);
  assertEquals(perf.performance, -10);
});

Deno.test("indexPerformance - missing prices yield null (render blank, no error)", () => {
  assertEquals(GRQMarketIndex.indexPerformance(null), null);
  assertEquals(GRQMarketIndex.indexPerformance(undefined), null);
  assertEquals(GRQMarketIndex.indexPerformance({}), null);
  assertEquals(GRQMarketIndex.indexPerformance({ initialPrice: 4000 }), null);
  assertEquals(GRQMarketIndex.indexPerformance({ currentPrice: 4400 }), null);
});

Deno.test("marketPerformanceData - extracts all three indices from local data", () => {
  // Shaped exactly as docs/app.js loadMarketIndexData() builds this.marketIndexData.
  const marketIndexData = {
    sp500: { initialPrice: 4000, currentPrice: 4200, data: [] },
    nasdaq: { initialPrice: 12000, currentPrice: 12600, data: [] },
    russell2000: { initialPrice: 2000, currentPrice: 1900, data: [] },
  };
  const result = GRQMarketIndex.marketPerformanceData(marketIndexData);
  assertEquals(Object.keys(result).sort(), [
    "nasdaq",
    "russell2000",
    "sp500",
  ]);
  assertEquals(result.sp500.performance, 5);
  assertEquals(result.nasdaq.performance, 5);
  assertEquals(result.russell2000.performance, -5);
});

Deno.test("marketPerformanceData - omits an index whose prices are absent", () => {
  const marketIndexData = {
    sp500: { initialPrice: 4000, currentPrice: 4200 },
    // nasdaq absent entirely
    russell2000: { initialPrice: 0, currentPrice: 0 }, // unusable -> omitted
  };
  const result = GRQMarketIndex.marketPerformanceData(marketIndexData);
  assertEquals(Object.keys(result), ["sp500"]);
  assert(!("nasdaq" in result));
  assert(!("russell2000" in result));
});

Deno.test("marketPerformanceData - null/undefined input returns an empty object", () => {
  assertEquals(GRQMarketIndex.marketPerformanceData(null), {});
  assertEquals(GRQMarketIndex.marketPerformanceData(undefined), {});
  assertEquals(GRQMarketIndex.marketPerformanceData({}), {});
});
