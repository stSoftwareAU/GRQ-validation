// Regression tests for issue #569: the dashboard's Actual 90-day return must
// read the horizon price on the SAME current (end-of-series) split basis as the
// buy price.
//
// `getBuyPrice` restates the score-date midpoint into current split terms, but
// the two shipped Actual readers used to take the horizon midpoint RAW:
//   - PortfolioCalculator.getStockReturnBreakdown (docs/portfolio_calc.js)
//   - currentPriceWithinWindow (docs/trend_predictions.js)
// When a reconcilable split falls BETWEEN the 90-day horizon and the data end,
// the raw midpoint carries a spurious post-horizon split factor that the buy
// price has already cancelled, distorting the displayed Actual. Both readers now
// divide the raw midpoint by GRQProjection.postHorizonSplitFactor (via the
// horizonPriceCurrentBasis kernel) so the Actual shares the buy price's basis.
//
// These exercise the REAL shipped code: the trend reader and the dashboard's
// PortfolioCalculator (docs/portfolio_calc.js, issue #881) are imported and
// called directly — not a copy or a grep.

import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import "../docs/projection.js";
import "../docs/volume_recommend.js";
import "../docs/trend_predictions.js";
import "../docs/portfolio_calc.js";

// deno-lint-ignore no-explicit-any
const P = (globalThis as any).GRQProjection;
// deno-lint-ignore no-explicit-any
const Trend = (globalThis as any).GRQTrendPredictions;
// deno-lint-ignore no-explicit-any
const Calc = (globalThis as any).GRQPortfolioCalc;

