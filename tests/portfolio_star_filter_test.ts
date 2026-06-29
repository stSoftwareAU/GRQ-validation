// Portfolio min-star filter recompute + table/aggregate consistency tests
// (issue #655).
//
// When the optional minimum-star filter is active, the portfolio view must
// restrict BOTH the holdings table and every aggregate figure (chart line,
// target dot, totals row) to stocks whose combined rating `avgStars` meets the
// threshold, and recompute the aggregate over that filtered subset. With the
// filter off (threshold 0 / "All") the view is byte-for-byte unchanged.
//
// app.js is a classic browser script bound to the DOM, so — following the
// established pattern in portfolio_exclusion_test.ts — this mirror validator
// reproduces the production glue while delegating every numeric decision to the
// REAL shipped kernels in docs/projection.js (isStockIncluded,
// meetsStarThreshold, getBuyPrice, currentPriceFromLatest,
// calculatePerformanceReturn, calculateTargetPercentage). The mirror's
// isStockPriceable folds the star gate in exactly as docs/app.js does, so the
// table set and the aggregate set are computed from the SAME predicate and
// cannot diverge.
import { assertAlmostEquals, assertEquals } from "@std/assert";
import "../docs/projection.js";

interface StockData {
  stock: string;
  target: number;
}

interface MarketDataPoint {
  date: Date;
  high: number;
  low: number;
  open: number;
  close: number;
  splitCoefficient: number;
}

const g = globalThis as unknown as {
  GRQProjection: {
    isStockIncluded: (
      buyPrice: number | null | undefined,
      currentPrice: number | null | undefined,
      splitReliable?: boolean,
      lowVolume?: boolean,
      score?: number | null,
    ) => boolean;
    meetsStarThreshold: (
      avgStars: number | null | undefined,
      minStars: number,
    ) => boolean;
    currentPriceFromLatest: (
      marketData: MarketDataPoint[] | undefined,
    ) => number | null;
    getBuyPrice: (
      marketData: MarketDataPoint[] | undefined,
      scoreDate: Date,
    ) => { price: number; dateUsed: Date } | null;
    calculatePerformanceReturn: (
      buyPrice: number,
      currentPrice: number,
      totalDividends?: number,
    ) => number | null;
    calculateTargetPercentage: (
      buyPrice: number | null,
      adjustedTarget: number | null,
    ) => number | null;
  };
};
const GRQProjection = g.GRQProjection;

const SCORE_DATE = new Date(2025, 1, 18); // 18 February 2025.

// A flat OHLC bar so the midprice is trivially the supplied price.
function bar(date: Date, price: number): MarketDataPoint {
  return {
    date,
    high: price,
    low: price,
    open: price,
    close: price,
    splitCoefficient: 1.0,
  };
}

// Mirror of the relevant GRQValidator glue, with the star gate folded into
// isStockPriceable exactly as docs/app.js does (issue #655).
class PortfolioValidator {
  scoreData: StockData[] = [];
  marketData: Record<string, MarketDataPoint[]> = {};
  // analysisData[ticker].avgStars, populated by loadAnalysisData in production.
  analysisData: Record<string, { avgStars: number | null }> = {};
  minStars = 0; // The shared GRQStarFilter threshold (0 = All/off, 1..5).

  getScoreDate(): Date {
    return SCORE_DATE;
  }

  // Production: docs/app.js meetsStarFilter.
  meetsStarFilter(stockSymbol: string): boolean {
    const analysis = this.analysisData ? this.analysisData[stockSymbol] : null;
    const avgStars = analysis ? analysis.avgStars : null;
    return GRQProjection.meetsStarThreshold(avgStars, this.minStars);
  }

  // Production: docs/app.js isStockPriceable, star gate folded in.
  isStockPriceable(stockSymbol: string, scoreDate: Date): boolean {
    const buyPriceObj = GRQProjection.getBuyPrice(
      this.marketData[stockSymbol],
      scoreDate,
    );
    const buyPrice = buyPriceObj ? buyPriceObj.price : null;
    const currentPrice = GRQProjection.currentPriceFromLatest(
      this.marketData[stockSymbol],
    );
    return GRQProjection.isStockIncluded(buyPrice, currentPrice) &&
      this.meetsStarFilter(stockSymbol);
  }

