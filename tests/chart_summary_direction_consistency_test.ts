// Chart-vs-summary direction consistency regression test (issue #368,
// part of milestone #333).
//
// #333: with a 1 January 2026 score date the benchmark indices (SP500 /
// NASDAQ / Russell 2000) disagreed between two views that share the same
// score-date baseline and differ ONLY in their end date:
//   - the CHART is truncated to `scoreDate + maxDays` (maxDays = 90 on mobile,
//     180 on desktop — docs/app.js:1602), so it stops inside the early-2026 dip
//     and trends DOWN;
//   - the SUMMARY ran `indexPerformance` over the full period to the latest
//     price (docs/market_index.js, fed by `endDate = new Date()` at
//     docs/app.js:818), so it read UP (SP500 +9.36%, NASDAQ +14.13%,
//     Russell 2000 +18.80%).
//
// This test reproduces that contradiction with deterministic early-2026 fixture
// data (no network, no dependency on "today") and guards against it. It drives
// the REAL shipped kernels — docs/projection.js (`buildIndexSeriesFromMap`,
// `setDateToMidnight`) and docs/market_index.js (`indexPerformance`,
// `priceAsOf`) — exactly as docs/app.js does, with NO re-implemented maths.
//
// The assertion is expressed against the SHARED WINDOW END the fix introduces
// (`scoreDate + maxDays`). It is therefore:
//   - RED against current `main`, where `indexPerformance` has no window-aware
//     end date (`priceAsOf` does not exist), so the summary still reads to the
//     latest price and disagrees in sign with the windowed chart;
//   - GREEN once the #333 kernel + wiring sub-issues constrain the summary to
//     the chart window.
import { assert, assertAlmostEquals } from "@std/assert";
import "../docs/projection.js";
import "../docs/market_index.js";

const DAY = 24 * 60 * 60 * 1000;

interface IndexSeries {
  name: string;
  data: Array<{ date: Date; close: number }>;
  initialPrice: number | null;
  currentPrice: number | null;
}

const g = globalThis as unknown as {
  GRQProjection: {
    setDateToMidnight: (date: Date) => Date;
    buildIndexSeriesFromMap: (
      priceMap: Record<string, number>,
      indexName: string,
      startDate: Date,
      endDate: Date,
    ) => IndexSeries | null;
  };
  GRQMarketIndex: {
    indexPerformance: (
      indexData: unknown,
      endDate?: unknown,
    ) =>
      | { performance: number; initialPrice: number; currentPrice: number }
      | null;
    priceAsOf: (seriesOrPoints: unknown, endDate: unknown) => number | null;
  };
};
const GRQProjection = g.GRQProjection;
const GRQMarketIndex = g.GRQMarketIndex;

// 1 January 2026 score date, at local midnight — the #333 reproduction date.
const SCORE_DATE = GRQProjection.setDateToMidnight(new Date(2026, 0, 1));

// A fixed "latest" date well beyond the 180-day desktop window, standing in for
// production's `endDate = new Date()` (docs/app.js:818) so the fixture is
// deterministic and never depends on the real "today".
const LATEST_DATE = GRQProjection.setDateToMidnight(new Date(2026, 11, 31));

// Deterministic early-2026 benchmark fixtures shaped like the #333 data: each
// index dips through the first half of 2026 (so any window ending inside the
// 90- or 180-day horizon is DOWN against the score-date baseline) and only
// recovers to a positive full-period change late in the year. Mid-month points
// keep the per-device window end clear of any data point, so the result is
// robust to daylight-saving drift in the date arithmetic.
//
// The November figures are chosen so the full-period change matches the #333
// summary numbers exactly: SP500 +9.36%, NASDAQ +14.13%, Russell 2000 +18.80%.
const FIXTURES: Array<
  { key: string; name: string; priceMap: Record<string, number> }
> = [
  {
    key: "sp500",
    name: "SP500",
    priceMap: {
      "2026-01-15": 4000, // score-date baseline (initialPrice)
      "2026-02-15": 3850,
      "2026-03-15": 3650, // mobile (90d) window end lands here -> down
      "2026-04-15": 3600,
      "2026-05-15": 3580,
      "2026-06-15": 3640, // desktop (180d) window end lands here -> down
      "2026-07-15": 3850,
      "2026-08-15": 4050,
      "2026-09-15": 4200,
      "2026-10-15": 4300,
      "2026-11-15": 4374.40, // latest: +9.36% full period
    },
  },
  {
    key: "nasdaq",
    name: "NASDAQ",
    priceMap: {
      "2026-01-15": 12000,
      "2026-02-15": 11400,
      "2026-03-15": 10800, // mobile window end -> down
      "2026-04-15": 10600,
      "2026-05-15": 10500,
      "2026-06-15": 10920, // desktop window end -> down
      "2026-07-15": 11600,
      "2026-08-15": 12300,
      "2026-09-15": 12900,
      "2026-10-15": 13300,
      "2026-11-15": 13695.60, // latest: +14.13% full period
    },
  },
  {
    key: "russell2000",
    name: "Russell 2000",
    priceMap: {
      "2026-01-15": 2000,
      "2026-02-15": 1920,
      "2026-03-15": 1840, // mobile window end -> down
      "2026-04-15": 1810,
      "2026-05-15": 1790,
      "2026-06-15": 1820, // desktop window end -> down
      "2026-07-15": 1980,
      "2026-08-15": 2150,
      "2026-09-15": 2270,
      "2026-10-15": 2330,
      "2026-11-15": 2376, // latest: +18.80% full period
    },
  },
];

