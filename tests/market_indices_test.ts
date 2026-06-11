// Benchmark-index data tests (issue #93).
//
// The dashboard previously fetched S&P 500 / NASDAQ / Russell 2000 data at
// runtime through untrusted public CORS proxies. It now reads a first-party
// same-origin file, docs/market-indices.json, and shapes it through the shared
// kernel GRQProjection.buildIndexSeriesFromMap. These tests exercise that REAL
// kernel and the REAL committed data file, plus the pure helpers in the
// server-side fetcher that produces the file.

import { assert, assertEquals } from "@std/assert";
import "../docs/projection.js";
import { toPriceMap, toUnixSeconds } from "../scripts/fetch_market_indices.ts";

interface IndexSeries {
  name: string;
  data: Array<{ date: Date; close: number }>;
  initialPrice: number | null;
  currentPrice: number | null;
}

const g = globalThis as unknown as {
  GRQProjection: {
    buildIndexSeriesFromMap: (
      priceMap: Record<string, number> | null,
      indexName: string,
      startDate: Date | string,
      endDate: Date | string,
    ) => IndexSeries | null;
  };
};

const build = g.GRQProjection.buildIndexSeriesFromMap;

Deno.test("buildIndexSeriesFromMap - happy path builds an ordered series", () => {
  const map = {
    "2025-01-03": 30,
    "2025-01-01": 10,
    "2025-01-02": 20,
  };
  const series = build(map, "SP500", "2025-01-01", "2025-01-31");
  assert(series);
  assertEquals(series.name, "SP500");
  assertEquals(series.data.length, 3);
  // Sorted ascending by date regardless of map insertion order.
  assertEquals(series.data.map((p) => p.close), [10, 20, 30]);
  assertEquals(series.initialPrice, 10);
  assertEquals(series.currentPrice, 30);
});

Deno.test("buildIndexSeriesFromMap - filters to the requested date range", () => {
  const map = {
    "2024-12-31": 99, // before range
    "2025-01-02": 20,
    "2025-01-10": 25,
    "2025-02-01": 88, // after range
  };
  const series = build(map, "NASDAQ", "2025-01-01", "2025-01-31");
  assert(series);
  assertEquals(series.data.length, 2);
  assertEquals(series.initialPrice, 20);
  assertEquals(series.currentPrice, 25);
});

Deno.test("buildIndexSeriesFromMap - range boundaries are inclusive", () => {
  const map = { "2025-01-01": 5, "2025-01-31": 9 };
  const series = build(map, "Russell 2000", "2025-01-01", "2025-01-31");
  assert(series);
  assertEquals(series.data.length, 2);
});

Deno.test("buildIndexSeriesFromMap - skips null and non-finite closes", () => {
  const map = {
    "2025-01-01": 10,
    "2025-01-02": null as unknown as number,
    "2025-01-03": Infinity as unknown as number,
    "2025-01-04": "oops" as unknown as number,
    "2025-01-05": 40,
  };
  const series = build(map, "SP500", "2025-01-01", "2025-01-31");
  assert(series);
  assertEquals(series.data.length, 2);
  assertEquals(series.initialPrice, 10);
  assertEquals(series.currentPrice, 40);
});

Deno.test("buildIndexSeriesFromMap - empty/missing map yields null prices", () => {
  const empty = build({}, "SP500", "2025-01-01", "2025-01-31");
  assert(empty);
  assertEquals(empty.data.length, 0);
  assertEquals(empty.initialPrice, null);
  assertEquals(empty.currentPrice, null);

  assertEquals(build(null, "SP500", "2025-01-01", "2025-01-31"), null);
});

Deno.test("buildIndexSeriesFromMap - all-out-of-range yields no data", () => {
  const map = { "2030-01-01": 100 };
  const series = build(map, "SP500", "2025-01-01", "2025-01-31");
  assert(series);
  assertEquals(series.data.length, 0);
  assertEquals(series.initialPrice, null);
});

Deno.test("toUnixSeconds - converts an ISO date to UTC seconds", () => {
  assertEquals(toUnixSeconds("2024-01-01"), 1704067200);
});

Deno.test("toPriceMap - extracts finite closes and rounds to cents", () => {
  const payload = {
    chart: {
      result: [{
        timestamp: [1704153600, 1704240000, 1704326400],
        indicators: {
          quote: [{ close: [4742.831, null, 4688.6789] }],
        },
      }],
    },
  };
  const map = toPriceMap(payload);
  // Middle (null) close is dropped; the rest are rounded to 2dp.
  assertEquals(Object.keys(map).length, 2);
  assertEquals(map["2024-01-02"], 4742.83);
  assertEquals(map["2024-01-04"], 4688.68);
});

Deno.test("toPriceMap - empty/malformed payload yields an empty map", () => {
  assertEquals(toPriceMap({}), {});
  assertEquals(toPriceMap({ chart: { result: [] } }), {});
});

Deno.test("docs/market-indices.json is same-origin, well-formed benchmark data", async () => {
  const text = await Deno.readTextFile("docs/market-indices.json");
  const data = JSON.parse(text) as Record<string, Record<string, number>>;

  for (const key of ["sp500", "nasdaq", "russell2000"]) {
    assert(key in data, `market-indices.json must contain '${key}'`);
    const entries = Object.entries(data[key]);
    assert(entries.length > 0, `${key} must have at least one data point`);
    // Every value is a finite number keyed by an ISO date.
    for (const [date, close] of entries) {
      assert(/^\d{4}-\d{2}-\d{2}$/.test(date), `bad date key '${date}'`);
      assert(typeof close === "number" && Number.isFinite(close));
    }
  }
});

Deno.test("committed benchmark data flows through the dashboard kernel", async () => {
  const data = JSON.parse(
    await Deno.readTextFile("docs/market-indices.json"),
  ) as Record<string, Record<string, number>>;

  const series = build(data.sp500, "SP500", "2024-01-01", "2030-01-01");
  assert(series);
  assert(series.data.length > 0);
  assert(typeof series.initialPrice === "number");
  assert(typeof series.currentPrice === "number");
});