  // Production: docs/app.js updateStockTable aggregate `stocksToShow` — star
  // failures are HIDDEN entirely, not struck through.
  stocksShownInTable(): string[] {
    return this.scoreData
      .filter((stock) => this.meetsStarFilter(stock.stock))
      .map((stock) => stock.stock);
  }

  // Production: docs/app.js calculatePortfolioPerformance90Day totals row.
  calculatePortfolioPerformance90Day(): number {
    const scoreDate = this.getScoreDate();
    const ninetyDayDate = new Date(
      scoreDate.getTime() + 90 * 24 * 60 * 60 * 1000,
    );
    let totalPerformance = 0;
    let validStocks = 0;

    this.scoreData.forEach((stock) => {
      if (!this.isStockPriceable(stock.stock, scoreDate)) return;
      const md = this.marketData[stock.stock];
      if (!md) return;
      const within90 = md.filter((p) => p.date <= ninetyDayDate);
      if (within90.length === 0) return;
      const last = within90[within90.length - 1];
      const currentPrice = (last.high + last.low) / 2;
      const buyPriceObj = GRQProjection.getBuyPrice(md, scoreDate);
      if (!buyPriceObj) return;
      const perf = GRQProjection.calculatePerformanceReturn(
        buyPriceObj.price,
        currentPrice,
        0,
      );
      if (perf !== null) {
        totalPerformance += perf;
        validStocks++;
      }
    });

    return validStocks > 0 ? totalPerformance / validStocks : 0;
  }

  // The set of stocks actually counted in the aggregate, for table/aggregate
  // agreement assertions.
  stocksCountedInAggregate(): string[] {
    const scoreDate = this.getScoreDate();
    return this.scoreData
      .filter((stock) => this.isStockPriceable(stock.stock, scoreDate))
      .map((stock) => stock.stock);
  }

  // Production: docs/app.js buildPortfolioTargetStocks -> shared kernel; the
  // star gate pre-filters the input set so the target dot recomputes over the
  // same subset.
  calculatePortfolioTargetPercentage(): number {
    const scoreDate = this.getScoreDate();
    let totalTarget = 0;
    let validStocks = 0;

    this.scoreData
      .filter((stock) => this.meetsStarFilter(stock.stock))
      .forEach((stock) => {
        const buyPriceObj = GRQProjection.getBuyPrice(
          this.marketData[stock.stock],
          scoreDate,
        );
        const buyPrice = buyPriceObj ? buyPriceObj.price : null;
        const currentPrice = GRQProjection.currentPriceFromLatest(
          this.marketData[stock.stock],
        );
        if (!GRQProjection.isStockIncluded(buyPrice, currentPrice)) return;
        if (stock.target === null || isNaN(stock.target)) return;
        const targetPercentage = GRQProjection.calculateTargetPercentage(
          buyPrice,
          stock.target,
        );
        if (targetPercentage !== null) {
          totalTarget += targetPercentage;
          validStocks++;
        }
      });

    return validStocks > 0 ? totalTarget / validStocks : 20.0;
  }
}

// Three rated stocks plus one unrated: A=5★, B=2★, C=4★, D=no rating.
function threeRatedOneUnrated(): PortfolioValidator {
  const v = new PortfolioValidator();
  v.scoreData = [
    { stock: "A", target: 15 },
    { stock: "B", target: 15 },
    { stock: "C", target: 15 },
    { stock: "D", target: 15 },
  ];
  v.marketData = {
    A: [bar(SCORE_DATE, 10), bar(new Date(2025, 2, 1), 12)], // +20%
    B: [bar(SCORE_DATE, 10), bar(new Date(2025, 2, 1), 14)], // +40%
    C: [bar(SCORE_DATE, 10), bar(new Date(2025, 2, 1), 16)], // +60%
    D: [bar(SCORE_DATE, 10), bar(new Date(2025, 2, 1), 20)], // +100%
  };
  v.analysisData = {
    A: { avgStars: 5 },
    B: { avgStars: 2 },
    C: { avgStars: 4 },
    D: { avgStars: null }, // no rating
  };
  return v;
}

