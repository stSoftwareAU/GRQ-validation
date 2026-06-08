// Behavioural tests for the projection/scoring kernels added in issue #100.
//
// These import the REAL shipped helpers from docs/projection.js — the same code
// the dashboard's GRQValidator delegates to — and assert on their observable
// output across happy paths, error paths and edge cases.
import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import "../docs/projection.js";

interface MarketDataPoint {
  date: Date;
  high: number;
  low: number;
  open: number;
  close: number;
  splitCoefficient: number;
}

interface Projection {
  projected90DayPerformance: number;
  projectionMethod: string;
  confidence: number;
}

const g = globalThis as unknown as {
  GRQProjection: {
    formatCurrency: (value: number | null | undefined) => string;
    getSplitAdjustment: (
      marketData: MarketDataPoint[] | undefined,
      historicalDate: Date,
    ) => number;
    adjustHistoricalPriceToCurrent: (
      price: number,
      marketData: MarketDataPoint[] | undefined,
      historicalDate: Date,
    ) => number;
    getBuyPrice: (
      marketData: MarketDataPoint[] | undefined,
      scoreDate: Date,
    ) => { price: number; dateUsed: Date } | null;
    currentPriceFromLatest: (marketData: MarketDataPoint[]) => number | null;
    calculateTargetPercentage: (
      buyPrice: number | null,
      adjustedTarget: number | null,
    ) => number | null;
    calculateRSquared: (
      dataPoints: { x: number; y: number }[],
      slope: number,
      intercept: number,
    ) => number;
    computeTrendLine: (
      dataPoints: { x: number; y: number }[],
    ) => {
      slope: number;
      intercept: number;
      predicted90DayPerformance: number;
      rSquared: number;
    } | null;
    daysElapsedFromMarketData: (
      scoreDate: Date,
      latestMarketDate: Date,
    ) => number;
    computeHybridProjection: (inputs: {
      daysElapsed: number;
      currentPerformance: number;
      targetPercentage: number | null;
      trendLine: { slope: number; rSquared: number } | null;
    }) => Projection;
    computeJudgement: (inputs: {
      performance: number | null;
      daysElapsed: number;
      targetPercentage: number | null;
      projection: Projection | null;
    }) => string;
  };
};
const GRQProjection = g.GRQProjection;

function makePoint(
  date: Date,
  high: number,
  low: number,
  split = 1.0,
): MarketDataPoint {
  return { date, high, low, open: low, close: high, splitCoefficient: split };
}

// --- formatCurrency ---------------------------------------------------------

Deno.test("formatCurrency renders USD with two decimals", () => {
  assertEquals(GRQProjection.formatCurrency(18.5), "$18.50");
  assertEquals(GRQProjection.formatCurrency(0), "$0.00");
});

Deno.test("formatCurrency returns N/A for missing or non-numeric values", () => {
  assertEquals(GRQProjection.formatCurrency(null), "N/A");
  assertEquals(GRQProjection.formatCurrency(undefined), "N/A");
  assertEquals(GRQProjection.formatCurrency(NaN), "N/A");
});

// --- split adjustment -------------------------------------------------------

Deno.test("getSplitAdjustment multiplies splits after the historical date", () => {
  const md = [
    makePoint(new Date(2025, 0, 1), 100, 98, 1.0),
    makePoint(new Date(2025, 0, 10), 50, 49, 2.0), // 2:1 split after day 1.
  ];
  assertEquals(GRQProjection.getSplitAdjustment(md, new Date(2025, 0, 1)), 2.0);
  // A split on/before the date does not count.
  assertEquals(
    GRQProjection.getSplitAdjustment(md, new Date(2025, 0, 10)),
    1.0,
  );
});

Deno.test("getSplitAdjustment defaults to 1.0 without market data", () => {
  assertEquals(GRQProjection.getSplitAdjustment(undefined, new Date()), 1.0);
});

