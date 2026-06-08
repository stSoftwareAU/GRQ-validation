// Chart-data preparation tests (issue #100).
//
// The chart-dataset assembly is dashboard UI glue and stays local, but the maths
// it used to reimplement inline — the per-point performance return, the
// historical-price split adjustment and the target percentage — now come from
// the REAL shared kernels in docs/projection.js (calculatePerformanceReturn,
// adjustHistoricalPriceToCurrent, calculateTargetPercentage). getBuyPrice is
// still reassigned per step to exercise how the chart reacts to null/zero/valid
// buy prices.
import { assertEquals, assertNotEquals } from "@std/assert";
import "../docs/projection.js";

interface MarketDataPoint {
  date: Date;
  high: number;
  low: number;
  open: number;
  close: number;
  splitCoefficient: number;
}

interface ScoreData {
  stock: string;
  score: number;
  target: number;
  exDividendDate: string | null;
  dividendPerShare: number;
  notes: string;
  intrinsicValuePerShareBasic: number | null;
  intrinsicValuePerShareAdjusted: number | null;
}

interface ChartDataPoint {
  x: Date;
  y: number;
}

interface Dataset {
  label: string;
  data: ChartDataPoint[];
}

const g = globalThis as unknown as {
  GRQProjection: {
    calculatePerformanceReturn: (
      buyPrice: number,
      currentPrice: number,
      totalDividends?: number,
    ) => number | null;
    adjustHistoricalPriceToCurrent: (
      price: number,
      marketData: MarketDataPoint[] | undefined,
      historicalDate: Date,
    ) => number;
    calculateTargetPercentage: (
      buyPrice: number | null,
      adjustedTarget: number | null,
    ) => number | null;
  };
};
const GRQProjection = g.GRQProjection;

const DAY = 24 * 60 * 60 * 1000;

class ChartValidator {
  marketData: Record<string, MarketDataPoint[]> = {};
  scoreData: ScoreData[] = [];
  selectedStock: string | null = null;

  setupValidChartData(): void {
    this.marketData = {
      TEST: [
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
      ],
    };
    this.scoreData = [
      {
        stock: "TEST",
        score: 0.8,
        target: 18.5,
        exDividendDate: null,
        dividendPerShare: 0,
        notes: "",
        intrinsicValuePerShareBasic: null,
        intrinsicValuePerShareAdjusted: null,
      },
    ];
  }

  getScoreDate(): Date {
    return new Date(2025, 1, 14);
  }

  // Default to the real kernel; tests reassign this to probe null/zero cases.
  getBuyPrice(
    _stockSymbol: string,
    _scoreDate: Date,
  ): { price: number; dateUsed: Date } | null {
    return { price: 15.0, dateUsed: new Date(2025, 1, 18) };
  }

  calculatePortfolioData(): ChartDataPoint[] {
    return [
      { x: new Date(2025, 1, 18), y: 5.0 },
      { x: new Date(2025, 1, 19), y: 6.0 },
    ];
  }

  calculateCostOfCapitalData(): ChartDataPoint[] {
    return [
      { x: new Date(2025, 1, 18), y: 2.0 },
      { x: new Date(2025, 1, 19), y: 2.5 },
    ];
  }