// --- filter off (default) ⇒ unchanged --------------------------------------

Deno.test("star filter off (0) ⇒ every stock shown and counted (unchanged)", () => {
  const v = threeRatedOneUnrated();
  v.minStars = 0;
  assertEquals(v.stocksShownInTable(), ["A", "B", "C", "D"]);
  assertEquals(v.stocksCountedInAggregate(), ["A", "B", "C", "D"]);
  // Mean of +20, +40, +60, +100 = +55%.
  assertAlmostEquals(v.calculatePortfolioPerformance90Day(), 55, 1e-9);
});

// --- active threshold restricts table AND aggregate to the same subset -----

Deno.test("star filter ≥4 ⇒ table and aggregate restrict to the same subset", () => {
  const v = threeRatedOneUnrated();
  v.minStars = 4; // A(5) and C(4) pass; B(2) and D(none) drop.
  const shown = v.stocksShownInTable();
  const counted = v.stocksCountedInAggregate();
  assertEquals(shown, ["A", "C"], "table shows only ≥4★ rated stocks");
  assertEquals(counted, ["A", "C"], "aggregate counts only ≥4★ rated stocks");
  assertEquals(shown, counted, "table and aggregate agree under the filter");
});

Deno.test("star filter ≥4 ⇒ aggregate recomputes over the filtered subset", () => {
  const v = threeRatedOneUnrated();
  v.minStars = 4;
  // Recompute over A(+20%) and C(+60%) only: mean = +40%, not the +55% full set.
  assertAlmostEquals(v.calculatePortfolioPerformance90Day(), 40, 1e-9);
});

Deno.test("star filter ≥4 ⇒ target dot recomputes over the same subset", () => {
  const v = threeRatedOneUnrated();
  v.minStars = 4;
  // A and C both buy at 10, target 15 ⇒ +50% each ⇒ portfolio target +50%.
  assertAlmostEquals(v.calculatePortfolioTargetPercentage(), 50, 1e-9);
});

// --- no-rating exclusion ----------------------------------------------------

Deno.test("active filter hides no-rating stocks from the table and aggregate", () => {
  const v = threeRatedOneUnrated();
  v.minStars = 1; // "1★+" — every rated stock passes, D (no rating) is hidden.
  assertEquals(v.stocksShownInTable(), ["A", "B", "C"], "D hidden from table");
  assertEquals(
    v.stocksCountedInAggregate(),
    ["A", "B", "C"],
    "D excluded from aggregate",
  );
  // Mean of +20, +40, +60 = +40% (D's +100% no longer drags it up).
  assertAlmostEquals(v.calculatePortfolioPerformance90Day(), 40, 1e-9);
});

Deno.test("threshold above every rating ⇒ empty table and zeroed aggregate", () => {
  const v = threeRatedOneUnrated();
  v.minStars = 5; // Only A(5) qualifies.
  assertEquals(v.stocksShownInTable(), ["A"]);
  assertEquals(v.stocksCountedInAggregate(), ["A"]);
  assertAlmostEquals(v.calculatePortfolioPerformance90Day(), 20, 1e-9);
});

// --- star gate composes with the existing priceable/exclusion gates --------

Deno.test("star gate composes with the unpriceable exclusion", () => {
  const v = threeRatedOneUnrated();
  // C is 4★ but becomes unpriceable (no market data) — it must drop from the
  // aggregate even though it clears the star threshold.
  v.marketData.C = [];
  v.minStars = 4;
  assertEquals(
    v.stocksShownInTable(),
    ["A", "C"],
    "table still shows C (struck through in production), star-filtered set",
  );
  assertEquals(
    v.stocksCountedInAggregate(),
    ["A"],
    "C is excluded from the aggregate by the priceable gate",
  );
});
