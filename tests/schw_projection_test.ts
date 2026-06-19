#!/usr/bin/env -S deno run --allow-read --allow-write

// NYSE:SCHW fixture-based projection test (issue #100).
//
// This is the most integration-like test: it loads a frozen snapshot of SCHW
// score/market/dividend fixtures and checks current performance, the 90-day
// hybrid projection and the trend-line fit. It used to reimplement getBuyPrice,
// performance, the regression and the whole projection tree inside a
// `TestGRQValidator`. It now loads the same fixtures but delegates every piece
// of maths to the REAL shared kernels in docs/projection.js (getBuyPrice,
// currentPriceFromLatest, calculatePerformanceReturn, computeTrendLine,
// calculateTargetPercentage, computeHybridProjection) — the same code the
// dashboard's GRQValidator uses.
import { assert, assertAlmostEquals } from "@std/assert";
import "../docs/projection.js";

interface StockData {
  stock: string;
  score: number;
  target: number;
  exDividendDate: string | null;
  dividendPerShare: number;
  notes: string;
  intrinsicValuePerShareBasic: number | null;
  intrinsicValuePerShareAdjusted: number | null;
}

interface MarketDataPoint {
  date: Date;
  high: number;
  low: number;
  open: number;
  close: number;
  splitCoefficient: number;
}

interface DividendDataPoint {
  exDivDate: Date;
  amount: number;
}

interface Projection {
  projected90DayPerformance: number;
  projectionMethod: string;
  confidence: number;
  daysElapsed: number;
  currentPerformance: number;
  targetPercentage: number | null;
}

const g = globalThis as unknown as {
  GRQProjection: {
    getBuyPrice: (
      marketData: MarketDataPoint[] | undefined,
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
    ) => {
      slope: number;
      intercept: number;
      predicted90DayPerformance: number;
      rSquared: number;
    } | null;
    computeHybridProjection: (inputs: {
      daysElapsed: number;
      currentPerformance: number;
      targetPercentage: number | null;
      trendLine: { slope: number; rSquared: number } | null;
    }) => {
      projected90DayPerformance: number;
      projectionMethod: string;
      confidence: number;
    };
  };
};
const GRQProjection = g.GRQProjection;

const DAY = 1000 * 60 * 60 * 24;

class TestGRQValidator {
  scoreData: StockData[] = [];
  marketData: Record<string, MarketDataPoint[]> = {};
  dividendData: Record<string, DividendDataPoint[]> = {};
  selectedFile = "2025/April/15.tsv";

  scorePath = "docs/scores/2025/April/15.tsv";
  marketDataPath = "docs/scores/2025/April/15.csv";
  dividendDataPath = "docs/scores/2025/April/15-dividends.csv";

  async loadScoreData() {
    const text = await Deno.readTextFile(this.scorePath);
    const lines = text.trim().split("\n");
    this.scoreData = lines.slice(1).map((line) => {
      const values = line.split("\t");
      return {
        stock: values[0],
        score: parseFloat(values[1]),
        target: parseFloat(values[2]),
        exDividendDate: values[3] || null,
        dividendPerShare: values[4] ? parseFloat(values[4]) : 0,
        notes: values[5] || "",
        intrinsicValuePerShareBasic: values[6] ? parseFloat(values[6]) : null,
        intrinsicValuePerShareAdjusted: values[7]
          ? parseFloat(values[7])
          : null,
      };
    });
  }

  async loadMarketData() {
    const text = await Deno.readTextFile(this.marketDataPath);
    const lines = text.trim().split("\n");
    const byStock: Record<string, MarketDataPoint[]> = {};
    lines.slice(1).forEach((line) => {
      const values = line.split(",");
      const ticker = values[1];
      (byStock[ticker] ||= []).push({
        date: new Date(values[0]),
        high: parseFloat(values[2]),
        low: parseFloat(values[3]),
        open: parseFloat(values[4]),
        close: parseFloat(values[5]),
        splitCoefficient: parseFloat(values[6]),
      });
    });
    this.marketData = byStock;
  }

