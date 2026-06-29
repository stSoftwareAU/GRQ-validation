// Tests for the headless trend-data engine (issue #429, milestone #422).
//
// These import the REAL shipped helpers from docs/trend_series.js (and its
// dependency docs/projection.js) and assert on their observable output:
//   - the per-date Actual % comes from the shared
//     GRQProjection.calculateIncludedPortfolioPerformance kernel, NOT the
//     backend performance_90_day field;
//   - the per-date Target % comes from the shared
//     GRQProjection.calculatePortfolioTargetPercentage kernel;
//   - non-matured score dates (newer than today - 90 days) are excluded;
//   - day / week / month / quarter buckets are the chronological mean of their
//     members.
import { assertAlmostEquals, assertEquals, assertThrows } from "@std/assert";
import "../docs/projection.js";
import "../docs/trend_series.js";

interface TrendStock {
  buyPrice: number | null;
  currentPrice: number | null;
  totalDividends?: number;
  adjustedTarget: number | null;
  avgStars?: number | null;
}

interface Prediction {
  date: string;
  stocks: TrendStock[];
}

interface TrendPoint {
  date: Date;
  actualPct: number;
  targetPct: number;
  count: number;
}

const g = globalThis as unknown as {
  GRQTrendSeries: {
    GRANULARITIES: string[];
    isMaturedScoreDate: (scoreDate: string | Date, today: Date) => boolean;
    filterStocksByStars: (
      stocks: TrendStock[],
      minStars: number,
    ) => TrendStock[];
    buildMaturedTrendSeries: (
      predictions: Prediction[],
      today: Date,
      minStars?: number,
    ) => TrendPoint[];
    bucketStartDate: (date: Date, granularity: string) => Date;
    aggregateTrendSeries: (
      series: TrendPoint[],
      granularity?: string,
    ) => TrendPoint[];
    buildTrendData: (
      predictions: Prediction[],
      today: Date,
      granularity?: string,
    ) => { granularity: string; series: TrendPoint[]; buckets: TrendPoint[] };
  };
};
const Trend = g.GRQTrendSeries;

// June 1, 2025 → maturity cutoff is March 3, 2025 (today - 90 days).
const TODAY = new Date(2025, 5, 1);

// Fixture predictions with hand-computable Actual / Target figures.
const PREDICTIONS: Prediction[] = [
  // 2024-10-15: actual mean(10, -10) = 0; target mean(20, 10) = 15; count 2.
  {
    date: "2024-10-15",
    stocks: [
      { buyPrice: 100, currentPrice: 110, adjustedTarget: 120 },
      { buyPrice: 100, currentPrice: 90, adjustedTarget: 110 },
    ],
  },
  // 2024-11-05: actual 0; target 10; count 1.
  {
    date: "2024-11-05",
    stocks: [
      { buyPrice: 100, currentPrice: 100, adjustedTarget: 110 },
    ],
  },
  // 2024-11-20: actual mean(20, -10) = 5; target mean(40, 10) = 25; count 2.
  {
    date: "2024-11-20",
    stocks: [
      { buyPrice: 100, currentPrice: 120, adjustedTarget: 140 },
      { buyPrice: 200, currentPrice: 180, adjustedTarget: 220 },
    ],
  },
  // 2025-01-10: the second stock is excluded (currentPrice 0), so actual 30,
  // target 50, count 1 — exercising the inclusion gate.
  {
    date: "2025-01-10",
    stocks: [
      { buyPrice: 100, currentPrice: 130, adjustedTarget: 150 },
      { buyPrice: 100, currentPrice: 0, adjustedTarget: 999 },
    ],
  },
  // 2025-05-01: NOT matured (after the cutoff) — must be excluded entirely.
  {
    date: "2025-05-01",
    stocks: [
      { buyPrice: 100, currentPrice: 200, adjustedTarget: 250 },
    ],
  },
  // 2024-12-15: every stock excluded → null Actual → dropped from the series.
  {
    date: "2024-12-15",
    stocks: [
      { buyPrice: 100, currentPrice: 0, adjustedTarget: 120 },
      { buyPrice: 0, currentPrice: 100, adjustedTarget: 120 },
    ],
  },
];

Deno.test("trend_series.js publishes helpers on globalThis", () => {
  assertEquals(typeof Trend, "object");
  assertEquals(typeof Trend.buildMaturedTrendSeries, "function");
  assertEquals(typeof Trend.aggregateTrendSeries, "function");
  assertEquals(typeof Trend.buildTrendData, "function");
});

Deno.test("isMaturedScoreDate - boundary at exactly today - 90 days", () => {
  // Cutoff = TODAY - 90 days = 2025-03-03. On/before is matured.
  assertEquals(Trend.isMaturedScoreDate("2025-03-03", TODAY), true);
  assertEquals(Trend.isMaturedScoreDate("2025-03-04", TODAY), false);
  // Far past is matured; the future is not.
  assertEquals(Trend.isMaturedScoreDate("2024-10-15", TODAY), true);
  assertEquals(Trend.isMaturedScoreDate("2025-05-01", TODAY), false);
});

