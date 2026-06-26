// Low-volume exclusion tests (issue #577).
//
// A name flagged low-volume by the shared GRQVolume.volumeRecommend helper
// (#576) must be excluded from portfolio membership AND from every aggregate
// (equal-weight) average, so it neither helps nor hurts the "Actual"/Target
// lines. Liquid names are unaffected, and when volume is unknown
// (pre-volume-column CSVs) NO name is flagged.
//
// These exercise the REAL shipped kernels: the inclusion predicate and the
// aggregate kernels in docs/projection.js, plus the Trend-view resolver in
// docs/trend_predictions.js that wires the volume window into a `lowVolume`
// flag. The dashboard glue (app.js) routes through the same predicate via
// isStockPriceable, so these assertions pin the shared behaviour.
import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import "../docs/projection.js";
import "../docs/volume_recommend.js";
import "../docs/trend_series.js";
import "../docs/trend_predictions.js";

interface ResolvedStock {
  buyPrice: number | null;
  currentPrice: number | null;
  totalDividends: number;
  adjustedTarget: number | null;
  splitReliable?: boolean;
  lowVolume?: boolean;
}

const g = globalThis as unknown as {
  GRQProjection: {
    isStockIncluded: (
      buyPrice: number | null | undefined,
      currentPrice: number | null | undefined,
      splitReliable?: boolean,
      lowVolume?: boolean,
    ) => boolean;
    calculateIncludedPortfolioPerformance: (
      stocks: ResolvedStock[],
    ) => number | null;
    calculatePortfolioTargetPercentage: (stocks: ResolvedStock[]) => number;
    calculateIncludedPortfolioDividendYield: (
      stocks: ResolvedStock[],
    ) => number | null;
  };
  GRQTrendPredictions: {
    parseScoreTsv: (text: string) => Array<{ stock: string; target: number }>;
    parseMarketCsv: (text: string) => Record<string, unknown[]>;
    parseDividendCsv: (text: string) => Record<string, unknown[]>;
    resolvePredictionStocks: (
      scoreRows: Array<{ stock: string; target: number }>,
      marketData: Record<string, unknown[]>,
      dividendData: Record<string, unknown[]>,
      scoreDate: Date,
    ) => ResolvedStock[];
  };
};

const GRQProjection = g.GRQProjection;
const GRQTrendPredictions = g.GRQTrendPredictions;

Deno.test("isStockIncluded drops a low-volume name (lowVolume=true)", () => {
  // Fully priceable, split-reliable — only the low-volume flag excludes it.
  assertEquals(GRQProjection.isStockIncluded(10, 12, true, false), true);
  assertEquals(GRQProjection.isStockIncluded(10, 12, true, true), false);
});

Deno.test("isStockIncluded defaults lowVolume to false (unknown ⇒ included)", () => {
  // Back-compat: callers that pass no lowVolume argument keep the old
  // behaviour, so an unknown-volume name is never accidentally excluded.
  assertEquals(GRQProjection.isStockIncluded(10, 12, true), true);
});

Deno.test("low-volume name is excluded from the equal-weight Actual aggregate", () => {
  // Two liquid names at +10% and +30% (mean +20%) plus one illiquid name at
  // +200% that would massively skew the equal-weight Actual if counted.
  const stocks: ResolvedStock[] = [
    {
      buyPrice: 100,
      currentPrice: 110,
      totalDividends: 0,
      adjustedTarget: 120,
    },
    {
      buyPrice: 100,
      currentPrice: 130,
      totalDividends: 0,
      adjustedTarget: 120,
    },
    {
      buyPrice: 100,
      currentPrice: 300,
      totalDividends: 0,
      adjustedTarget: 120,
      lowVolume: true,
    },
  ];
  const actual = GRQProjection.calculateIncludedPortfolioPerformance(stocks);
  // Excluding the illiquid name leaves (10 + 30) / 2 = 20%, NOT (10+30+200)/3.
  assertAlmostEquals(actual as number, 20, 1e-9);
});

Deno.test("low-volume name is excluded from the Target and dividend aggregates", () => {
  const stocks: ResolvedStock[] = [
    {
      buyPrice: 100,
      currentPrice: 110,
      totalDividends: 5,
      adjustedTarget: 120,
    },
    {
      buyPrice: 100,
      currentPrice: 130,
      totalDividends: 50,
      adjustedTarget: 300,
      lowVolume: true,
    },
  ];
  // Only the liquid name counts: target % = (120-100)/100 = 20%.
  assertAlmostEquals(
    GRQProjection.calculatePortfolioTargetPercentage(stocks),
    20,
    1e-9,
  );
  // Dividend yield = 5/100 = 5% (the illiquid 50% name is dropped).
  assertAlmostEquals(
    GRQProjection.calculateIncludedPortfolioDividendYield(stocks) as number,
    5,
    1e-9,
  );
});

