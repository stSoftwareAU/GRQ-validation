// Portfolio-view consistency tests (issue #100).
//
// These used to drive a `MockGRQValidator` that copied getBuyPrice, the
// target-percentage formula, the market-data day count, the portfolio trend-line
// regression and R². The portfolio maths now comes from the REAL shared kernels
// in docs/projection.js (getBuyPrice, calculatePerformanceReturn,
// calculateTargetPercentage, daysElapsedFromMarketData, computeTrendLine). The
// portfolio-series and chart-dataset assembly stay local glue (dashboard UI),
// but build their figures with the kernels so they cannot drift from production.
import { assertEquals, assertExists } from "@std/assert";
import "../docs/projection.js";

interface StockData {
  stock: string;
  score: number;
  target: number;
  exDividendDate: string | null;
  dividendPerShare: number;
  notes: string;
  intrinsicValuePerShareBasic: number;
  intrinsicValuePerShareAdjusted: number;
}

interface MarketDataPoint {
  date: Date;
  high: number;
  low: number;
  open: number;
  close: number;
  splitCoefficient: number;
}

const DAY = 1000 * 60 * 60 * 24;

const g = globalThis as unknown as {
  GRQProjection: {
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
    daysElapsedFromMarketData: (
      scoreDate: Date,
      latestMarketDate: Date,
    ) => number;
    computeTrendLine: (
      dataPoints: { x: number; y: number }[],
    ) => { slope: number; intercept: number; rSquared: number } | null;
  };
};
const GRQProjection = g.GRQProjection;

class PortfolioValidator {
  scoreData: StockData[] = [];
  marketData: Record<string, MarketDataPoint[]> = {};
  selectedStock: string | null = null;

  setupTestData(): void {
    this.scoreData = [
      {
        stock: "NASDAQ:XP",
        score: 0.85,
        target: 18.50,
        exDividendDate: null,
        dividendPerShare: 0,
        notes: "Test stock",
        intrinsicValuePerShareBasic: 20.00,
        intrinsicValuePerShareAdjusted: 19.50,
      },
      {
        stock: "NYSE:AAPL",
        score: 0.92,
        target: 200.00,
        exDividendDate: "2025-03-15",
        dividendPerShare: 0.25,
        notes: "Apple Inc",
        intrinsicValuePerShareBasic: 220.00,
        intrinsicValuePerShareAdjusted: 215.00,
      },
    ];

    this.marketData = {
      "NASDAQ:XP": [
        {
          date: new Date(2025, 1, 18),
          high: 15.18,
          low: 14.72,
          open: 14.72,
          close: 15.02,
          splitCoefficient: 1.0,
        },
        {
          date: new Date(2025, 1, 19),
          high: 15.25,
          low: 14.85,
          open: 15.02,
          close: 15.10,
          splitCoefficient: 1.0,
        },
        {
          date: new Date(2025, 1, 20),
          high: 15.30,
          low: 14.90,
          open: 15.10,
          close: 15.20,
          splitCoefficient: 1.0,
        },
      ],
      "NYSE:AAPL": [
        {
          date: new Date(2025, 1, 18),
          high: 180.50,
          low: 179.20,
          open: 179.20,
          close: 180.00,
          splitCoefficient: 1.0,
        },
        {
          date: new Date(2025, 1, 19),
          high: 181.00,
          low: 179.80,
          open: 180.00,
          close: 180.50,
          splitCoefficient: 1.0,
        },
      ],
    };
  }

  getScoreDate(scoreFile: string): Date {
    const match = scoreFile.match(/(\d{4})\/(\w+)\/(\d+)\.tsv/);
    if (match) {
      const [, year, month, day] = match;
      const monthIndex = new Date(`${month} 1, ${year}`).getMonth();
      return new Date(parseInt(year), monthIndex, parseInt(day));
    }
    return new Date();
  }

  getDaysElapsed(scoreDate: Date): number {
    const diffTime = Math.abs(new Date().getTime() - scoreDate.getTime());
    return Math.ceil(diffTime / DAY);
  }

  getDaysElapsedFromMarketData(scoreDate: Date): number {
    if (!this.marketData || Object.keys(this.marketData).length === 0) {
      return this.getDaysElapsed(scoreDate); // Calendar fallback.
    }
    // Find the latest market-data date across the portfolio (data plumbing)...
    let latestMarketDate = scoreDate;
    this.scoreData.forEach((stock) => {
      const md = this.marketData[stock.stock];
      if (md && md.length > 0) {
        const last = md[md.length - 1].date;
        if (last > latestMarketDate) latestMarketDate = last;
      }
    });
    // ...then delegate the capped day count to the kernel.
    return GRQProjection.daysElapsedFromMarketData(scoreDate, latestMarketDate);
  }