Deno.test("adjustHistoricalPriceToCurrent divides out the split", () => {
  const md = [
    makePoint(new Date(2025, 0, 1), 100, 98, 1.0),
    makePoint(new Date(2025, 0, 10), 50, 49, 2.0),
  ];
  assertEquals(
    GRQProjection.adjustHistoricalPriceToCurrent(30, md, new Date(2025, 0, 1)),
    15,
  );
});

// --- getBuyPrice ------------------------------------------------------------

Deno.test("getBuyPrice finds the next trading day within five days", () => {
  const md = [makePoint(new Date(2025, 1, 18), 15.18, 14.72)];
  const buy = GRQProjection.getBuyPrice(md, new Date(2025, 1, 14));
  assert(buy !== null);
  assertEquals(buy!.price, 14.95);
  assertEquals(buy!.dateUsed.getDate(), 18);
});

Deno.test("getBuyPrice returns null beyond the five-day window or with no data", () => {
  const md = [makePoint(new Date(2025, 1, 25), 15.18, 14.72)];
  assertEquals(GRQProjection.getBuyPrice(md, new Date(2025, 1, 14)), null);
  assertEquals(
    GRQProjection.getBuyPrice(undefined, new Date(2025, 1, 14)),
    null,
  );
});

// --- currentPriceFromLatest -------------------------------------------------

Deno.test("currentPriceFromLatest returns the midpoint of the last point", () => {
  const md = [
    makePoint(new Date(2025, 0, 1), 10, 9),
    makePoint(new Date(2025, 0, 2), 12, 10),
  ];
  assertEquals(GRQProjection.currentPriceFromLatest(md), 11);
  assertEquals(GRQProjection.currentPriceFromLatest([]), null);
});

// --- calculateTargetPercentage ----------------------------------------------

Deno.test("calculateTargetPercentage returns the return vs the buy price", () => {
  assertAlmostEquals(
    GRQProjection.calculateTargetPercentage(14.95, 18.5)!,
    23.75,
    0.01,
  );
});

Deno.test("calculateTargetPercentage returns null when an input is missing", () => {
  assertEquals(GRQProjection.calculateTargetPercentage(null, 18.5), null);
  assertEquals(GRQProjection.calculateTargetPercentage(14.95, null), null);
});

// --- computeTrendLine -------------------------------------------------------

Deno.test("computeTrendLine fits a line through the origin with R²", () => {
  const trend = GRQProjection.computeTrendLine([
    { x: 0, y: 0 },
    { x: 10, y: 10 },
    { x: 20, y: 20 },
  ]);
  assert(trend !== null);
  assertEquals(trend!.intercept, 0);
  assertAlmostEquals(trend!.slope, 1, 1e-9);
  assertAlmostEquals(trend!.predicted90DayPerformance, 90, 1e-9);
  assertAlmostEquals(trend!.rSquared, 1, 1e-9);
});

Deno.test("computeTrendLine returns null for fewer than three points", () => {
  assertEquals(GRQProjection.computeTrendLine([{ x: 0, y: 0 }]), null);
  assertEquals(GRQProjection.computeTrendLine([]), null);
});

Deno.test("computeTrendLine floors the 90-day prediction at -100", () => {
  const trend = GRQProjection.computeTrendLine([
    { x: 0, y: 0 },
    { x: 10, y: -50 },
    { x: 20, y: -100 },
  ]);
  assert(trend !== null);
  assertEquals(trend!.predicted90DayPerformance, -100);
});

// --- calculateRSquared ------------------------------------------------------

Deno.test("calculateRSquared is 1 for a perfect fit and 0 for no variance", () => {
  const perfect = GRQProjection.calculateRSquared(
    [{ x: 0, y: 0 }, { x: 1, y: 2 }, { x: 2, y: 4 }],
    2,
    0,
  );
  assertAlmostEquals(perfect, 1, 1e-9);
  const flat = GRQProjection.calculateRSquared(
    [{ x: 0, y: 5 }, { x: 1, y: 5 }],
    0,
    5,
  );
  assertEquals(flat, 0);
});