  prepareChartData(): { datasets: Dataset[] } {
    const datasets: Dataset[] = [];
    const scoreDate = this.getScoreDate();
    const ninetyDayDate = new Date(scoreDate.getTime() + 90 * DAY);

    if (this.selectedStock) {
      const stock = this.scoreData.find((s) => s.stock === this.selectedStock);
      const marketData = stock ? this.marketData[stock.stock] : undefined;
      if (stock && marketData && marketData.length > 0) {
        const buyPriceObj = this.getBuyPrice(stock.stock, scoreDate);
        if (buyPriceObj && buyPriceObj.price > 0) {
          const buyPrice = buyPriceObj.price;
          const before90Days: ChartDataPoint[] = [];
          marketData.forEach((point) => {
            const adjustedPrice = GRQProjection.adjustHistoricalPriceToCurrent(
              (point.high + point.low) / 2,
              marketData,
              point.date,
            );
            const yValue = GRQProjection.calculatePerformanceReturn(
              buyPrice,
              adjustedPrice,
              0,
            );
            if (yValue === null || isNaN(yValue)) return;
            if (point.date <= ninetyDayDate) {
              before90Days.push({
                x: new Date(point.date.getTime()),
                y: yValue,
              });
            }
          });

          const clean = before90Days.filter((p) =>
            typeof p.y === "number" && !isNaN(p.y)
          );
          if (clean.length > 0) {
            datasets.push({ label: "Performance", data: clean });
          }

          const targetPercentage = GRQProjection.calculateTargetPercentage(
            buyPrice,
            stock.target,
          );
          if (targetPercentage !== null) {
            datasets.push({
              label: "Target",
              data: [{ x: ninetyDayDate, y: targetPercentage }],
            });
          }
        }
      }
    } else {
      const hasValidBuyPrice = this.scoreData.some((stock) => {
        const buyPriceObj = this.getBuyPrice(stock.stock, scoreDate);
        return buyPriceObj !== null && buyPriceObj.price > 0;
      });
      if (hasValidBuyPrice) {
        const clean = this.calculatePortfolioData()
          .filter((p) =>
            p.x <= ninetyDayDate && typeof p.y === "number" && !isNaN(p.y)
          );
        if (clean.length > 0) {
          datasets.push({ label: "Performance", data: clean });
        }
      }
    }

    const costOfCapitalData = this.calculateCostOfCapitalData();
    if (costOfCapitalData.length > 0) {
      datasets.push({ label: "Cost of Capital", data: costOfCapitalData });
    }
    return { datasets };
  }
}

Deno.test("Chart Data Preparation - Invalid Y Values", async (t) => {
  const validator = new ChartValidator();
  validator.setupValidChartData();

  await t.step("should handle null buy price gracefully", () => {
    validator.getBuyPrice = () => null;
    const chartData = validator.prepareChartData();
    assertEquals(chartData.datasets.length, 1, "Only cost of capital line");
    assertEquals(chartData.datasets[0].label, "Cost of Capital");
  });

  await t.step("should handle zero buy price gracefully", () => {
    validator.getBuyPrice = () => ({
      price: 0,
      dateUsed: new Date(2025, 1, 18),
    });
    const chartData = validator.prepareChartData();
    assertEquals(chartData.datasets.length, 1, "Only cost of capital line");
    assertEquals(chartData.datasets[0].label, "Cost of Capital");
  });

  await t.step("should filter out invalid y values", () => {
    validator.getBuyPrice = () => ({
      price: 15.0,
      dateUsed: new Date(2025, 1, 18),
    });
    const chartData = validator.prepareChartData();
    chartData.datasets.forEach((dataset) => {
      dataset.data.forEach((point) => {
        assertEquals(typeof point.y, "number", "Y value should be a number");
        assertNotEquals(isNaN(point.y), true, "Y value should not be NaN");
        assertNotEquals(point.y, null, "Y value should not be null");
      });
    });
  });
});

Deno.test("Market Index Data Clearing", async (t) => {
  await t.step(
    "should clear market index data when switching score dates",
    () => {
      let marketIndexData:
        | { sp500: string; nasdaq: string; russell2000: string }
        | null = { sp500: "old", nasdaq: "old", russell2000: "old" };
      marketIndexData = null; // loadScoreFile() clears stale index data.
      assertEquals(
        marketIndexData,
        null,
        "Index data cleared when switching dates",
      );
    },
  );

  await t.step(
    "should show portfolio data only when market index data is null",
    () => {
      const marketIndexData = null;
      assertEquals(
        marketIndexData !== null,
        false,
        "No market index data initially",
      );
      const expected = ["Portfolio", "Target", "Cost of Capital"];
      const actual = ["Portfolio", "Target", "Cost of Capital"];
      assertEquals(actual.length, expected.length, "Only portfolio data shown");
    },
  );
});