  async loadDividendData() {
    const text = await Deno.readTextFile(this.dividendDataPath);
    const lines = text.trim().split("\n");
    const byStock: Record<string, DividendDataPoint[]> = {};
    lines.slice(1).forEach((line) => {
      if (!line.trim()) return;
      const values = line.split(",");
      (byStock[values[1]] ||= []).push({
        exDivDate: new Date(values[0]),
        amount: parseFloat(values[2]),
      });
    });
    this.dividendData = byStock;
  }

  getScoreDate(scoreFile: string): Date {
    const match = scoreFile.match(/(\d{4})\/(\w+)\/(\d+)\.tsv/);
    if (!match) return new Date();
    const [, year, month, day] = match;
    const monthMap: Record<string, number> = {
      January: 0,
      February: 1,
      March: 2,
      April: 3,
      May: 4,
      June: 5,
      July: 6,
      August: 7,
      September: 8,
      October: 9,
      November: 10,
      December: 11,
    };
    return new Date(parseInt(year), monthMap[month], parseInt(day));
  }

  getDividendsWithin90Days(stockSymbol: string): DividendDataPoint[] {
    const dividends = this.dividendData[stockSymbol] || [];
    const scoreDate = this.getScoreDate(this.selectedFile);
    const ninetyDayDate = new Date(scoreDate.getTime() + 90 * DAY);
    return dividends.filter((div) => div.exDivDate <= ninetyDayDate);
  }

  // Current performance via the real performance-return kernel.
  calculateStockPerformance(stock: StockData): number | null {
    const scoreDate = this.getScoreDate(this.selectedFile);
    const buyPriceObj = GRQProjection.getBuyPrice(
      this.marketData[stock.stock],
      scoreDate,
    );
    if (!buyPriceObj) return null;
    const currentPrice = GRQProjection.currentPriceFromLatest(
      this.marketData[stock.stock],
    );
    if (currentPrice === null) return null;
    const totalDividends = this.getDividendsWithin90Days(stock.stock)
      .reduce((sum, div) => sum + div.amount, 0);
    return GRQProjection.calculatePerformanceReturn(
      buyPriceObj.price,
      currentPrice,
      totalDividends,
    );
  }

  // Collect regression points (data plumbing) then delegate to the kernel.
  calculateTrendLine(stock: StockData, scoreDate: Date) {
    const marketData = this.marketData[stock.stock];
    if (!marketData || marketData.length === 0) return null;
    const buyPriceObj = GRQProjection.getBuyPrice(marketData, scoreDate);
    if (!buyPriceObj || buyPriceObj.price <= 0) return null;
    const trendEndDate = marketData[marketData.length - 1].date;
    const dividends = this.getDividendsWithin90Days(stock.stock);

    const dataPoints: { x: number; y: number }[] = [];
    marketData.forEach((point) => {
      if (point.date >= scoreDate && point.date <= trendEndDate) {
        const daysSinceScore = (point.date.getTime() - scoreDate.getTime()) /
          DAY;
        const currentPrice = (point.high + point.low) / 2;
        const priceReturn =
          ((currentPrice - buyPriceObj.price) / buyPriceObj.price) * 100;
        const totalDividends = dividends
          .filter((d) => d.exDivDate <= point.date)
          .reduce((sum, div) => sum + div.amount, 0);
        const dividendReturn = (totalDividends / buyPriceObj.price) * 100;
        dataPoints.push({ x: daysSinceScore, y: priceReturn + dividendReturn });
      }
    });

    return GRQProjection.computeTrendLine(dataPoints);
  }

  calculateTargetPercentage(stock: StockData, scoreDate: Date): number | null {
    const buyPriceObj = GRQProjection.getBuyPrice(
      this.marketData[stock.stock],
      scoreDate,
    );
    return GRQProjection.calculateTargetPercentage(
      buyPriceObj ? buyPriceObj.price : null,
      stock.target,
    );
  }