// --- daysElapsedFromMarketData ----------------------------------------------

Deno.test("daysElapsedFromMarketData counts days and caps at 90", () => {
  const score = new Date(2025, 1, 18);
  assertEquals(
    GRQProjection.daysElapsedFromMarketData(score, new Date(2025, 1, 20)),
    2,
  );
  assertEquals(
    GRQProjection.daysElapsedFromMarketData(score, new Date(2025, 5, 18)),
    90,
  );
});

// --- computeHybridProjection ------------------------------------------------

Deno.test("computeHybridProjection uses the dampened trend early when confident", () => {
  const p = GRQProjection.computeHybridProjection({
    daysElapsed: 15,
    currentPerformance: 10,
    targetPercentage: 30,
    trendLine: { slope: 1.0, rSquared: 0.5 },
  });
  assertEquals(p.projectionMethod, "dampened_trend");
  assertEquals(p.projected90DayPerformance, 27); // 1.0 * 0.3 * 90.
});

Deno.test("computeHybridProjection falls back to target-based with a weak trend", () => {
  const p = GRQProjection.computeHybridProjection({
    daysElapsed: 15,
    currentPerformance: 10,
    targetPercentage: 30,
    trendLine: { slope: 1.0, rSquared: 0.01 }, // Below the 0.1 threshold.
  });
  assertEquals(p.projectionMethod, "target_based");
  assertEquals(p.confidence, 0.3);
});

Deno.test("computeHybridProjection uses the realistic trajectory after 60 days", () => {
  const p = GRQProjection.computeHybridProjection({
    daysElapsed: 80,
    currentPerformance: 1,
    targetPercentage: 50,
    trendLine: null,
  });
  assertEquals(p.projectionMethod, "realistic_trajectory");
  assertEquals(p.confidence, 0.7); // Required catch-up rate is unrealistic.
});

Deno.test("computeHybridProjection clamps the projection to [-100, 200]", () => {
  const high = GRQProjection.computeHybridProjection({
    daysElapsed: 15,
    currentPerformance: 10,
    targetPercentage: 30,
    trendLine: { slope: 100, rSquared: 0.9 },
  });
  assertEquals(high.projected90DayPerformance, 200);
});

// --- computeJudgement -------------------------------------------------------

Deno.test("computeJudgement returns Pending for null performance", () => {
  assertEquals(
    GRQProjection.computeJudgement({
      performance: null,
      daysElapsed: 30,
      targetPercentage: 20,
      projection: null,
    }),
    "Pending",
  );
});

Deno.test("computeJudgement reports the projection when confident", () => {
  const judgement = GRQProjection.computeJudgement({
    performance: 10,
    daysElapsed: 30,
    targetPercentage: 60,
    projection: {
      projected90DayPerformance: 45,
      projectionMethod: "dampened_trend",
      confidence: 0.5,
    },
  });
  // 45 / 60 = 0.75 of target -> Below Target.
  assert(judgement.startsWith("Below Target"));
  assert(judgement.includes("45.0%"));
});

Deno.test("computeJudgement falls back to current performance when not confident", () => {
  const judgement = GRQProjection.computeJudgement({
    performance: 8,
    daysElapsed: 30,
    targetPercentage: 25,
    projection: {
      projected90DayPerformance: 20,
      projectionMethod: "target_based",
      confidence: 0.1, // Below the 0.2 confidence gate.
    },
  });
  assert(judgement.startsWith("Below Target"));
  assert(judgement.includes("8.0%"));
});

Deno.test("computeJudgement reports the realised outcome from day 90", () => {
  assertEquals(
    GRQProjection.computeJudgement({
      performance: 25,
      daysElapsed: 90,
      targetPercentage: 20,
      projection: null,
    }),
    "Hit Target",
  );
  assertEquals(
    GRQProjection.computeJudgement({
      performance: -5,
      daysElapsed: 90,
      targetPercentage: 20,
      projection: null,
    }),
    "Missed Target",
  );
});
