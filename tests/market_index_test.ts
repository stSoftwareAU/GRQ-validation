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
import "../docs/projection.js";
import "../docs/market_index.js";

const g = globalThis as unknown as {
  GRQMarketIndex: {
    BENCHMARK_INDICES: Array<{ key: string; name: string }>;
    indexPerformance: (
      indexData: unknown,
      endDate?: unknown,
    ) =>
      | { performance: number; initialPrice: number; currentPrice: number }
      | null;
    priceAsOf: (seriesOrPoints: unknown, endDate: unknown) => number | null;
    marketPerformanceData: (
      marketIndexData: unknown,
    ) => Record<
      string,
      { performance: number; initialPrice: number; currentPrice: number }
    >;
  };
  GRQProjection: {
    buildIndexSeriesFromMap: (
      priceMap: unknown,
      indexName: string,
      startDate: unknown,
      endDate: unknown,
    ) => {
      name: string;
      data: Array<{ date: Date; close: number }>;
      initialPrice: number | null;
      currentPrice: number | null;
    } | null;
  };
};
const GRQMarketIndex = g.GRQMarketIndex;
const GRQProjection = g.GRQProjection;

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

// --- Bounded-window price resolution (issue #366) --------------------------
//
// A synthetic SP500-shaped {date: close} map covering the score window. The
// midpoint (2024-02-01) is a DIP: a window ending then must read a lower price
// than the latest (2024-03-01) value — the exact shape behind #333 where the
// chart (windowed) and the summary (run-to-today) disagreed.
const PRICE_MAP = {
  "2024-01-01": 4000, // score-date baseline (initialPrice)
  "2024-02-01": 3600, // mid-window dip
  "2024-03-01": 4400, // latest available price
};
const SERIES = GRQProjection.buildIndexSeriesFromMap(
  PRICE_MAP,
  "SP500",
  "2024-01-01",
  "2024-03-01",
)!;

Deno.test("priceAsOf - end date between two points returns the last close <= endDate", () => {
  // 2024-02-15 is after the dip (02-01) but before the latest (03-01).
  assertEquals(GRQMarketIndex.priceAsOf(SERIES, "2024-02-15"), 3600);
});

Deno.test("priceAsOf - end date exactly on a point returns that point's close", () => {
  assertEquals(GRQMarketIndex.priceAsOf(SERIES, "2024-02-01"), 3600);
});

Deno.test("priceAsOf - end date before the first point returns null", () => {
  assertEquals(GRQMarketIndex.priceAsOf(SERIES, "2023-12-31"), null);
});

Deno.test("priceAsOf - end date on the last point equals the full-period currentPrice", () => {
  // Regression-safety: the windowed end price at the latest date must equal the
  // current full-period currentPrice computed by buildIndexSeriesFromMap.
  assertEquals(GRQMarketIndex.priceAsOf(SERIES, "2024-03-01"), 4400);
  assertEquals(
    GRQMarketIndex.priceAsOf(SERIES, "2024-03-01"),
    SERIES.currentPrice,
  );
});

Deno.test("priceAsOf - accepts a bare {date, close} points array", () => {
  assertEquals(GRQMarketIndex.priceAsOf(SERIES.data, "2024-02-15"), 3600);
});

Deno.test("priceAsOf - tolerant of empty/missing inputs, never throws", () => {
  assertEquals(GRQMarketIndex.priceAsOf(null, "2024-02-15"), null);
  assertEquals(GRQMarketIndex.priceAsOf(undefined, "2024-02-15"), null);
  assertEquals(GRQMarketIndex.priceAsOf([], "2024-02-15"), null);
  assertEquals(GRQMarketIndex.priceAsOf({ data: [] }, "2024-02-15"), null);
  assertEquals(GRQMarketIndex.priceAsOf(SERIES, "not-a-date"), null);
  assertEquals(GRQMarketIndex.priceAsOf(SERIES, null), null);
});

Deno.test("indexPerformance - end date inside the dip yields a lower figure than the latest (the #333 shape)", () => {
  const indexData = {
    initialPrice: SERIES.initialPrice,
    currentPrice: SERIES.currentPrice,
    data: SERIES.data,
  };
  // Windowed to the dip: ((3600 - 4000) / 4000) * 100 = -10%.
  const windowed = GRQMarketIndex.indexPerformance(indexData, "2024-02-15");
  assert(windowed !== null);
  assertEquals(windowed.performance, -10);
  assertEquals(windowed.currentPrice, 3600);
  assertEquals(windowed.initialPrice, 4000);

  // Full period (run to latest): ((4400 - 4000) / 4000) * 100 = +10%.
  const full = GRQMarketIndex.indexPerformance(indexData);
  assert(full !== null);
  assertEquals(full.performance, 10);
  assert(windowed.performance < full.performance);
});

Deno.test("indexPerformance - end date on the last point equals the full-period result (no regression)", () => {
  const indexData = {
    initialPrice: SERIES.initialPrice,
    currentPrice: SERIES.currentPrice,
    data: SERIES.data,
  };
  const windowed = GRQMarketIndex.indexPerformance(indexData, "2024-03-01");
  const full = GRQMarketIndex.indexPerformance(indexData);
  assertEquals(windowed, full);
});

Deno.test("indexPerformance - end date before all data yields null (render blank, no throw)", () => {
  const indexData = {
    initialPrice: SERIES.initialPrice,
    currentPrice: SERIES.currentPrice,
    data: SERIES.data,
  };
  assertEquals(GRQMarketIndex.indexPerformance(indexData, "2023-12-31"), null);
});

Deno.test("indexPerformance - omitting endDate preserves the existing full-period behaviour", () => {
  // No endDate argument: identical to the pre-#366 signature.
  const perf = GRQMarketIndex.indexPerformance({
    initialPrice: 4000,
    currentPrice: 4400,
  });
  assert(perf !== null);
  assertEquals(perf.performance, 10);
  assertEquals(perf.currentPrice, 4400);
});
