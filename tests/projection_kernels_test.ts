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
    deviceWindowDays: (isMobile: boolean, mobileWindowDays?: number) => number;
    deviceWindowEnd: (
      scoreDate: Date | string | null | undefined,
      isMobile: boolean,
      mobileWindowDays?: number,
    ) => Date | null;
    setDateToMidnight: (date: Date | string) => Date;
    formatCurrency: (value: number | null | undefined) => string;
    getSplitAdjustment: (
      marketData: MarketDataPoint[] | undefined,
      historicalDate: Date,
    ) => number;
    computeSplitAdjustment: (
      marketData: MarketDataPoint[] | undefined,
      historicalDate: Date,
    ) => { factor: number; reliable: boolean };
    adjustHistoricalPriceToCurrent: (
      price: number,
      marketData: MarketDataPoint[] | undefined,
      historicalDate: Date,
    ) => number;
    getBuyPrice: (
      marketData: MarketDataPoint[] | undefined,
      scoreDate: Date,
    ) => { price: number; dateUsed: Date; reliable: boolean } | null;
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

// --- selectable window (issue #448; desktop-180 lock relaxed by #464) -------

Deno.test("deviceWindowDays honours an explicit permitted window on either device, each device keeps its own default", () => {
  // Default mobile behaviour is unchanged (90 days).
  assertEquals(GRQProjection.deviceWindowDays(true), 90);
  // Mobile may opt into the full 180-day window.
  assertEquals(GRQProjection.deviceWindowDays(true, 180), 180);
  // Mobile explicit 90 stays 90.
  assertEquals(GRQProjection.deviceWindowDays(true, 90), 90);
  // A non-permitted value falls back to the mobile 90-day default.
  assertEquals(GRQProjection.deviceWindowDays(true, 999), 90);
  // Desktop default is preserved (180 days).
  assertEquals(GRQProjection.deviceWindowDays(false), 180);
  // Desktop may now opt into 90 — the old #448 desktop-180 lock is relaxed (#464).
  assertEquals(GRQProjection.deviceWindowDays(false, 90), 90);
  // Desktop explicit 180 stays 180.
  assertEquals(GRQProjection.deviceWindowDays(false, 180), 180);
  // A non-permitted value falls back to the desktop 180-day default.
  assertEquals(GRQProjection.deviceWindowDays(false, 999), 180);
});

Deno.test("deviceWindowEnd threads the chosen mobile window through to the end date", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const scoreDate = new Date("2026-01-01T13:45:00");
  const base = GRQProjection.setDateToMidnight(new Date("2026-01-01"));

  const expectEnd = (days: number) =>
    GRQProjection.setDateToMidnight(new Date(base.getTime() + days * DAY_MS))
      .getTime();

  // Mobile default stays 90 days.
  assertEquals(
    GRQProjection.deviceWindowEnd(scoreDate, true)!.getTime(),
    expectEnd(90),
  );
  // Mobile opting into 180 ends 180 days after the score date.
  assertEquals(
    GRQProjection.deviceWindowEnd(scoreDate, true, 180)!.getTime(),
    expectEnd(180),
  );
  // Desktop default (no explicit value) still ends 180 days after.
  assertEquals(
    GRQProjection.deviceWindowEnd(scoreDate, false)!.getTime(),
    expectEnd(180),
  );
  // Desktop opting into 90 ends 90 days after the score date (lock relaxed, #464).
  assertEquals(
    GRQProjection.deviceWindowEnd(scoreDate, false, 90)!.getTime(),
    expectEnd(90),
  );
  // Null / unparseable score date still returns null (blank-on-missing).
  assertEquals(GRQProjection.deviceWindowEnd(null, true, 180), null);
  assertEquals(
    GRQProjection.deviceWindowEnd(new Date("not-a-date"), true, 180),
    null,
  );
});

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

// --- computeSplitAdjustment (issue #292) ------------------------------------

Deno.test("computeSplitAdjustment: clean single split -> corrected, reliable", () => {
  // A real 2:1 split halves the price, so the observed pre/post ratio matches
  // the coefficient and the factor is trustworthy.
  const md = [
    makePoint(new Date(2025, 0, 1), 100, 98, 1.0),
    makePoint(new Date(2025, 0, 10), 50, 49, 2.0),
  ];
  const r = GRQProjection.computeSplitAdjustment(md, new Date(2025, 0, 1));
  assertEquals(r.factor, 2.0);
  assertEquals(r.reliable, true);
});