function midnight(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

interface MarketPoint {
  date: Date;
  high: number;
  low: number;
  open: number;
  close: number;
  splitCoefficient: number;
}

// A flat OHLC point with an optional split coefficient (mid == price).
function pt(date: string, price: number, splitCoefficient = 1.0): MarketPoint {
  return {
    date: midnight(date),
    high: price,
    low: price,
    open: price,
    close: price,
    splitCoefficient,
  };
}

const SCORE = midnight("2026-01-01"); // horizon 2026-04-01

// Score 2026-01-01 -> horizon 2026-04-01. A clean 2:1 forward split on 05-15,
// AFTER the horizon but BEFORE the data end: the horizon mid (120) sits on the
// pre-split basis while the buy price (100) is restated to the post-split basis.
function marketWithPostHorizonSplit(): MarketPoint[] {
  return [
    pt("2026-01-02", 100), // buy point
    pt("2026-03-30", 120), // horizon point (last <= 2026-04-01)
    pt("2026-05-15", 60, 2.0), // post-horizon 2:1 forward split
  ];
}

// A reverse 1:2 split after the horizon: the horizon mid is deflated relative to
// the buy price unless restated.
function marketWithPostHorizonReverseSplit(): MarketPoint[] {
  return [
    pt("2026-01-02", 100),
    pt("2026-03-30", 120),
    pt("2026-05-15", 240, 0.5),
  ];
}

// --- docs/trend_predictions.js: currentPriceWithinWindow ---------------------

Deno.test("currentPriceWithinWindow restates the horizon mid onto the current basis (forward split)", () => {
  const market = marketWithPostHorizonSplit();
  // Raw mid is 120; the buy price's current basis halves it to 60.
  assertAlmostEquals(Trend.currentPriceWithinWindow(market, SCORE), 60);
  // It must agree with the shared kernel the buy price's basis comes from.
  assertAlmostEquals(
    Trend.currentPriceWithinWindow(market, SCORE),
    P.horizonPriceCurrentBasis(market, SCORE),
  );
});

Deno.test("currentPriceWithinWindow restates a reverse post-horizon split", () => {
  const market = marketWithPostHorizonReverseSplit();
  // Raw mid 120, factor 0.5 -> 240 on the current basis.
  assertAlmostEquals(Trend.currentPriceWithinWindow(market, SCORE), 240);
});

Deno.test("currentPriceWithinWindow is unchanged when no split follows the horizon", () => {
  const market = [pt("2026-01-02", 100), pt("2026-03-30", 120)];
  // No post-horizon split -> still the raw horizon midpoint.
  assertAlmostEquals(Trend.currentPriceWithinWindow(market, SCORE), 120);
});

Deno.test("currentPriceWithinWindow returns null with no usable point", () => {
  assertEquals(Trend.currentPriceWithinWindow([], SCORE), null);
  assertEquals(Trend.currentPriceWithinWindow(undefined, SCORE), null);
  // Only points strictly AFTER the horizon -> dropped by the inclusion gate.
  assertEquals(
    Trend.currentPriceWithinWindow([pt("2026-09-01", 10)], SCORE),
    null,
  );
});

Deno.test("resolvePredictionStocks Actual and buy price share the current basis", () => {
  const scoreRows = [{ stock: "NYSE:AAA", score: 0.9, target: 200 }];
  const market = { "NYSE:AAA": marketWithPostHorizonSplit() };
  const [resolved] = Trend.resolvePredictionStocks(
    scoreRows,
    market,
    {},
    SCORE,
  );
  // Buy price restated to current terms: raw 100 / 2.0 = 50.
  assertAlmostEquals(resolved.buyPrice, 50);
  // Actual now on the SAME basis: raw 120 / 2.0 = 60 (a +20% real move),
  // NOT the raw 120 that would read as a spurious +140%.
  assertAlmostEquals(resolved.currentPrice, 60);
  const priceReturn =
    ((resolved.currentPrice - resolved.buyPrice) / resolved.buyPrice) * 100;
  assertAlmostEquals(priceReturn, 20);
});

// --- docs/portfolio_calc.js: getStockReturnBreakdown -------------------------

// The dashboard's calculations live in the DOM-free PortfolioCalculator
// (issue #881), so the REAL shipped methods run here against a plain fixture
// source — no DOM, no source extraction.
interface Breakdown {
  buyPrice: number;
  currentPrice: number;
  totalDividends: number;
  priceReturn: number;
  dividendReturn: number;
  totalReturn: number;
}

interface Calculator {
  getStockReturnBreakdown(stock: unknown, scoreDate: Date): Breakdown | null;
  calculateStockPerformance(stock: unknown): number | null;
}

function calculator(market: MarketPoint[]): Calculator {
  return new Calc.PortfolioCalculator({
    marketData: { "NYSE:AAA": market },
    dividendData: {},
    scoreData: [{ stock: "NYSE:AAA" }],
    analysisData: null,
    // Parses to SCORE (2026-01-01, local midnight).
    selectedFile: "2026/January/01.tsv",
    costOfCapital: 10,
    chartWindowDays: () => 90,
  });
}

Deno.test("getStockReturnBreakdown reads the Actual on the buy price's current basis (forward split)", () => {
  const result = calculator(marketWithPostHorizonSplit())
    .getStockReturnBreakdown({ stock: "NYSE:AAA" }, SCORE);
  assert(result !== null);
  // Buy price restated to current terms: 100 / 2.0 = 50.
  assertAlmostEquals(result!.buyPrice, 50);
  // Actual on the same basis: 120 / 2.0 = 60, NOT the raw 120.
  assertAlmostEquals(result!.currentPrice, 60);
  // The real economic move is +20%, not the spurious +140%.
  assertAlmostEquals(result!.priceReturn, 20);
});

Deno.test("getStockReturnBreakdown is unchanged when no split follows the horizon", () => {
  const result = calculator([pt("2026-01-02", 100), pt("2026-03-30", 120)])
    .getStockReturnBreakdown({ stock: "NYSE:AAA" }, SCORE);
  assert(result !== null);
  assertAlmostEquals(result!.buyPrice, 100);
  assertAlmostEquals(result!.currentPrice, 120);
  assertAlmostEquals(result!.priceReturn, 20);
});

Deno.test("getStockReturnBreakdown returns null when no point falls on/before the horizon", () => {
  const result = calculator([pt("2026-09-01", 10)])
    .getStockReturnBreakdown({ stock: "NYSE:AAA" }, SCORE);
  assertEquals(result, null);
});

// --- docs/portfolio_calc.js: calculateStockPerformance -----------------------
// The twin 90-day return that feeds the Return-above-cost-of-capital, judgement
// and projection surfaces. It must stay on the SAME current basis as the Actual
// (issue #569) so the two cannot disagree for a stock that splits post-horizon.

Deno.test("calculateStockPerformance restates the horizon onto the buy price's basis (forward split)", () => {
  const calc = calculator(marketWithPostHorizonSplit());
  // (60 - 50) / 50 * 100 = +20%, NOT the spurious +140% from the raw 120.
  assertAlmostEquals(
    calc.calculateStockPerformance({ stock: "NYSE:AAA" })!,
    20,
  );
});

Deno.test("calculateStockPerformance is unchanged when no split follows the horizon", () => {
  const calc = calculator([pt("2026-01-02", 100), pt("2026-03-30", 120)]);
  assertAlmostEquals(
    calc.calculateStockPerformance({ stock: "NYSE:AAA" })!,
    20,
  );
});

Deno.test("calculateStockPerformance and getStockReturnBreakdown agree on the same basis", () => {
  const calc = calculator(marketWithPostHorizonSplit());
  const a = calc.calculateStockPerformance({ stock: "NYSE:AAA" });
  const b = calc.getStockReturnBreakdown({ stock: "NYSE:AAA" }, SCORE);
  assert(b !== null);
  assertAlmostEquals(a!, b!.totalReturn);
});
