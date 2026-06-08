// Hybrid-projection tests (issue #100).
//
// These used to drive a `MockHybridProjectionSystem` that reimplemented buy
// price, performance, the trend-line regression and the whole projection
// decision tree, then asserted on that copy. They now build market data and
// delegate every piece of maths to the REAL shared kernels in
// docs/projection.js (getBuyPrice, currentPriceFromLatest,
// calculatePerformanceReturn, calculateTargetPercentage, computeTrendLine,
// computeHybridProjection) — the same code the dashboard's GRQValidator uses.
import { assert, assertEquals, assertExists } from "@std/assert";
import "../docs/projection.js";

interface MarketDataPoint {
  date: Date;
  high: number;
  low: number;
  open: number;
  close: number;
  splitCoefficient: number;
}

interface DividendData {
  exDivDate: Date;
  amount: number;
}

interface Projection {
  projected90DayPerformance: number;
  projectionMethod: string;
  confidence: number;
}

const g = globalThis as unknown as {
  GRQProjection: {
    getBuyPrice: (
      marketData: MarketDataPoint[],
      scoreDate: Date,
    ) => { price: number; dateUsed: Date } | null;
    currentPriceFromLatest: (marketData: MarketDataPoint[]) => number | null;
    calculatePerformanceReturn: (
      buyPrice: number,
      currentPrice: number,
      totalDividends?: number,
    ) => number | null;
    calculateTargetPercentage: (
      buyPrice: number | null,
      adjustedTarget: number | null,
    ) => number | null;
    computeTrendLine: (
      dataPoints: { x: number; y: number }[],
    ) => { slope: number; rSquared: number } | null;
    computeHybridProjection: (inputs: {
      daysElapsed: number;
      currentPerformance: number;
      targetPercentage: number | null;
      trendLine: { slope: number; rSquared: number } | null;
    }) => Projection;
  };
};
const GRQProjection = g.GRQProjection;

const DAY = 24 * 60 * 60 * 1000;
const SCORE_DATE = new Date(2025, 0, 1); // Local midnight so buy-price dates match.

// Build a 30-point series from a price function of the day index.
function series(priceAt: (i: number) => number): MarketDataPoint[] {
  const points: MarketDataPoint[] = [];
  for (let i = 0; i < 30; i++) {
    const basePrice = priceAt(i);
    points.push({
      date: new Date(2025, 0, 1 + i),
      high: basePrice + 1,
      low: basePrice - 1,
      open: basePrice,
      close: basePrice,
      splitCoefficient: 1.0,
    });
  }
  return points;
}

const MARKET: Record<string, MarketDataPoint[]> = {
  STRONG_UP: series((i) => 100 + i * 2), // Strong linear uptrend.
  STRONG_DOWN: series((i) => 100 - i * 1.5), // Linear downtrend.
  // Deterministic oscillation with no net trend -> very low R² fit.
  VOLATILE: series((i) => (i % 2 === 0 ? 125 : 75)),
  INSUFFICIENT: [
    {
      date: SCORE_DATE,
      high: 100,
      low: 98,
      open: 99,
      close: 99,
      splitCoefficient: 1.0,
    },
  ],
};

const DIVIDENDS: Record<string, DividendData[]> = {
  STRONG_UP: [
    { exDivDate: new Date(2025, 0, 15), amount: 1.0 },
    { exDivDate: new Date(2025, 1, 15), amount: 1.0 },
  ],
};

// Collect `{ x: daysSinceScore, y: totalReturn }` points the way the dashboard
// does before handing them to the regression kernel. This is data plumbing; the
// regression and projection maths come from the shared kernels.
function trendDataPoints(
  marketData: MarketDataPoint[],
  buyPrice: number,
  dividends: DividendData[],
): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  for (const point of marketData) {
    if (point.date < SCORE_DATE) continue;
    const daysSinceScore = (point.date.getTime() - SCORE_DATE.getTime()) / DAY;
    const currentPrice = (point.high + point.low) / 2;
    const priceReturn = ((currentPrice - buyPrice) / buyPrice) * 100;
    const totalDividends = dividends
      .filter((d) => d.exDivDate <= point.date)
      .reduce((sum, d) => sum + d.amount, 0);
    const dividendReturn = (totalDividends / buyPrice) * 100;
    points.push({ x: daysSinceScore, y: priceReturn + dividendReturn });
  }
  return points;
}

