// Tests for the headless Trend-view prediction resolver (issue #430,
// milestone #422).
//
// docs/trend_predictions.js parses each matured score date's raw files (the
// score TSV, the market-data CSV and the dividend CSV) and resolves the
// per-stock { buyPrice, currentPrice, totalDividends, adjustedTarget } inputs
// the headless data engine (docs/trend_series.js) consumes. The resolver
// reuses ONLY the shared projection kernels (GRQProjection) — it adds no new
// actuals or target maths — so the Trend view's Actual / Target match the
// existing per-prediction dashboard exactly.
//
// These import the REAL shipped helpers and assert on their observable output
// with small, hand-computable fixtures.
import { assertAlmostEquals, assertEquals } from "@std/assert";
import "../docs/projection.js";
import "../docs/volume_recommend.js";
import "../docs/trend_series.js";
import "../docs/trend_predictions.js";

interface ResolvedStock {
  buyPrice: number | null;
  currentPrice: number | null;
  totalDividends: number;
  adjustedTarget: number | null;
}

interface ScoreRow {
  stock: string;
  score: number;
  target: number;
}

const g = globalThis as unknown as {
  GRQTrendPredictions: {
    parseScoreTsv: (text: string) => ScoreRow[];
    parseMarketCsv: (text: string) => Record<string, unknown[]>;
    parseDividendCsv: (text: string) => Record<string, unknown[]>;
    resolvePredictionStocks: (
      scoreRows: ScoreRow[],
      marketData: Record<string, unknown[]>,
      dividendData: Record<string, unknown[]>,
      scoreDate: Date,
    ) => ResolvedStock[];
    buildPrediction: (
      date: string,
      tsvText: string,
      csvText: string,
      dividendCsvText: string,
    ) => { date: string; stocks: ResolvedStock[] };
    currentPriceWithinWindow: (
      points: unknown[],
      scoreDate: Date,
    ) => number | null;
  };
  GRQTrendSeries: {
    buildMaturedTrendSeries: (
      predictions: { date: string; stocks: ResolvedStock[] }[],
      today: Date,
    ) => { date: Date; actualPct: number; targetPct: number; count: number }[];
  };
};
const Predictions = g.GRQTrendPredictions;
const Trend = g.GRQTrendSeries;

// Score date 2024-10-15. Its 90-day window ends ~2025-01-13.
const SCORE_DATE_STR = "2024-10-15";
const SCORE_DATE = new Date(2024, 9, 15); // local midnight, month 9 = October

const TSV = [
  "Stock\tScore\tTarget\tExDividendDate\tDividendPerShare\tNotes",
  "NYSE:AAA\t0.9\t120\t\t\t",
  "NYSE:BBB\t0.8\t90\t\t\t",
  // CCC has no market data → excluded from the portfolio aggregates.
  "NYSE:CCC\t0.7\t50\t\t\t",
].join("\n");

const CSV = [
  "date,ticker,high,low,open,close,split_coefficient",
  // AAA: buy midpoint 100 on the score date; current midpoint 110 at day ~87.
  "2024-10-15,NYSE:AAA,102,98,100,100,1.0",
  "2025-01-10,NYSE:AAA,112,108,110,110,1.0",
  // A later point outside the 90-day window must be ignored for "current".
  "2025-02-15,NYSE:AAA,202,198,200,200,1.0",
  // BBB: buy midpoint 50; current midpoint 45.
  "2024-10-15,NYSE:BBB,51,49,50,50,1.0",
  "2025-01-10,NYSE:BBB,46,44,45,45,1.0",
].join("\n");

const DIVIDENDS = [
  "exDividendDate,ticker,amount",
  // Within 90 days → counted (2.0 on a 100 buy price = +2%).
  "2024-11-01,NYSE:AAA,2",
  // Outside 90 days → excluded.
  "2025-03-01,NYSE:AAA,5",
].join("\n");

Deno.test("parseScoreTsv - parses stock rows and numeric target", () => {
  const rows = Predictions.parseScoreTsv(TSV);
  assertEquals(rows.length, 3);
  assertEquals(rows[0].stock, "NYSE:AAA");
  assertEquals(rows[0].target, 120);
  assertEquals(rows[1].stock, "NYSE:BBB");
});

Deno.test("parseMarketCsv - groups points by ticker", () => {
  const map = Predictions.parseMarketCsv(CSV);
  assertEquals(Object.keys(map).sort(), ["NYSE:AAA", "NYSE:BBB"]);
  assertEquals(map["NYSE:AAA"].length, 3);
  assertEquals(map["NYSE:BBB"].length, 2);
});

Deno.test("parseDividendCsv - groups dividends by ticker", () => {
  const map = Predictions.parseDividendCsv(DIVIDENDS);
  assertEquals(map["NYSE:AAA"].length, 2);
});

