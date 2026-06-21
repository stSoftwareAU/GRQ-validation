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
import {
  checkDatasetSafety,
  checkIndexFreshness,
  datasetNewestDate,
  FRESHNESS_TOLERANCE_TRADING_DAYS,
  type IndexDataset,
  newestDate,
  serialiseDataset,
  toPriceMap,
  toUnixSeconds,
  tradingDayGap,
} from "../scripts/fetch_market_indices.ts";

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

// --- Safe-write / guard logic for unattended daily runs (issue #237) ---

const committed: IndexDataset = {
  sp500: {
    "2024-01-02": 4742.83,
    "2024-01-03": 4704.81,
    "2024-01-04": 4688.68,
  },
  nasdaq: { "2024-01-02": 14765.94, "2024-01-03": 14592.21 },
  russell2000: { "2024-01-02": 2027.07, "2024-01-03": 1989.21 },
};

Deno.test("checkDatasetSafety - no committed file accepts any fresh dataset", () => {
  const result = checkDatasetSafety(null, { sp500: { "2024-01-02": 1 } });
  assertEquals(result.ok, true);
});

Deno.test("checkDatasetSafety - equal dataset is safe", () => {
  const result = checkDatasetSafety(committed, structuredClone(committed));
  assertEquals(result.ok, true);
});

Deno.test("checkDatasetSafety - extended history (more days) is safe", () => {
  const fresh = structuredClone(committed);
  fresh.sp500["2024-01-05"] = 4697.24;
  fresh.nasdaq["2024-01-04"] = 14510.30;
  fresh.russell2000["2024-01-04"] = 1975.71;
  const result = checkDatasetSafety(committed, fresh);
  assertEquals(result.ok, true);
});

Deno.test("checkDatasetSafety - dropping an index key is refused", () => {
  const fresh = structuredClone(committed) as Partial<IndexDataset>;
  delete fresh.russell2000;
  const result = checkDatasetSafety(committed, fresh as IndexDataset);
  assertEquals(result.ok, false);
  assert(result.reason?.includes("russell2000"));
});

Deno.test("checkDatasetSafety - an emptied index is refused", () => {
  const fresh = structuredClone(committed);
  fresh.nasdaq = {};
  const result = checkDatasetSafety(committed, fresh);
  assertEquals(result.ok, false);
  assert(result.reason?.includes("nasdaq"));
});

Deno.test("checkDatasetSafety - truncated history is refused", () => {
  const fresh = structuredClone(committed);
  fresh.sp500 = { "2024-01-02": 4742.83 }; // 3 days -> 1 day
  const result = checkDatasetSafety(committed, fresh);
  assertEquals(result.ok, false);
  assert(result.reason?.includes("sp500"));
  assert(result.reason?.includes("fewer"));
});

Deno.test("checkDatasetSafety - a regressed newest date is refused", () => {
  // Same number of days, but the newest day moves backwards.
  const fresh = structuredClone(committed);
  fresh.sp500 = {
    "2024-01-01": 4700.00,
    "2024-01-02": 4742.83,
    "2024-01-03": 4704.81,
  };
  const result = checkDatasetSafety(committed, fresh);
  assertEquals(result.ok, false);
  assert(result.reason?.includes("regress"));
});

Deno.test("newestDate - returns the lexically greatest ISO date", () => {
  assertEquals(
    newestDate(["2024-01-03", "2024-01-10", "2024-01-02"]),
    "2024-01-10",
  );
  assertEquals(newestDate([]), "");
});

Deno.test("serialiseDataset - 2-space indent with a trailing newline", () => {
  const text = serialiseDataset({ sp500: { "2024-01-02": 4742.83 } });
  assert(text.endsWith("\n"));
  assertEquals(
    text,
    '{\n  "sp500": {\n    "2024-01-02": 4742.83\n  }\n}\n',
  );
});