Deno.test("computeSplitAdjustment: no-split series -> factor 1.0, reliable", () => {
  const md = [
    makePoint(new Date(2025, 0, 1), 100, 98, 1.0),
    makePoint(new Date(2025, 0, 10), 105, 103, 1.0),
  ];
  const r = GRQProjection.computeSplitAdjustment(md, new Date(2025, 0, 1));
  assertEquals(r.factor, 1.0);
  assertEquals(r.reliable, true);

  // Missing data is also a reliable no-op.
  const empty = GRQProjection.computeSplitAdjustment(undefined, new Date());
  assertEquals(empty.factor, 1.0);
  assertEquals(empty.reliable, true);
});

Deno.test("computeSplitAdjustment: duplicate split rows are de-duplicated", () => {
  // The same 2:1 event recorded twice three days apart must apply once, not
  // compound to 4.0.
  const md = [
    makePoint(new Date(2025, 0, 1), 100, 98, 1.0),
    makePoint(new Date(2025, 0, 10), 50, 49, 2.0),
    makePoint(new Date(2025, 0, 13), 50, 49, 2.0), // duplicate within 5 days
  ];
  const r = GRQProjection.computeSplitAdjustment(md, new Date(2025, 0, 1));
  assertEquals(r.factor, 2.0, "duplicate within the window applies once");
  assertEquals(r.reliable, true);
});

Deno.test("computeSplitAdjustment: distinct splits beyond the window compound", () => {
  // Two genuine events more than five days apart, each with a matching price
  // drop, multiply to a 4.0 cumulative factor and stay reliable.
  const md = [
    makePoint(new Date(2025, 0, 1), 100, 98, 1.0),
    makePoint(new Date(2025, 0, 10), 50, 49, 2.0),
    makePoint(new Date(2025, 1, 10), 25, 24.5, 2.0),
  ];
  const r = GRQProjection.computeSplitAdjustment(md, new Date(2025, 0, 1));
  assertEquals(r.factor, 4.0);
  assertEquals(r.reliable, true);
});

Deno.test("computeSplitAdjustment: implausible coefficient -> unreliable", () => {
  // A 50:1 coefficient is above the plausible 10:1 ceiling.
  const md = [
    makePoint(new Date(2025, 0, 1), 100, 98, 1.0),
    makePoint(new Date(2025, 0, 10), 2, 1.9, 50.0),
  ];
  const r = GRQProjection.computeSplitAdjustment(md, new Date(2025, 0, 1));
  assertEquals(r.reliable, false);
});

Deno.test("computeSplitAdjustment: price-ratio mismatch -> unreliable", () => {
  // Coefficient claims 10:1 but the price barely moved: the cross-check fails,
  // mirroring the KLAC distortion (current price never split).
  const md = [
    makePoint(new Date(2025, 0, 1), 100, 98, 1.0),
    makePoint(new Date(2025, 0, 10), 99, 97, 10.0),
  ];
  const r = GRQProjection.computeSplitAdjustment(md, new Date(2025, 0, 1));
  assertEquals(r.reliable, false);
});

Deno.test("computeSplitAdjustment: invalid coefficient treated as no split", () => {
  const md = [
    makePoint(new Date(2025, 0, 1), 100, 98, 1.0),
    makePoint(new Date(2025, 0, 10), 100, 98, 0),
  ];
  const r = GRQProjection.computeSplitAdjustment(md, new Date(2025, 0, 1));
  assertEquals(r.factor, 1.0);
  assertEquals(r.reliable, true);
});

Deno.test("getSplitAdjustment suppresses an unreliable factor (no inflation)", () => {
  // The unguarded multiply would return 10; the guarded helper refuses to apply
  // a factor it cannot reconcile and returns 1.0 instead.
  const md = [
    makePoint(new Date(2025, 0, 1), 100, 98, 1.0),
    makePoint(new Date(2025, 0, 10), 99, 97, 10.0),
  ];
  assertEquals(GRQProjection.getSplitAdjustment(md, new Date(2025, 0, 1)), 1.0);
});

Deno.test("getBuyPrice surfaces the reliability flag", () => {
  const reliableData = [
    makePoint(new Date(2025, 0, 1), 100, 98, 1.0),
    makePoint(new Date(2025, 0, 10), 50, 49, 2.0),
  ];
  const reliable = GRQProjection.getBuyPrice(
    reliableData,
    new Date(2025, 0, 1),
  );
  assert(reliable !== null);
  assertEquals(reliable!.reliable, true);
  // 99 midpoint / 2.0 split = 49.5.
  assertEquals(reliable!.price, 49.5);

  const distorted = [
    makePoint(new Date(2025, 0, 1), 100, 98, 1.0),
    makePoint(new Date(2025, 0, 10), 99, 97, 10.0),
  ];
  const flagged = GRQProjection.getBuyPrice(distorted, new Date(2025, 0, 1));
  assert(flagged !== null);
  assertEquals(flagged!.reliable, false);
  // Unreliable -> factor suppressed to 1.0, so the buy price is not over-divided.
  assertEquals(flagged!.price, 99);
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