  // Gather inputs the way GRQValidator does, then delegate the decision tree.
  calculateHybridProjection(
    stock: StockData,
    scoreDate: Date,
  ): Projection | null {
    const marketData = this.marketData[stock.stock];
    if (!marketData || marketData.length === 0) return null;
    const latestMarketDate = marketData[marketData.length - 1].date;
    const daysElapsed = Math.floor(
      (latestMarketDate.getTime() - scoreDate.getTime()) / DAY,
    );

    const buyPriceObj = GRQProjection.getBuyPrice(marketData, scoreDate);
    if (!buyPriceObj || buyPriceObj.price <= 0) return null;
    const currentPerformance = this.calculateStockPerformance(stock);
    if (currentPerformance === null) return null;
    const targetPercentage = this.calculateTargetPercentage(stock, scoreDate);
    const trendLine = daysElapsed < 60
      ? this.calculateTrendLine(stock, scoreDate)
      : null;

    const projection = GRQProjection.computeHybridProjection({
      daysElapsed,
      currentPerformance,
      targetPercentage,
      trendLine,
    });
    return { ...projection, daysElapsed, currentPerformance, targetPercentage };
  }
}

Deno.test("NYSE:SCHW Projection Test - Using Real App Functions", async (t) => {
  // Frozen snapshot covering Apr 15 – Jul 1 2025 (~77 calendar days) so the
  // assertions stay deterministic as the live CSV grows.
  const validator = new TestGRQValidator();
  validator.scorePath = "tests/fixtures/schw_april_2025_scores.tsv";
  validator.marketDataPath = "tests/fixtures/schw_april_2025_snapshot.csv";
  validator.dividendDataPath = "tests/fixtures/schw_april_2025_dividends.csv";

  await validator.loadScoreData();
  await validator.loadMarketData();
  await validator.loadDividendData();

  const scoreDate = validator.getScoreDate("2025/April/15.tsv");
  const stock = validator.scoreData.find((s) => s.stock === "NYSE:SCHW");
  assert(stock, "NYSE:SCHW should be found in score data");

  await t.step("should calculate correct current performance", () => {
    const currentPerformance = validator.calculateStockPerformance(stock!);
    assert(currentPerformance !== null, "Should have current performance");
    assert(
      currentPerformance! > 15,
      `Current performance should be > 15%, got ${
        currentPerformance?.toFixed(1)
      }%`,
    );
  });

  await t.step("should calculate correct 90-day projection", () => {
    const projection = validator.calculateHybridProjection(stock!, scoreDate);
    assert(projection, "Should have projection");

    // Spec-derived expectation (issue #205) — replaces two undocumented magic
    // lower bounds (`> 17` and `> 19`) that asserted on the number the code
    // happened to emit against this fixture.
    //
    // Derivation: the frozen SCHW snapshot spans ~77 days, so
    // computeHybridProjection takes the long-term (daysElapsed >= 60)
    // "realistic_trajectory" branch. There, with a known target and the stock
    // already trading above that target (current ~17.2% > target ~7.8%), the
    // kernel trusts the realised trajectory and extrapolates the current daily
    // rate out to the full 90-day horizon:
    //
    //     projected = currentPerformance * 90 / daysElapsed
    //
    // So the expected figure is the documented formula applied to the fixture
    // (~20.1%), not an empirical bound. If the projection maths is retuned,
    // this assertion fails with a meaningful expected-vs-actual diff rather
    // than a stale threshold.
    assert(
      projection!.projectionMethod === "realistic_trajectory",
      `Expected realistic_trajectory branch, got ${
        projection!.projectionMethod
      }`,
    );
    const expected = (projection!.currentPerformance * 90) /
      projection!.daysElapsed;
    assertAlmostEquals(
      projection!.projected90DayPerformance,
      expected,
      1e-9,
      "Above-target SCHW should project its current daily rate to 90 days",
    );
  });

  await t.step("should have strong trend line fit", () => {
    const trendLine = validator.calculateTrendLine(stock!, scoreDate);
    assert(trendLine, "Should have trend line");
    assert(
      trendLine!.rSquared > 0.3,
      `R-squared should be > 0.3, got ${trendLine!.rSquared.toFixed(3)}`,
    );
    assert(
      trendLine!.slope > 0,
      `Slope should be positive, got ${trendLine!.slope.toFixed(4)}`,
    );
  });
});