// --- End-to-end through the Trend-view resolver, using an 8-column CSV that
// carries the volume column. A known-illiquid synthetic fixture must be flagged
// and removed; the liquid fixture must be unaffected. ---

const SCORE_DATE = new Date(2025, 0, 17); // 2025-01-17, a date present below

function dailyRows(
  ticker: string,
  price: number,
  volume: number | "",
): string {
  // 12 daily rows of flat data ending ON the score date (so getBuyPrice
  // resolves), 8-column shape
  // (date,ticker,high,low,open,close,split_coefficient,volume).
  const rows: string[] = [];
  for (let day = 6; day <= 17; day++) {
    const d = `2025-01-${String(day).padStart(2, "0")}`;
    rows.push(
      `${d},${ticker},${price + 1},${price},${price},${price},1.0,${volume}`,
    );
  }
  // A point inside the 90-day window so currentPrice resolves.
  rows.push(
    `2025-04-10,${ticker},${
      price + 1
    },${price},${price},${price},1.0,${volume}`,
  );
  return rows.join("\n");
}

Deno.test("illiquid synthetic fixture is flagged and removed; liquid name unaffected", () => {
  const header = "date,ticker,high,low,open,close,split_coefficient,volume";
  // LIQUID: $50 * 1,000,000 shares = $50,000,000/day >> $10,000 budget.
  // ILLIQUID: $4 * 500 shares = $2,000/day << budget.
  const csv = [
    header,
    dailyRows("NYSE:LIQUID", 50, 1_000_000),
    dailyRows("NYSE:ILLIQ", 4, 500),
  ].join("\n");

  const scoreTsv = "stock\ttarget\nNYSE:LIQUID\t60\nNYSE:ILLIQ\t8";
  const market = GRQTrendPredictions.parseMarketCsv(csv);
  const rows = GRQTrendPredictions.parseScoreTsv(scoreTsv);
  const stocks = GRQTrendPredictions.resolvePredictionStocks(
    rows,
    market,
    {},
    SCORE_DATE,
  );

  const liquid = stocks.find((_s, i) => rows[i].stock === "NYSE:LIQUID");
  const illiquid = stocks.find((_s, i) => rows[i].stock === "NYSE:ILLIQ");

  // The illiquid fixture is flagged; the liquid one is not.
  assertEquals(illiquid?.lowVolume, true);
  assertEquals(liquid?.lowVolume, false);

  // The illiquid fixture is dropped from the inclusion predicate...
  assert(
    !GRQProjection.isStockIncluded(
      illiquid?.buyPrice,
      illiquid?.currentPrice,
      illiquid?.splitReliable,
      illiquid?.lowVolume,
    ),
  );
  // ...while the liquid fixture remains included.
  assert(
    GRQProjection.isStockIncluded(
      liquid?.buyPrice,
      liquid?.currentPrice,
      liquid?.splitReliable,
      liquid?.lowVolume,
    ),
  );

  // And the equal-weight Actual is computed over the liquid name ONLY.
  const actual = GRQProjection.calculateIncludedPortfolioPerformance(stocks);
  assertAlmostEquals(actual as number, 0, 1e-9); // LIQUID buy==current ⇒ 0%
});

Deno.test("pre-volume-column CSV (no volume) flags nothing — no mass-exclusion", () => {
  // 7-column legacy shape: volume cells are empty across the whole window.
  const header = "date,ticker,high,low,open,close,split_coefficient,volume";
  const csv = [
    header,
    dailyRows("NYSE:ILLIQ", 4, ""), // empty volume cells
  ].join("\n");
  const scoreTsv = "stock\ttarget\nNYSE:ILLIQ\t8";
  const market = GRQTrendPredictions.parseMarketCsv(csv);
  const rows = GRQTrendPredictions.parseScoreTsv(scoreTsv);
  const stocks = GRQTrendPredictions.resolvePredictionStocks(
    rows,
    market,
    {},
    SCORE_DATE,
  );
  // Unknown volume ⇒ NOT flagged (insufficient data), so the name is still
  // included on its price merits — historical dates are not mass-excluded.
  assertEquals(stocks[0].lowVolume, false);
  assert(
    GRQProjection.isStockIncluded(
      stocks[0].buyPrice,
      stocks[0].currentPrice,
      stocks[0].splitReliable,
      stocks[0].lowVolume,
    ),
  );
});