Deno.test("isMaturedScoreDate - unpadded and unparseable dates", () => {
  // Unpadded month/day (as seen in scores/index.json, e.g. "2024-12-3").
  assertEquals(Trend.isMaturedScoreDate("2024-12-3", TODAY), true);
  // Garbage parses to Invalid Date → never matured (renders nothing).
  assertEquals(Trend.isMaturedScoreDate("not-a-date", TODAY), false);
});

Deno.test("buildMaturedTrendSeries - per-date Actual/Target via shared kernels", () => {
  const series = Trend.buildMaturedTrendSeries(PREDICTIONS, TODAY);

  // Non-matured (2025-05-01) and null-Actual (2024-12-15) dates are excluded;
  // the rest are ordered chronologically.
  assertEquals(series.length, 4);
  assertEquals(
    series.map((p) => p.date.getTime()),
    [
      new Date(2024, 9, 15).getTime(),
      new Date(2024, 10, 5).getTime(),
      new Date(2024, 10, 20).getTime(),
      new Date(2025, 0, 10).getTime(),
    ],
  );

  assertAlmostEquals(series[0].actualPct, 0);
  assertAlmostEquals(series[0].targetPct, 15);
  assertEquals(series[0].count, 2);

  assertAlmostEquals(series[1].actualPct, 0);
  assertAlmostEquals(series[1].targetPct, 10);
  assertEquals(series[1].count, 1);

  assertAlmostEquals(series[2].actualPct, 5);
  assertAlmostEquals(series[2].targetPct, 25);
  assertEquals(series[2].count, 2);

  // The excluded (currentPrice 0) stock drops out of both averages and count.
  assertAlmostEquals(series[3].actualPct, 30);
  assertAlmostEquals(series[3].targetPct, 50);
  assertEquals(series[3].count, 1);
});

Deno.test("buildMaturedTrendSeries - tolerant of bad input", () => {
  assertEquals(Trend.buildMaturedTrendSeries([], TODAY), []);
  assertEquals(
    Trend.buildMaturedTrendSeries(
      null as unknown as Prediction[],
      TODAY,
    ),
    [],
  );
});

Deno.test("aggregateTrendSeries - day granularity keeps one bucket per date", () => {
  const series = Trend.buildMaturedTrendSeries(PREDICTIONS, TODAY);
  const buckets = Trend.aggregateTrendSeries(series, "day");
  assertEquals(buckets.length, 4);
  assertAlmostEquals(buckets[0].actualPct, 0);
  assertAlmostEquals(buckets[3].actualPct, 30);
  assertEquals(buckets.every((b) => b.count === 1), true);
});

Deno.test("aggregateTrendSeries - week granularity buckets by ISO Monday", () => {
  const series = Trend.buildMaturedTrendSeries(PREDICTIONS, TODAY);
  const buckets = Trend.aggregateTrendSeries(series, "week");
  // All four dates fall in distinct ISO weeks.
  assertEquals(buckets.length, 4);
  // 2024-10-15 (Tue) → Monday 2024-10-14.
  assertEquals(buckets[0].date.getTime(), new Date(2024, 9, 14).getTime());
  // 2025-01-10 (Fri) → Monday 2025-01-06.
  assertEquals(buckets[3].date.getTime(), new Date(2025, 0, 6).getTime());
});

Deno.test("aggregateTrendSeries - month granularity means the members", () => {
  const series = Trend.buildMaturedTrendSeries(PREDICTIONS, TODAY);
  const buckets = Trend.aggregateTrendSeries(series, "month");
  assertEquals(buckets.length, 3);

  // 2024-10: single member.
  assertEquals(buckets[0].date.getTime(), new Date(2024, 9, 1).getTime());
  assertAlmostEquals(buckets[0].actualPct, 0);
  assertAlmostEquals(buckets[0].targetPct, 15);
  assertEquals(buckets[0].count, 1);

  // 2024-11: mean of 2024-11-05 (0, 10) and 2024-11-20 (5, 25).
  assertEquals(buckets[1].date.getTime(), new Date(2024, 10, 1).getTime());
  assertAlmostEquals(buckets[1].actualPct, 2.5);
  assertAlmostEquals(buckets[1].targetPct, 17.5);
  assertEquals(buckets[1].count, 2);

  // 2025-01: single member.
  assertEquals(buckets[2].date.getTime(), new Date(2025, 0, 1).getTime());
  assertAlmostEquals(buckets[2].actualPct, 30);
  assertAlmostEquals(buckets[2].targetPct, 50);
  assertEquals(buckets[2].count, 1);
});