  calculateTargetPercentage(stock: StockData, scoreDate: Date): number | null {
    const buyPrice = GRQProjection.getBuyPrice(
      this.marketData[stock.stock],
      scoreDate,
    );
    return GRQProjection.calculateTargetPercentage(
      buyPrice ? buyPrice.price : null,
      stock.target,
    );
  }

  calculatePortfolioData(): Array<{ x: Date; y: number }> {
    const scoreDate = this.getScoreDate("2025/February/18.tsv");
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
        const buyPriceObj = GRQProjection.getBuyPrice(md, scoreDate);
        if (!buyPriceObj) return;
        const dataPoint = md.find((point) =>
          point.date.getTime() === timestamp
        );
        if (dataPoint) {
          const currentPrice = (dataPoint.high + dataPoint.low) / 2;
          totalPerformance += GRQProjection.calculatePerformanceReturn(
            buyPriceObj.price,
            currentPrice,
            0,
          )!;
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

  calculatePortfolioTrendLine() {
    const scoreDate = this.getScoreDate("2025/February/18.tsv");
    const dataPoints = this.calculatePortfolioData().map((point) => ({
      x: (point.x.getTime() - scoreDate.getTime()) / DAY,
      y: point.y,
    }));
    return GRQProjection.computeTrendLine(dataPoints);
  }

  prepareChartData(): {
    datasets: Array<{ label: string; data: Array<{ x: Date; y: number }> }>;
  } {
    const datasets: Array<
      { label: string; data: Array<{ x: Date; y: number }> }
    > = [];
    const scoreDate = this.getScoreDate("2025/February/18.tsv");
    const marketDataDaysElapsed = this.getDaysElapsedFromMarketData(scoreDate);

    if (this.selectedStock) return { datasets };

    const portfolioData = this.calculatePortfolioData();
    if (portfolioData.length > 0) {
      datasets.push({ label: "Performance", data: portfolioData });
    }

    if (marketDataDaysElapsed < 90) {
      const trendLine = this.calculatePortfolioTrendLine();
      if (trendLine) {
        const trendData: Array<{ x: Date; y: number }> = [];
        for (let day = 0; day <= 90; day += 7) {
          trendData.push({
            x: new Date(scoreDate.getTime() + day * DAY),
            y: Math.max(trendLine.slope * day + trendLine.intercept, -100),
          });
        }
        let confidenceThreshold = 0.05;
        if (marketDataDaysElapsed >= 80) confidenceThreshold = 0.001;
        else if (marketDataDaysElapsed >= 60) confidenceThreshold = 0.01;
        else if (marketDataDaysElapsed >= 30) confidenceThreshold = 0.03;

        const label = trendLine.rSquared >= confidenceThreshold
          ? "Portfolio Trend Prediction"
          : "Portfolio Trend (Low Confidence)";
        datasets.push({ label, data: trendData });
      }
    }

    return { datasets };
  }
}

Deno.test("Portfolio View Consistency", async (t) => {
  const validator = new PortfolioValidator();
  validator.setupTestData();

  await t.step(
    "should calculate days elapsed from market data correctly",
    () => {
      const scoreDate = validator.getScoreDate("2025/February/18.tsv");

      assertEquals(
        validator.getDaysElapsedFromMarketData(scoreDate),
        2,
        "Should return actual days from market data when less than 90",
      );

      // Extended market data (Jun 18 = 120 days) caps at 90.
      validator.marketData = {
        "NASDAQ:XP": [
          {
            date: new Date(2025, 1, 18),
            high: 15.18,
            low: 14.72,
            open: 14.72,
            close: 15.02,
            splitCoefficient: 1.0,
          },
          {
            date: new Date(2025, 5, 18),
            high: 16.00,
            low: 15.50,
            open: 15.50,
            close: 15.75,
            splitCoefficient: 1.0,
          },
        ],
      };
      assertEquals(
        validator.getDaysElapsedFromMarketData(scoreDate),
        90,
        "Should cap at 90 days when market data extends beyond 90 days",
      );

      validator.marketData = {};
      assertExists(
        validator.getDaysElapsedFromMarketData(scoreDate),
        "Should fall back to calendar days when no market data",
      );
    },
  );

  await t.step("should use market data days for portfolio view", () => {
    validator.setupTestData();
    const chartData = validator.prepareChartData();
    const performanceDataset = chartData.datasets.find((d) =>
      d.label === "Performance"
    );
    assertExists(performanceDataset, "Should have performance dataset");

    validator.marketData = {
      "NASDAQ:XP": [
        {
          date: new Date(2025, 1, 18),
          high: 15.18,
          low: 14.72,
          open: 14.72,
          close: 15.02,
          splitCoefficient: 1.0,
        },
        {
          date: new Date(2025, 5, 18),
          high: 16.00,
          low: 15.50,
          open: 15.50,
          close: 15.75,
          splitCoefficient: 1.0,
        },
      ],
    };
    const extendedChartData = validator.prepareChartData();
    assertExists(
      extendedChartData.datasets,
      "Extended chart data should exist",
    );
  });
});