// Per-device chart windows. maxDays mirrors docs/app.js:1602.
const WINDOWS = [
  { label: "mobile", maxDays: 90 },
  { label: "desktop", maxDays: 180 },
];

// The shared window end the fix introduces, computed exactly as the chart does
// (docs/app.js:1603-1605): scoreDate + maxDays, snapped to local midnight.
function windowEnd(maxDays: number): Date {
  return GRQProjection.setDateToMidnight(
    new Date(SCORE_DATE.getTime() + maxDays * DAY),
  );
}

// Build the index series the way docs/app.js loadMarketIndexData() does
// (docs/app.js:857): slice the {date: close} map from the score date to the
// latest available date. This is the SAME object that feeds both the chart and
// the summary, so the only thing that can differ between them is the end date.
function buildSeries(priceMap: Record<string, number>, name: string) {
  return GRQProjection.buildIndexSeriesFromMap(
    priceMap,
    name,
    SCORE_DATE,
    LATEST_DATE,
  )!;
}

Deno.test("chart and summary agree in direction at the shared per-device window end (#368)", async (t) => {
  for (const { label, maxDays } of WINDOWS) {
    await t.step(`${label} (${maxDays} days)`, async (tt) => {
      const end = windowEnd(maxDays);

      for (const { name, priceMap } of FIXTURES) {
        await tt.step(name, () => {
          const series = buildSeries(priceMap, name);
          assert(
            series.initialPrice !== null && series.currentPrice !== null,
            `${name}: fixture should produce a usable series`,
          );

          // Summary, constrained to the chart window (the fix): the close of the
          // last trading day at or before the window end, vs the score-date
          // baseline. This is the call that goes window-aware once #333 lands.
          const summary = GRQMarketIndex.indexPerformance(series, end);
          assert(
            summary !== null,
            `${name}: windowed summary should be computable`,
          );

          // Chart's last-visible-point change: the chart truncates the same
          // series to the window end, so its final point is priceAsOf(window
          // end) measured against the same baseline.
          const lastVisibleClose = GRQMarketIndex.priceAsOf(series.data, end);
          assert(
            lastVisibleClose !== null,
            `${name}: chart should have a visible point in the window`,
          );
          const chartChange =
            ((lastVisibleClose - series.initialPrice!) / series.initialPrice!) *
            100;

          // Direction must agree: same sign.
          assert(
            Math.sign(summary.performance) === Math.sign(chartChange),
            `${name} (${label}): summary ${
              summary.performance.toFixed(2)
            }% and chart ${
              chartChange.toFixed(2)
            }% must share the same direction`,
          );

          // Magnitude must agree within tolerance: both views read the same
          // window end against the same baseline, so they coincide.
          assertAlmostEquals(
            summary.performance,
            chartChange,
            0.01,
            `${name} (${label}): summary and chart magnitudes must agree`,
          );

          // The fixture is a within-window dip, so both views read DOWN — the
          // chart direction #333 says the summary must match.
          assert(
            summary.performance < 0,
            `${name} (${label}): windowed view should be down (got ${
              summary.performance.toFixed(2)
            }%)`,
          );

          // Document the #333 contradiction the fix removes: the OLD summary
          // ran to the latest price (no window) and read UP, disagreeing in
          // sign with the windowed chart. This is exactly what made the views
          // contradict each other.
          const fullPeriod = GRQMarketIndex.indexPerformance(series);
          assert(fullPeriod !== null);
          assert(
            fullPeriod.performance > 0,
            `${name}: full-period (run-to-latest) summary should read up`,
          );
          assert(
            Math.sign(fullPeriod.performance) !==
              Math.sign(summary.performance),
            `${name} (${label}): run-to-latest summary (${
              fullPeriod.performance.toFixed(2)
            }%) and windowed view (${
              summary.performance.toFixed(2)
            }%) must contradict — the bug the shared window end fixes`,
          );
        });
      }
    });
  }
});

// Pin the full-period figures to the #333 reproduction numbers so the fixture
// stays faithful to the reported contradiction (chart down, summary up).
Deno.test("fixture reproduces the #333 full-period summary numbers", () => {
  const expected: Record<string, number> = {
    sp500: 9.36,
    nasdaq: 14.13,
    russell2000: 18.80,
  };
  for (const { key, name, priceMap } of FIXTURES) {
    const series = buildSeries(priceMap, name);
    const fullPeriod = GRQMarketIndex.indexPerformance(series);
    assert(fullPeriod !== null, `${name}: full-period summary should compute`);
    assertAlmostEquals(
      fullPeriod.performance,
      expected[key],
      0.01,
      `${name}: full-period change should match the #333 number`,
    );
  }
});
