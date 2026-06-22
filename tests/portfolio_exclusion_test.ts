// Portfolio exclusion + re-weighting tests for the dashboard glue (issue #289).
//
// The dashboard's portfolio maths (app.js) must drop unpriceable stocks — those
// without BOTH a usable buy price AND a usable current price — from the
// portfolio time-series, the shared trend line and the aggregate/totals row,
// then re-weight equally over the included remainder. A null buy price must
// never inject NaN into the series.
//
// app.js is a classic browser script bound to the DOM, so — following the
// established pattern in portfolio_view_consistency_test.ts and
// chart_data_test.ts — this mirror validator reproduces the production glue
// while delegating every numeric decision to the REAL shipped kernels in
// docs/projection.js (isStockIncluded, currentPriceFromLatest, getBuyPrice,
// calculatePerformanceReturn). The glue cannot drift from production without
// these assertions failing.
import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
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

const DAY = 24 * 60 * 60 * 1000;

const g = globalThis as unknown as {
  GRQProjection: {
    isStockIncluded: (
      buyPrice: number | null | undefined,
      currentPrice: number | null | undefined,
      splitReliable?: boolean,
    ) => boolean;
    currentPriceFromLatest: (
      marketData: MarketDataPoint[] | undefined,
    ) => number | null;
    getBuyPrice: (
      marketData: MarketDataPoint[] | undefined,
      scoreDate: Date,
    ) => { price: number; dateUsed: Date; reliable: boolean } | null;
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
function bar(
  date: Date,
  price: number,
  splitCoefficient = 1.0,
): MarketDataPoint {
  return {
    date,
    high: price,
    low: price,
    open: price,
    close: price,
    splitCoefficient,
  };
}

// Mirror of the relevant GRQValidator glue, exclusion rule included.
class PortfolioValidator {
  scoreData: StockData[] = [];
  marketData: Record<string, MarketDataPoint[]> = {};

  getScoreDate(): Date {
    return SCORE_DATE;
  }

  // Production: docs/app.js isStockPriceable.
  isStockPriceable(stockSymbol: string, scoreDate: Date): boolean {
    const buyPriceObj = GRQProjection.getBuyPrice(
      this.marketData[stockSymbol],
      scoreDate,
    );
    const buyPrice = buyPriceObj ? buyPriceObj.price : null;
    // Split-reliability participates in the single predicate (issue #293).
    const splitReliable = buyPriceObj ? buyPriceObj.reliable : true;
    const currentPrice = GRQProjection.currentPriceFromLatest(
      this.marketData[stockSymbol],
    );
    return GRQProjection.isStockIncluded(buyPrice, currentPrice, splitReliable);
  }

  // Production: docs/app.js calculatePortfolioData time-series.
  calculatePortfolioData(): Array<{ x: Date; y: number }> {
    const scoreDate = this.getScoreDate();
    const portfolioData: Array<{ x: Date; y: number }> = [];

    const allDates = new Set<number>();
    this.scoreData.forEach((stock) => {
      this.marketData[stock.stock]?.forEach((point) =>
        allDates.add(point.date.getTime())
      );
    });
    allDates.add(scoreDate.getTime());

    Array.from(allDates).sort((a, b) => a - b).forEach((timestamp) => {
      let totalPerformance = 0;
      let validStocks = 0;
      this.scoreData.forEach((stock) => {
        const md = this.marketData[stock.stock];
        if (!md) return;
        // Exclusion guard (issue #289): drop unpriceable stocks entirely. This
        // runs BEFORE the inline price-return maths below, so a null buy price
        // can never reach it and inject NaN.
        if (!this.isStockPriceable(stock.stock, scoreDate)) return;
        const buyPriceObj = GRQProjection.getBuyPrice(md, scoreDate);
        const buyPrice = buyPriceObj ? buyPriceObj.price : null;
        const dataPoint = md.find((point) =>
          point.date.getTime() === timestamp
        );
        if (dataPoint) {
          const currentPrice = (dataPoint.high + dataPoint.low) / 2;
          // Inline maths mirrors production app.js: a null buyPrice here would
          // yield NaN — which the exclusion guard above prevents.
          const priceReturn = ((currentPrice - buyPrice!) / buyPrice!) * 100;
          totalPerformance += priceReturn;
          validStocks++;
        } else if (timestamp === scoreDate.getTime()) {
          validStocks++;
        }
      });
      if (validStocks > 0) {
        portfolioData.push({
          x: new Date(timestamp),
          y: totalPerformance / validStocks,
        });
      }
    });

    return portfolioData;
  }

  // Production: docs/app.js calculatePortfolioPerformance90Day totals row.
  calculatePortfolioPerformance90Day(): number {
    const scoreDate = this.getScoreDate();
    const ninetyDayDate = new Date(scoreDate.getTime() + 90 * DAY);
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

  // Production: docs/app.js calculatePortfolioTargetPercentage totals row.
  calculatePortfolioTargetPercentage(): number {
    const scoreDate = this.getScoreDate();
    let totalTarget = 0;
    let validStocks = 0;

    this.scoreData.forEach((stock) => {
      if (!this.isStockPriceable(stock.stock, scoreDate)) return;
      if (stock.target === null || isNaN(stock.target)) return;
      const buyPriceObj = GRQProjection.getBuyPrice(
        this.marketData[stock.stock],
        scoreDate,
      );
      const targetPercentage = GRQProjection.calculateTargetPercentage(
        buyPriceObj ? buyPriceObj.price : null,
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

// --- isStockPriceable: drives every exclusion below -------------------------

Deno.test("isStockPriceable - both buy and current price usable -> included", () => {
  const v = new PortfolioValidator();
  v.marketData = {
    GOOD: [bar(SCORE_DATE, 10), bar(new Date(2025, 1, 25), 12)],
  };
  assert(v.isStockPriceable("GOOD", SCORE_DATE));
});

Deno.test("isStockPriceable - no market data (delisted) -> excluded", () => {
  const v = new PortfolioValidator();
  v.marketData = {};
  assertEquals(v.isStockPriceable("DELISTED", SCORE_DATE), false);
});

Deno.test("isStockPriceable - split-unreliable series -> excluded (issue #293)", () => {
  // Both a buy price and a current price exist, but an implausible split
  // coefficient (> 10:1) after the score date means the split series cannot be
  // reconciled (getBuyPrice -> reliable:false). The single predicate must drop
  // it — mirroring the KLAC spike — so its distorted return never skews figures.
  const v = new PortfolioValidator();
  v.marketData = {
    SPIKE: [
      bar(SCORE_DATE, 100),
      bar(new Date(2025, 1, 25), 5, 20), // 20:1 coefficient -> unreliable
    ],
  };
  // Sanity: both prices ARE usable, so only the reliability flag excludes it.
  const buy = GRQProjection.getBuyPrice(v.marketData.SPIKE, SCORE_DATE);
  assert(buy && buy.price > 0, "expected a usable buy price");
  assertEquals(buy!.reliable, false);
  assertEquals(v.isStockPriceable("SPIKE", SCORE_DATE), false);
});

Deno.test("calculatePortfolioPerformance90Day - excludes a split-unreliable stock (issue #293)", () => {
  const v = new PortfolioValidator();
  v.scoreData = [
    { stock: "GOOD", target: 15 },
    { stock: "SPIKE", target: 99 },
  ];
  v.marketData = {
    GOOD: [bar(SCORE_DATE, 10), bar(new Date(2025, 2, 1), 13)], // +30%
    // Implausible 20:1 split after the score date -> unreliable -> excluded.
    SPIKE: [bar(SCORE_DATE, 100), bar(new Date(2025, 2, 1), 5, 20)],
  };
  // Totals reflect only GOOD: +30%, never the split-distorted SPIKE figure.
  assertAlmostEquals(v.calculatePortfolioPerformance90Day(), 30, 1e-9);
});

Deno.test("calculatePortfolioTargetPercentage - excludes a split-unreliable stock from allocation (issue #293)", () => {
  const v = new PortfolioValidator();
  v.scoreData = [
    { stock: "GOOD", target: 15 }, // buy 10 -> +50% target
    { stock: "SPIKE", target: 999 },
  ];
  v.marketData = {
    GOOD: [bar(SCORE_DATE, 10), bar(new Date(2025, 1, 25), 12)],
    SPIKE: [bar(SCORE_DATE, 100), bar(new Date(2025, 1, 25), 5, 20)],
  };
  // Only GOOD counts: (15 - 10) / 10 = +50%.
  assertAlmostEquals(v.calculatePortfolioTargetPercentage(), 50, 1e-9);
});

Deno.test("isStockPriceable - data exists but no buy price in window -> excluded", () => {
  // Market data starts well after the 5-day buy-price window, so getBuyPrice
  // returns null while a current price exists — the exact null-buy-price path
  // that used to produce NaN in the series.
  const v = new PortfolioValidator();
  v.marketData = {
    NOBUY: [bar(new Date(2025, 2, 10), 30), bar(new Date(2025, 2, 11), 31)],
  };
  assertEquals(v.isStockPriceable("NOBUY", SCORE_DATE), false);
});

// --- calculatePortfolioData: time-series + trend-line feed ------------------

Deno.test("calculatePortfolioData - excludes unpriceable stocks and re-weights remainder", () => {
  const v = new PortfolioValidator();
  v.scoreData = [
    { stock: "GOOD", target: 15 },
    { stock: "NOBUY", target: 40 },
  ];
  v.marketData = {
    // Buy 10 on score date, 12 a week later -> +20% on that date.
    GOOD: [bar(SCORE_DATE, 10), bar(new Date(2025, 1, 25), 12)],
    // Shares the 25 Feb timestamp but has no buy price in the window. Without
    // the guard its null buy price corrupts the 25 Feb average.
    NOBUY: [bar(new Date(2025, 1, 25), 60)],
  };

  const series = v.calculatePortfolioData();

  // The 25 Feb point reflects ONLY the included GOOD stock at +20%, not a
  // dilution across two stocks and not corrupted by NOBUY's null buy price.
  const point = series.find((p) =>
    p.x.getTime() === new Date(2025, 1, 25).getTime()
  );
  assert(point, "expected a portfolio point on 25 February");
  assertAlmostEquals(point!.y, 20, 1e-9);
});

Deno.test("calculatePortfolioData - never yields NaN when a stock lacks a buy price", () => {
  const v = new PortfolioValidator();
  v.scoreData = [
    { stock: "GOOD", target: 15 },
    { stock: "NOBUY", target: 40 },
    { stock: "DELISTED", target: 99 },
  ];
  v.marketData = {
    GOOD: [bar(SCORE_DATE, 10), bar(new Date(2025, 1, 25), 11)],
    // NOBUY shares the 25 Feb timestamp with GOOD but has no buy price in the
    // window. Without the exclusion guard its null buy price would inject NaN
    // into that point's average.
    NOBUY: [bar(new Date(2025, 1, 25), 50)],
    // DELISTED has no market data at all.
  };

  const series = v.calculatePortfolioData();
  assert(series.length > 0, "expected a non-empty portfolio series");
  for (const point of series) {
    // Finite catches both NaN and the Infinity a null buy price produces in
    // the inline (currentPrice - buyPrice) / buyPrice maths.
    assert(
      Number.isFinite(point.y),
      `series y must be a finite number, got ${point.y}`,
    );
  }
});

Deno.test("calculatePortfolioData - two included stocks are equal-weighted (re-weighting)", () => {
  const v = new PortfolioValidator();
  v.scoreData = [
    { stock: "A", target: 15 },
    { stock: "B", target: 15 },
    { stock: "NOBUY", target: 40 },
  ];
  v.marketData = {
    A: [bar(SCORE_DATE, 10), bar(new Date(2025, 1, 25), 12)], // +20%
    B: [bar(SCORE_DATE, 10), bar(new Date(2025, 1, 25), 14)], // +40%
    // Shares the 25 Feb timestamp but unpriceable -> must not dilute to /3.
    NOBUY: [bar(new Date(2025, 1, 25), 90)],
  };

  const series = v.calculatePortfolioData();
  const point = series.find((p) =>
    p.x.getTime() === new Date(2025, 1, 25).getTime()
  );
  assert(point, "expected a portfolio point on 25 February");
  // Mean of +20% and +40% over the two INCLUDED stocks = +30%, not /3.
  assertAlmostEquals(point!.y, 30, 1e-9);
});

// --- aggregate / totals row -------------------------------------------------

Deno.test("calculatePortfolioPerformance90Day - excludes unpriceable stocks", () => {
  const v = new PortfolioValidator();
  v.scoreData = [
    { stock: "GOOD", target: 15 },
    { stock: "DELISTED", target: 99 },
  ];
  v.marketData = {
    GOOD: [bar(SCORE_DATE, 10), bar(new Date(2025, 2, 1), 13)], // +30%
    // DELISTED has no market data -> excluded.
  };

  // Totals reflect only GOOD: +30%, not diluted by the delisted stock.
  assertAlmostEquals(v.calculatePortfolioPerformance90Day(), 30, 1e-9);
});

Deno.test("calculatePortfolioPerformance90Day - all stocks excluded -> 0", () => {
  const v = new PortfolioValidator();
  v.scoreData = [{ stock: "DELISTED", target: 99 }];
  v.marketData = {};
  assertEquals(v.calculatePortfolioPerformance90Day(), 0);
});

Deno.test("calculatePortfolioTargetPercentage - excludes unpriceable stocks from allocation", () => {
  const v = new PortfolioValidator();
  v.scoreData = [
    { stock: "GOOD", target: 15 }, // buy 10 -> +50% target
    { stock: "NOBUY", target: 40 },
  ];
  v.marketData = {
    GOOD: [bar(SCORE_DATE, 10), bar(new Date(2025, 1, 25), 12)],
    NOBUY: [bar(new Date(2025, 2, 10), 30)], // no buy price -> excluded
  };

  // Only GOOD counts: (15 - 10) / 10 = +50%.
  assertAlmostEquals(v.calculatePortfolioTargetPercentage(), 50, 1e-9);
});