Deno.test("aggregateTrendSeries - quarter granularity means the members", () => {
  const series = Trend.buildMaturedTrendSeries(PREDICTIONS, TODAY);
  const buckets = Trend.aggregateTrendSeries(series, "quarter");
  assertEquals(buckets.length, 2);

  // 2024-Q4 (Oct 1): Oct15 (0,15), Nov05 (0,10), Nov20 (5,25).
  assertEquals(buckets[0].date.getTime(), new Date(2024, 9, 1).getTime());
  assertAlmostEquals(buckets[0].actualPct, 5 / 3);
  assertAlmostEquals(buckets[0].targetPct, 50 / 3);
  assertEquals(buckets[0].count, 3);

  // 2025-Q1 (Jan 1): single member.
  assertEquals(buckets[1].date.getTime(), new Date(2025, 0, 1).getTime());
  assertAlmostEquals(buckets[1].actualPct, 30);
  assertAlmostEquals(buckets[1].targetPct, 50);
  assertEquals(buckets[1].count, 1);
});

Deno.test("aggregateTrendSeries - unknown granularity throws", () => {
  assertThrows(
    () => Trend.aggregateTrendSeries([], "fortnight"),
    Error,
    "Unknown granularity",
  );
});

Deno.test("buildTrendData - composes series and buckets in one call", () => {
  const result = Trend.buildTrendData(PREDICTIONS, TODAY, "quarter");
  assertEquals(result.granularity, "quarter");
  assertEquals(result.series.length, 4);
  assertEquals(result.buckets.length, 2);
  // Defaults to month when granularity is omitted.
  const monthly = Trend.buildTrendData(PREDICTIONS, TODAY);
  assertEquals(monthly.granularity, "month");
  assertEquals(monthly.buckets.length, 3);
});

// --- Min-star filter before aggregation (issue #656) -----------------------
//
// With a threshold active, each date's stocks are filtered by their combined
// avgStars BEFORE the Actual/Target means are computed, so the trend recomputes
// over the qualifying subset. With the filter off (0), the series is identical
// to today regardless of any avgStars the stocks happen to carry.

// One matured date whose two stocks have different ratings and very different
// returns, so a threshold visibly changes the per-date Actual/Target.
const RATED: Prediction[] = [
  {
    date: "2024-10-15",
    stocks: [
      // 4★ stock: actual +10%, target +20%.
      { buyPrice: 100, currentPrice: 110, adjustedTarget: 120, avgStars: 4 },
      // 1★ stock: actual -10%, target +80%.
      { buyPrice: 100, currentPrice: 90, adjustedTarget: 180, avgStars: 1 },
      // Unrated stock: actual +30%, target +50%.
      {
        buyPrice: 100,
        currentPrice: 130,
        adjustedTarget: 150,
        avgStars: null,
      },
    ],
  },
];

Deno.test("filterStocksByStars - off (0) returns every stock unchanged", () => {
  const stocks = RATED[0].stocks;
  const kept = Trend.filterStocksByStars(stocks, 0);
  assertEquals(kept.length, 3);
  assertEquals(kept, stocks); // same reference: the no-op path allocates nothing
});

Deno.test("filterStocksByStars - active threshold drops low-rated and unrated stocks", () => {
  const kept = Trend.filterStocksByStars(RATED[0].stocks, 3);
  // Only the 4★ stock clears a 3★ floor; the 1★ and the unrated are dropped.
  assertEquals(kept.length, 1);
  assertEquals(kept[0].avgStars, 4);
});

Deno.test("buildMaturedTrendSeries - off (0) is identical to no minStars arg", () => {
  const withArg = Trend.buildMaturedTrendSeries(RATED, TODAY, 0);
  const withoutArg = Trend.buildMaturedTrendSeries(RATED, TODAY);
  // Filter off: all three stocks count → actual mean(10,-10,30)=10,
  // target mean(20,80,50)=50, count 3.
  assertEquals(withArg.length, 1);
  assertAlmostEquals(withArg[0].actualPct, 10);
  assertAlmostEquals(withArg[0].targetPct, 50);
  assertEquals(withArg[0].count, 3);
  // The default (no arg) must match the explicit-0 behaviour exactly.
  assertAlmostEquals(withoutArg[0].actualPct, withArg[0].actualPct);
  assertAlmostEquals(withoutArg[0].targetPct, withArg[0].targetPct);
  assertEquals(withoutArg[0].count, withArg[0].count);
});

Deno.test("buildMaturedTrendSeries - active threshold recomputes over the qualifying subset", () => {
  const series = Trend.buildMaturedTrendSeries(RATED, TODAY, 3);
  // 3★ floor keeps only the 4★ stock: actual 10, target 20, count 1.
  assertEquals(series.length, 1);
  assertAlmostEquals(series[0].actualPct, 10);
  assertAlmostEquals(series[0].targetPct, 20);
  assertEquals(series[0].count, 1);
});

Deno.test("buildMaturedTrendSeries - a threshold can empty a date out of the series", () => {
  // A 5★ floor leaves no qualifying stock → null Actual → the date is dropped.
  const series = Trend.buildMaturedTrendSeries(RATED, TODAY, 5);
  assertEquals(series.length, 0);
});