Deno.test("resolvePredictionStocks - resolves buy/current/dividends/target", () => {
  const scoreRows = Predictions.parseScoreTsv(TSV);
  const marketData = Predictions.parseMarketCsv(CSV);
  const dividendData = Predictions.parseDividendCsv(DIVIDENDS);
  const stocks = Predictions.resolvePredictionStocks(
    scoreRows,
    marketData,
    dividendData,
    SCORE_DATE,
  );
  assertEquals(stocks.length, 3);

  // AAA: buy 100, current 110 (the day-87 point, NOT the day-120 point),
  // dividends 2 within window, target adjusted 120 (no split).
  assertAlmostEquals(stocks[0].buyPrice as number, 100);
  assertAlmostEquals(stocks[0].currentPrice as number, 110);
  assertAlmostEquals(stocks[0].totalDividends, 2);
  assertAlmostEquals(stocks[0].adjustedTarget as number, 120);

  // BBB: buy 50, current 45, no dividends, target 90.
  assertAlmostEquals(stocks[1].buyPrice as number, 50);
  assertAlmostEquals(stocks[1].currentPrice as number, 45);
  assertAlmostEquals(stocks[1].totalDividends, 0);
  assertAlmostEquals(stocks[1].adjustedTarget as number, 90);

  // CCC: no market data → both prices null so the inclusion gate drops it.
  assertEquals(stocks[2].buyPrice, null);
  assertEquals(stocks[2].currentPrice, null);
});

Deno.test("resolvePredictionStocks - Actual/Target match the shared kernels", () => {
  const prediction = Predictions.buildPrediction(
    SCORE_DATE_STR,
    TSV,
    CSV,
    DIVIDENDS,
  );
  // Today well past maturity so the score date is included.
  const today = new Date(2025, 5, 1);
  const series = Trend.buildMaturedTrendSeries([prediction], today);
  assertEquals(series.length, 1);
  // Actual = mean(AAA 12%, BBB -10%) = 1%; CCC excluded.
  assertAlmostEquals(series[0].actualPct, 1, 1e-9);
  // Target = mean(AAA 20%, BBB 80%) = 50%.
  assertAlmostEquals(series[0].targetPct, 50, 1e-9);
  // Count = the two included stocks.
  assertEquals(series[0].count, 2);
});

// Issue #569: a reconcilable split that falls AFTER the 90-day horizon but
// before the end of the data series must NOT distort the Actual. getBuyPrice
// restates the buy price into current (end-of-series) split terms, so the
// horizon Actual must read on that same current basis. The raw horizon midpoint
// carries the spurious post-horizon split factor; currentPriceWithinWindow must
// divide it out.
const SPLIT_TSV = [
  "Stock\tScore\tTarget\tExDividendDate\tDividendPerShare\tNotes",
  "NYSE:SPL\t0.9\t120\t\t\t",
].join("\n");

// Score 2024-10-15 -> 90-day horizon ~2025-01-13. A clean 2:1 forward split on
// 2025-03-01 (AFTER the horizon): mid halves 120 -> 60, so the price-ratio
// cross-check reconciles (120 / 60 == 2).
const SPLIT_CSV = [
  "date,ticker,high,low,open,close,split_coefficient",
  "2024-10-15,NYSE:SPL,102,98,100,100,1.0", // buy midpoint 100
  "2025-01-10,NYSE:SPL,122,118,120,120,1.0", // horizon midpoint 120 (raw)
  "2025-03-01,NYSE:SPL,61,59,60,60,2.0", // post-horizon 2:1 forward split
].join("\n");

Deno.test("currentPriceWithinWindow - restates the horizon midpoint onto the current split basis (issue #569)", () => {
  const market = Predictions.parseMarketCsv(SPLIT_CSV);
  const current = Predictions.currentPriceWithinWindow(
    market["NYSE:SPL"],
    SCORE_DATE,
  );
  // Raw horizon midpoint 120 / post-horizon split factor 2.0 = 60, matching the
  // current (end-of-series) basis the buy price uses.
  assertAlmostEquals(current as number, 60);
});

Deno.test("currentPriceWithinWindow - unchanged when no post-horizon split follows", () => {
  // Drop the post-horizon split row: the horizon midpoint stays raw (110).
  const current = Predictions.currentPriceWithinWindow(
    Predictions.parseMarketCsv(CSV)["NYSE:AAA"],
    SCORE_DATE,
  );
  assertAlmostEquals(current as number, 110);
});

Deno.test("currentPriceWithinWindow - returns null with no usable points", () => {
  assertEquals(Predictions.currentPriceWithinWindow([], SCORE_DATE), null);
});

Deno.test("resolvePredictionStocks - Actual reads the post-horizon split on the buy price basis (issue #569)", () => {
  const scoreRows = Predictions.parseScoreTsv(SPLIT_TSV);
  const marketData = Predictions.parseMarketCsv(SPLIT_CSV);
  const stocks = Predictions.resolvePredictionStocks(
    scoreRows,
    marketData,
    {},
    SCORE_DATE,
  );
  // Buy price restated to current terms: 100 / 2 = 50.
  assertAlmostEquals(stocks[0].buyPrice as number, 50);
  // Current price on the SAME current basis: 120 / 2 = 60 (NOT the raw 120).
  assertAlmostEquals(stocks[0].currentPrice as number, 60);
});

Deno.test("buildPrediction - tolerates missing dividend data", () => {
  const prediction = Predictions.buildPrediction(SCORE_DATE_STR, TSV, CSV, "");
  assertEquals(prediction.date, SCORE_DATE_STR);
  // AAA still resolves; just no dividends counted.
  assertAlmostEquals(prediction.stocks[0].totalDividends, 0);
  assertAlmostEquals(prediction.stocks[0].currentPrice as number, 110);
});