Deno.test("serialiseDataset round-trips through JSON.parse", () => {
  const data = { sp500: { "2024-01-02": 4742.83 }, nasdaq: {} };
  assertEquals(JSON.parse(serialiseDataset(data)), data);
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

// --- Freshness guard: indices must not silently lag the actuals (issue #239) ---

Deno.test("datasetNewestDate - newest date across every index", () => {
  const data: IndexDataset = {
    sp500: { "2024-01-02": 1, "2024-01-05": 2 },
    nasdaq: { "2024-01-02": 1, "2024-01-04": 2 },
    russell2000: { "2024-01-03": 1 },
  };
  assertEquals(datasetNewestDate(data), "2024-01-05");
  assertEquals(datasetNewestDate({}), "");
  assertEquals(datasetNewestDate({ sp500: {} }), "");
});

Deno.test("tradingDayGap - identical or backwards dates are zero", () => {
  assertEquals(tradingDayGap("2026-06-18", "2026-06-18"), 0);
  // Indices ahead of the actuals: no lag.
  assertEquals(tradingDayGap("2026-06-19", "2026-06-18"), 0);
  assertEquals(tradingDayGap("", "2026-06-18"), 0);
});

Deno.test("tradingDayGap - one trading day end-of-day lag", () => {
  // Thursday -> Friday is a single trading day.
  assertEquals(tradingDayGap("2026-06-18", "2026-06-19"), 1);
});

Deno.test("tradingDayGap - skips weekends", () => {
  // Friday -> Monday is one trading day (the weekend does not count).
  assertEquals(tradingDayGap("2026-06-19", "2026-06-22"), 1);
  // Friday -> following Friday spans only five trading days.
  assertEquals(tradingDayGap("2026-06-19", "2026-06-26"), 5);
});

Deno.test("checkIndexFreshness - one-day lag passes within tolerance", () => {
  const result = checkIndexFreshness("2026-06-18", "2026-06-19");
  assertEquals(result.ok, true);
  assertEquals(result.gap, 1);
  assertEquals(result.reason, undefined);
});

Deno.test("checkIndexFreshness - indices level with the actuals pass", () => {
  const result = checkIndexFreshness("2026-06-19", "2026-06-19");
  assertEquals(result.ok, true);
  assertEquals(result.gap, 0);
});

Deno.test("checkIndexFreshness - a weekend gap does not false-alarm", () => {
  // Indices to Friday, actuals to the following Monday: one trading day.
  const result = checkIndexFreshness("2026-06-19", "2026-06-22");
  assertEquals(result.ok, true);
  assertEquals(result.gap, 1);
});

Deno.test("checkIndexFreshness - stale indices fail with an actionable message", () => {
  // Indices roughly eight calendar days behind the actuals (the #234 symptom).
  const result = checkIndexFreshness("2026-06-08", "2026-06-18");
  assertEquals(result.ok, false);
  assert(result.gap > FRESHNESS_TOLERANCE_TRADING_DAYS);
  // The failure message names both dates and the gap.
  assert(result.reason);
  assert(result.reason.includes("2026-06-08"), "names the indices date");
  assert(result.reason.includes("2026-06-18"), "names the actuals date");
  assert(result.reason.includes(String(result.gap)), "names the gap");
});

Deno.test("checkIndexFreshness - tolerance boundary", () => {
  // Exactly three trading days behind is still acceptable; four is not.
  assertEquals(checkIndexFreshness("2026-06-15", "2026-06-18").gap, 3);
  assertEquals(checkIndexFreshness("2026-06-15", "2026-06-18").ok, true);
  assertEquals(checkIndexFreshness("2026-06-12", "2026-06-18").gap, 4);
  assertEquals(checkIndexFreshness("2026-06-12", "2026-06-18").ok, false);
});

Deno.test("committed indices are fresh against the committed actuals", async () => {
  const indices = JSON.parse(
    await Deno.readTextFile("docs/market-indices.json"),
  ) as IndexDataset;
  const actuals = JSON.parse(
    await Deno.readTextFile("docs/USDAUD.json"),
  ) as Record<string, number>;

  const indicesNewest = datasetNewestDate(indices);
  const actualsNewest = newestDate(Object.keys(actuals));

  const result = checkIndexFreshness(indicesNewest, actualsNewest);
  assert(
    result.ok,
    result.reason ?? "committed benchmark indices lag the committed actuals",
  );
});