// Drive the real kernels for a stock at a fixed 15-day (early) horizon.
function projectStock(symbol: string, target: number) {
  const marketData = MARKET[symbol];
  const dividends = DIVIDENDS[symbol] || [];
  const buyObj = GRQProjection.getBuyPrice(marketData, SCORE_DATE);
  assertExists(buyObj);
  const buyPrice = buyObj.price;

  const currentPrice = GRQProjection.currentPriceFromLatest(marketData);
  assert(currentPrice !== null);
  const totalDividends = dividends.reduce((sum, d) => sum + d.amount, 0);
  const currentPerformance = GRQProjection.calculatePerformanceReturn(
    buyPrice,
    currentPrice,
    totalDividends,
  );
  assert(currentPerformance !== null);

  const targetPercentage = GRQProjection.calculateTargetPercentage(
    buyPrice,
    target,
  );
  const trendLine = GRQProjection.computeTrendLine(
    trendDataPoints(marketData, buyPrice, dividends),
  );

  const projection = GRQProjection.computeHybridProjection({
    daysElapsed: 15, // Early-days horizon (< 30).
    currentPerformance,
    targetPercentage,
    trendLine,
  });

  return { projection, trendLine, currentPerformance, targetPercentage };
}

Deno.test("Hybrid Projection - Strong Upward Trend (Early Days)", () => {
  const { projection } = projectStock("STRONG_UP", 120);
  assertEquals(projection.projectionMethod, "dampened_trend");
  assert(projection.confidence > 0.2);
  assert(projection.projected90DayPerformance > 0);
  assert(projection.projected90DayPerformance <= 200);
  assert(projection.projected90DayPerformance >= -100);
});

Deno.test("Hybrid Projection - Strong Downward Trend (Early Days)", () => {
  const { projection } = projectStock("STRONG_DOWN", 80);
  assertEquals(projection.projectionMethod, "dampened_trend");
  assert(projection.confidence > 0.2);
  assert(projection.projected90DayPerformance < 0);
  assert(projection.projected90DayPerformance >= -100);
});

Deno.test("Hybrid Projection - Volatile Data (Low Confidence)", () => {
  const { projection } = projectStock("VOLATILE", 110);
  // Low R² fit -> fall back to the target-based method with low confidence.
  assertEquals(projection.projectionMethod, "target_based");
  assert(projection.confidence <= 0.5);
});

Deno.test("Hybrid Projection - Insufficient Data", () => {
  // A single market-data point cannot support a regression: the real trend-line
  // kernel returns null (the genuine insufficient-data signal).
  const buyObj = GRQProjection.getBuyPrice(MARKET.INSUFFICIENT, SCORE_DATE);
  assertExists(buyObj);
  const trendLine = GRQProjection.computeTrendLine(
    trendDataPoints(MARKET.INSUFFICIENT, buyObj.price, []),
  );
  assertEquals(trendLine, null);
});

Deno.test("Hybrid Projection - Target-Based Fallback", () => {
  const { projection, targetPercentage } = projectStock("VOLATILE", 150);
  assert(targetPercentage !== null);
  assertEquals(projection.projectionMethod, "target_based");
});

Deno.test("Hybrid Projection - Bounds Checking", () => {
  const { projection } = projectStock("STRONG_UP", 300);
  assert(projection.projected90DayPerformance <= 200);
  assert(projection.projected90DayPerformance >= -100);
});

Deno.test("Hybrid Projection - Confidence Levels", () => {
  const { projection } = projectStock("STRONG_UP", 120);
  assert(projection.confidence >= 0);
  assert(projection.confidence <= 1);
});

Deno.test("Hybrid Projection - Method Selection Logic", () => {
  const { projection } = projectStock("STRONG_UP", 120);
  const validMethods = ["dampened_trend", "target_based"];
  assert(validMethods.includes(projection.projectionMethod));
});

Deno.test("Hybrid Projection - Dividend Integration", () => {
  const { currentPerformance } = projectStock("STRONG_UP", 120);
  // STRONG_UP pays two dividends, so current performance includes them.
  assert(currentPerformance > 0);
});
