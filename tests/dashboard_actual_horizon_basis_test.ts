// Regression tests for issue #569: the dashboard's Actual 90-day return must
// read the horizon price on the SAME current (end-of-series) split basis as the
// buy price.
//
// `getBuyPrice` restates the score-date midpoint into current split terms, but
// the two shipped Actual readers used to take the horizon midpoint RAW:
//   - GRQValidator.getStockReturnBreakdown (docs/app.js)
//   - currentPriceWithinWindow (docs/trend_predictions.js)
// When a reconcilable split falls BETWEEN the 90-day horizon and the data end,
// the raw midpoint carries a spurious post-horizon split factor that the buy
// price has already cancelled, distorting the displayed Actual. Both readers now
// divide the raw midpoint by GRQProjection.postHorizonSplitFactor (via the
// horizonPriceCurrentBasis kernel) so the Actual shares the buy price's basis.
//
// These exercise the REAL shipped code: the trend reader is imported and called
// directly; the app.js method is extracted from source and executed with a fake
// `this`, so the assertions run the actual function body — not a copy or a grep.

import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import "../docs/projection.js";
import "../docs/trend_predictions.js";

// deno-lint-ignore no-explicit-any
const P = (globalThis as any).GRQProjection;
// deno-lint-ignore no-explicit-any
const Trend = (globalThis as any).GRQTrendPredictions;

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

// --- docs/app.js: getStockReturnBreakdown ------------------------------------

// Extract a class method body from app.js source and rebuild it as a callable
// function so the test runs the REAL shipped body (app.js bootstraps a live DOM
// at import time and cannot be imported headlessly). Brace-matched, not grepped.
function extractMethod(src: string, signature: string): string {
  // Match the DEFINITION signature exactly (call sites share the bare name).
  const start = src.indexOf(signature);
  if (start === -1) throw new Error(`method ${signature} not found`);
  const open = src.indexOf("{", start);
  if (open === -1) throw new Error(`opening brace for ${name} not found`);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error(`unterminated body for ${signature}`);
}

async function loadBreakdown() {
  const src = await Deno.readTextFile(
    new URL("../docs/app.js", import.meta.url),
  );
  const body = extractMethod(
    src,
    "getStockReturnBreakdown(stock, scoreDate) {",
  );
  // GRQProjection is a free global in app.js; inject it as a closure param.
  const factory = new Function(
    "GRQProjection",
    `return function(stock, scoreDate) ${body};`,
  );
  return factory(P) as (stock: unknown, scoreDate: Date) => {
    buyPrice: number;
    currentPrice: number;
    totalDividends: number;
    priceReturn: number;
    dividendReturn: number;
    totalReturn: number;
  } | null;
}

function fakeValidator(market: MarketPoint[]) {
  return {
    marketData: { "NYSE:AAA": market } as Record<string, MarketPoint[]>,
    selectedFile: "2026/January/01.tsv",
    getScoreDate(_file: string) {
      return SCORE;
    },
    getBuyPrice(symbol: string, scoreDate: Date) {
      return P.getBuyPrice(this.marketData[symbol], scoreDate);
    },
    getDividendsWithin90Days(_symbol: string) {
      return [];
    },
  };
}

Deno.test("getStockReturnBreakdown reads the Actual on the buy price's current basis (forward split)", async () => {
  const breakdown = await loadBreakdown();
  const ctx = fakeValidator(marketWithPostHorizonSplit());
  const result = breakdown.call(ctx, { stock: "NYSE:AAA" }, SCORE);
  assert(result !== null);
  // Buy price restated to current terms: 100 / 2.0 = 50.
  assertAlmostEquals(result!.buyPrice, 50);
  // Actual on the same basis: 120 / 2.0 = 60, NOT the raw 120.
  assertAlmostEquals(result!.currentPrice, 60);
  // The real economic move is +20%, not the spurious +140%.
  assertAlmostEquals(result!.priceReturn, 20);
});

Deno.test("getStockReturnBreakdown is unchanged when no split follows the horizon", async () => {
  const breakdown = await loadBreakdown();
  const ctx = fakeValidator([pt("2026-01-02", 100), pt("2026-03-30", 120)]);
  const result = breakdown.call(ctx, { stock: "NYSE:AAA" }, SCORE);
  assert(result !== null);
  assertAlmostEquals(result!.buyPrice, 100);
  assertAlmostEquals(result!.currentPrice, 120);
  assertAlmostEquals(result!.priceReturn, 20);
});

Deno.test("getStockReturnBreakdown returns null when no point falls on/before the horizon", async () => {
  const breakdown = await loadBreakdown();
  const ctx = fakeValidator([pt("2026-09-01", 10)]);
  const result = breakdown.call(ctx, { stock: "NYSE:AAA" }, SCORE);
  assertEquals(result, null);
});

// --- docs/app.js: calculateStockPerformance ----------------------------------
// The twin 90-day return that feeds the Return-above-cost-of-capital, judgement
// and projection surfaces. It must stay on the SAME current basis as the Actual
// (issue #569) so the two cannot disagree for a stock that splits post-horizon.

async function loadStockPerformance() {
  const src = await Deno.readTextFile(
    new URL("../docs/app.js", import.meta.url),
  );
  const body = extractMethod(src, "calculateStockPerformance(stock) {");
  const factory = new Function(
    "GRQProjection",
    `return function(stock) ${body};`,
  );
  return factory(P) as (stock: unknown) => number | null;
}

Deno.test("calculateStockPerformance restates the horizon onto the buy price's basis (forward split)", async () => {
  const perf = await loadStockPerformance();
  const ctx = fakeValidator(marketWithPostHorizonSplit());
  // (60 - 50) / 50 * 100 = +20%, NOT the spurious +140% from the raw 120.
  assertAlmostEquals(perf.call(ctx, { stock: "NYSE:AAA" })!, 20);
});

Deno.test("calculateStockPerformance is unchanged when no split follows the horizon", async () => {
  const perf = await loadStockPerformance();
  const ctx = fakeValidator([pt("2026-01-02", 100), pt("2026-03-30", 120)]);
  assertAlmostEquals(perf.call(ctx, { stock: "NYSE:AAA" })!, 20);
});

Deno.test("calculateStockPerformance and getStockReturnBreakdown agree on the same basis", async () => {
  const perf = await loadStockPerformance();
  const breakdown = await loadBreakdown();
  const market = marketWithPostHorizonSplit();
  const a = perf.call(fakeValidator(market), { stock: "NYSE:AAA" });
  const b = breakdown.call(fakeValidator(market), { stock: "NYSE:AAA" }, SCORE);
  assert(b !== null);
  assertAlmostEquals(a!, b!.totalReturn);
});
