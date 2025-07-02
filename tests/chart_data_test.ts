import { assertEquals, assertNotEquals } from "@std/assert";

// Define types for the mock validator
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
  borderColor?: string;
  backgroundColor?: string;
  borderWidth?: number;
  fill?: boolean;
  pointRadius?: number;
  pointStyle?: string;
  showLine?: boolean;
}

class MockGRQValidator {
  marketData: Record<string, MarketDataPoint[]> = {};
  dividendData: Record<string, unknown[]> = {};
  scoreData: ScoreData[] = [];
  selectedFile = "test.tsv";
  selectedStock: string | null = null;

  setupValidChartData(): void {
    this.marketData = {
      TEST: [
        {
          date: new Date("2025-02-18"),
          high: 15.18,
          low: 14.72,
          open: 14.72,
          close: 15.02,
          splitCoefficient: 1.0,
        },
        {
          date: new Date("2025-02-19"),
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
    return new Date("2025-02-14");
  }

  getDaysElapsed(): number {
    return 30;
  }

  getDaysElapsedFromMarketData(scoreDate: Date): number {
    if (!this.marketData || Object.keys(this.marketData).length === 0) {
      return this.getDaysElapsed();
    }
    let latestMarketDate = scoreDate;
    this.scoreData.forEach((stock) => {
      const marketData = this.marketData[stock.stock];
      if (marketData && marketData.length > 0) {
        const stockLatestDate = marketData[marketData.length - 1].date;
        if (stockLatestDate > latestMarketDate) {
          latestMarketDate = stockLatestDate;
        }
      }
    });
    const diffTime = Math.abs(latestMarketDate.getTime() - scoreDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return Math.min(diffDays, 90);
  }

  getBuyPrice(_stockSymbol: string, _scoreDate: Date): { price: number; dateUsed: Date } | null {
    return { price: 15.0, dateUsed: new Date("2025-02-18") };
  }

  adjustHistoricalPriceToCurrent(price: number, _stockSymbol: string, _historicalDate: Date): number {
    return price;
  }

  calculateTargetPercentage(_stock: ScoreData, _scoreDate: Date): number {
    return 20.0;
  }

  calculatePortfolioTargetPercentage(): number {
    return 20.0;
  }

  calculatePortfolioData(): ChartDataPoint[] {
    return [
      { x: new Date("2025-02-18"), y: 5.0 },
      { x: new Date("2025-02-19"), y: 6.0 },
    ];
  }

  calculateCostOfCapitalData(): ChartDataPoint[] {
    return [
      { x: new Date("2025-02-18"), y: 2.0 },
      { x: new Date("2025-02-19"), y: 2.5 },
    ];
  }

  calculateTrendLine(_stock: ScoreData, _scoreDate: Date): null {
    return null;
  }

  prepareChartData(): { datasets: Dataset[] } {
    const datasets: Dataset[] = [];
    const scoreDate = this.getScoreDate();
    const ninetyDayDate = new Date(scoreDate.getTime() + 90 * 24 * 60 * 60 * 1000);

    if (this.selectedStock) {
      // Single stock view
      const stock = this.scoreData.find((s) => s.stock === this.selectedStock);
      if (stock) {
        const marketData = this.marketData[stock.stock];
        if (marketData && marketData.length > 0) {
          const targetPercentage = this.calculateTargetPercentage(stock, scoreDate);
          const buyPriceObj = this.getBuyPrice(stock.stock, scoreDate);

          if (!buyPriceObj || !buyPriceObj.price || buyPriceObj.price <= 0) {
            // Don't add any performance datasets if no valid buy price
            // Only add cost of capital line later
          } else {
            const buyPrice = buyPriceObj.price;
            const before90Days: ChartDataPoint[] = [];

            marketData.forEach((point) => {
              const adjustedPrice = this.adjustHistoricalPriceToCurrent(
                (point.high + point.low) / 2,
                stock.stock,
                point.date,
              );
              const yValue = ((adjustedPrice - buyPrice) / buyPrice) * 100;
              if (isNaN(yValue) || yValue === null) return; // skip invalid

              const dataPoint: ChartDataPoint = {
                x: new Date(point.date.getTime()),
                y: yValue,
              };

              if (point.date <= ninetyDayDate) {
                before90Days.push(dataPoint);
              }
            });

            // Filter out any invalid y values
            const cleanBefore90 = before90Days.filter((p) => typeof p.y === "number" && !isNaN(p.y));

            if (cleanBefore90.length > 0) {
              datasets.push({
                label: "Performance",
                data: cleanBefore90,
                borderColor: "rgba(102, 126, 234, 1)",
                backgroundColor: "rgba(102, 126, 234, 0.1)",
                borderWidth: 3,
                fill: false,
                pointRadius: 3,
              });
            }

            // Add target dot only if we have valid buy price
            if (targetPercentage !== null) {
              datasets.push({
                label: "Target",
                data: [
                  {
                    x: ninetyDayDate,
                    y: targetPercentage,
                  },
                ],
                borderColor: "rgba(255, 193, 7, 1)",
                backgroundColor: "rgba(255, 193, 7, 1)",
                borderWidth: 0,
                fill: false,
                pointRadius: 8,
                pointStyle: "circle",
                showLine: false,
              });
            }
          }
        }
      }
    } else {
      // Portfolio view
      let hasValidBuyPrice = false;
      for (const stock of this.scoreData) {
        const buyPriceObj = this.getBuyPrice(stock.stock, scoreDate);
        if (buyPriceObj && buyPriceObj.price > 0) {
          hasValidBuyPrice = true;
          break;
        }
      }
      if (hasValidBuyPrice) {
        const portfolioData = this.calculatePortfolioData();
        const before90Days: ChartDataPoint[] = [];
        portfolioData.forEach((point) => {
          if (point.x <= ninetyDayDate) {
            before90Days.push(point);
          }
        });
        const cleanBefore90 = before90Days.filter((p) => typeof p.y === "number" && !isNaN(p.y));
        if (cleanBefore90.length > 0) {
          datasets.push({
            label: "Performance",
            data: cleanBefore90,
            borderColor: "rgba(102, 126, 234, 1)",
            backgroundColor: "rgba(102, 126, 234, 0.1)",
            borderWidth: 3,
            fill: false,
            pointRadius: 3,
          });
        }
        const portfolioTarget = this.calculatePortfolioTargetPercentage();
        if (portfolioTarget !== null) {
          datasets.push({
            label: "Target",
            data: [
              {
                x: ninetyDayDate,
                y: portfolioTarget,
              },
            ],
            borderColor: "rgba(255, 193, 7, 1)",
            backgroundColor: "rgba(255, 193, 7, 1)",
            borderWidth: 0,
            fill: false,
            pointRadius: 8,
            pointStyle: "circle",
            showLine: false,
          });
        }
      }
    }
    // Add cost of capital line
    const costOfCapitalData = this.calculateCostOfCapitalData();
    if (costOfCapitalData.length > 0) {
      datasets.push({
        label: "Cost of Capital",
        data: costOfCapitalData,
        borderColor: "rgba(108, 117, 125, 0.8)",
        backgroundColor: "rgba(108, 117, 125, 0.1)",
        borderWidth: 2,
        fill: false,
        pointRadius: 0,
      });
    }
    return { datasets };
  }
}

Deno.test("Chart Data Preparation - Invalid Y Values", async (t) => {
  const validator = new MockGRQValidator();
  validator.setupValidChartData();

  await t.step("should handle null buy price gracefully", () => {
    // Simulate missing buy price
    validator.getBuyPrice = () => null;
    const chartData = validator.prepareChartData();

    // Should return empty datasets when no buy price
    assertEquals(chartData.datasets.length, 1, "Should only have cost of capital line");
    assertEquals(chartData.datasets[0].label, "Cost of Capital", "Should have cost of capital line");
  });

  await t.step("should handle zero buy price gracefully", () => {
    // Simulate zero buy price
    validator.getBuyPrice = () => ({ price: 0, dateUsed: new Date() });
    const chartData = validator.prepareChartData();

    // Should return empty datasets when buy price is zero
    assertEquals(chartData.datasets.length, 1, "Should only have cost of capital line");
    assertEquals(chartData.datasets[0].label, "Cost of Capital", "Should have cost of capital line");
  });

  await t.step("should filter out invalid y values", () => {
    // Restore valid buy price
    validator.getBuyPrice = () => ({ price: 15.0, dateUsed: new Date("2025-02-18") });
    const chartData = validator.prepareChartData();

    // Check that all data points have valid y values
    chartData.datasets.forEach((dataset) => {
      dataset.data.forEach((point) => {
        assertEquals(typeof point.y, "number", "Y value should be a number");
        assertNotEquals(isNaN(point.y), true, "Y value should not be NaN");
        assertNotEquals(point.y, null, "Y value should not be null");
      });
    });
  });
}); 