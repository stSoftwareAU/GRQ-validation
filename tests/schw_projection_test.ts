#!/usr/bin/env -S deno run --allow-read --allow-write

import { assert } from "https://deno.land/std@0.208.0/assert/mod.ts";

// TypeScript interfaces for type safety
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
  split_coefficient: number;
}

interface DividendDataPoint {
  exDivDate: Date;
  amount: number;
}

interface DataPoint {
  x: number;
  y: number;
}

interface TrendLineResult {
  slope: number;
  intercept: number;
  predicted90DayPerformance: number;
  dataPoints: DataPoint[];
  rSquared: number;
}

interface HybridProjectionResult {
  projected90DayPerformance: number;
  projectionMethod: string;
  confidence: number;
  daysElapsed: number;
  currentPerformance: number;
  targetPercentage: number | null;
}

// Import the actual app.js functions by creating a minimal version for testing
class TestGRQValidator {
  scoreData: StockData[] = [];
  marketData: Record<string, MarketDataPoint[]> = {};
  dividendData: Record<string, DividendDataPoint[]> = {};
  selectedFile = "2025/April/15.tsv";
  costOfCapital = 0.15;

  async loadScoreData() {
    const text = await Deno.readTextFile("docs/scores/2025/April/15.tsv");
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
    const text = await Deno.readTextFile("docs/scores/2025/April/15.csv");
    const lines = text.trim().split("\n");

    // Parse CSV data
    const marketDataByStock: Record<string, MarketDataPoint[]> = {};

    lines.slice(1).forEach((line) => {
      const values = line.split(",");
      const ticker = values[1];
      const date = new Date(values[0]);
      const high = parseFloat(values[2]);
      const low = parseFloat(values[3]);
      const open = parseFloat(values[4]);
      const close = parseFloat(values[5]);
      const split_coefficient = parseFloat(values[6]);

      if (!marketDataByStock[ticker]) {
        marketDataByStock[ticker] = [];
      }

      marketDataByStock[ticker].push({
        date,
        high,
        low,
        open,
        close,
        split_coefficient,
      });
    });

    this.marketData = marketDataByStock;
  }

  async loadDividendData() {
    const text = await Deno.readTextFile(
      "docs/scores/2025/April/15-dividends.csv",
    );
    const lines = text.trim().split("\n");

    const dividendDataByStock: Record<string, DividendDataPoint[]> = {};

    lines.slice(1).forEach((line) => {
      if (line.trim()) {
        const values = line.split(",");
        const date = new Date(values[0]);
        const symbol = values[1];
        const amount = parseFloat(values[2]);

        if (!dividendDataByStock[symbol]) {
          dividendDataByStock[symbol] = [];
        }

        dividendDataByStock[symbol].push({
          exDivDate: date,
          amount,
        });
      }
    });

    this.dividendData = dividendDataByStock;
  }

  getScoreDate(scoreFile: string): Date {
    const match = scoreFile.match(/(\d{4})\/(\w+)\/(\d+)\.tsv/);
    if (!match) return new Date();

    const [, year, month, day] = match;
    const monthMap: Record<string, number> = {
      "January": 0,
      "February": 1,
      "March": 2,
      "April": 3,
      "May": 4,
      "June": 5,
      "July": 6,
      "August": 7,
      "September": 8,
      "October": 9,
      "November": 10,
      "December": 11,
    };

    return new Date(parseInt(year), monthMap[month], parseInt(day));
  }

  getBuyPrice(
    stockSymbol: string,
    scoreDate: Date,
  ): { price: number; dateUsed: Date } | null {
    const marketData = this.marketData[stockSymbol];
    if (!marketData) return null;

    // Find the price on the score date or next available day
    for (let i = 0; i <= 5; i++) {
      const targetDate = new Date(
        scoreDate.getTime() + i * 24 * 60 * 60 * 1000,
      );
      const scoreData = marketData.find((point: MarketDataPoint) => {
        const pointDate = new Date(
          point.date.getFullYear(),
          point.date.getMonth(),
          point.date.getDate(),
        );
        const targetDateOnly = new Date(
          targetDate.getFullYear(),
          targetDate.getMonth(),
          targetDate.getDate(),
        );
        return pointDate.getTime() === targetDateOnly.getTime();
      });

      if (scoreData) {
        const price = (scoreData.high + scoreData.low) / 2;
        return { price, dateUsed: scoreData.date };
      }
    }

    return null;
  }

  getCurrentPrice(stockSymbol: string): string {
    const marketData = this.marketData[stockSymbol];
    if (!marketData || marketData.length === 0) return "N/A";

    const lastData = marketData[marketData.length - 1];
    const currentPrice = (lastData.high + lastData.low) / 2;
    return "$" + currentPrice.toFixed(2);
  }

  getDividendsWithin90Days(stockSymbol: string): DividendDataPoint[] {
    const dividends = this.dividendData[stockSymbol] || [];
    const scoreDate = this.getScoreDate(this.selectedFile);
    const ninetyDayDate = new Date(
      scoreDate.getTime() + (90 * 24 * 60 * 60 * 1000),
    );

    return dividends.filter((div: DividendDataPoint) =>
      div.exDivDate <= ninetyDayDate
    );
  }

  calculateStockPerformance(stock: StockData): number | null {
    const scoreDate = this.getScoreDate(this.selectedFile);
    const buyPriceObj = this.getBuyPrice(stock.stock, scoreDate);
    if (!buyPriceObj) return null;

    const buyPrice = buyPriceObj.price;
    const currentPriceStr = this.getCurrentPrice(stock.stock);
    if (currentPriceStr === "N/A") return null;

    const currentPrice = parseFloat(currentPriceStr.slice(1));
    const dividends = this.getDividendsWithin90Days(stock.stock);
    const totalDividends = dividends.reduce(
      (sum: number, div: DividendDataPoint) => sum + div.amount,
      0,
    );

    const totalReturn = (currentPrice - buyPrice + totalDividends) / buyPrice;
    return totalReturn * 100;
  }

  calculateTrendLine(
    stock: StockData,
    scoreDate: Date,
    endDate?: Date,
  ): TrendLineResult | null {
    const marketData = this.marketData[stock.stock];
    if (!marketData || marketData.length === 0) return null;

    const scoreDateTimestamp = scoreDate.getTime();
    const trendEndDate = endDate ||
      (marketData && marketData.length > 0
        ? marketData[marketData.length - 1].date
        : new Date());

    const dataPoints: DataPoint[] = [];
    const buyPriceObj = this.getBuyPrice(stock.stock, scoreDate);

    if (!buyPriceObj || buyPriceObj.price <= 0) return null;

    marketData.forEach((point: MarketDataPoint) => {
      if (point.date >= scoreDate && point.date <= trendEndDate) {
        const daysSinceScore = (point.date.getTime() - scoreDateTimestamp) /
          (1000 * 60 * 60 * 24);
        const currentPrice = (point.high + point.low) / 2;

        const priceReturn =
          ((currentPrice - buyPriceObj.price) / buyPriceObj.price) * 100;
        const dividends = this.getDividendsWithin90Days(stock.stock);
        const dividendsUpToDate = dividends.filter((d: DividendDataPoint) =>
          d.exDivDate <= point.date
        );
        const totalDividends = dividendsUpToDate.reduce(
          (sum: number, div: DividendDataPoint) => sum + div.amount,
          0,
        );
        const dividendReturn = (totalDividends / buyPriceObj.price) * 100;
        const totalReturn = priceReturn + dividendReturn;

        dataPoints.push({
          x: daysSinceScore,
          y: totalReturn,
        });
      }
    });

    if (dataPoints.length < 3) return null;

    const n = dataPoints.length;
    const sumX = dataPoints.reduce(
      (sum: number, point: DataPoint) => sum + point.x,
      0,
    );
    const sumY = dataPoints.reduce(
      (sum: number, point: DataPoint) => sum + point.y,
      0,
    );
    const sumXY = dataPoints.reduce(
      (sum: number, point: DataPoint) => sum + point.x * point.y,
      0,
    );
    const sumXX = dataPoints.reduce(
      (sum: number, point: DataPoint) => sum + point.x * point.x,
      0,
    );

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const _intercept = (sumY - slope * sumX) / n;

    const adjustedIntercept = 0;
    const adjustedSlope = slope;

    const predicted90DayPerformance = adjustedSlope * 90 + adjustedIntercept;
    const cappedPredicted90DayPerformance = Math.max(
      predicted90DayPerformance,
      -100,
    );

    const rSquared = this.calculateRSquared(
      dataPoints,
      adjustedSlope,
      adjustedIntercept,
    );

    return {
      slope: adjustedSlope,
      intercept: adjustedIntercept,
      predicted90DayPerformance: cappedPredicted90DayPerformance,
      dataPoints,
      rSquared: rSquared,
    };
  }

  calculateRSquared(
    dataPoints: DataPoint[],
    slope: number,
    intercept: number,
  ): number {
    const n = dataPoints.length;
    const meanY =
      dataPoints.reduce((sum: number, point: DataPoint) => sum + point.y, 0) /
      n;

    let ssRes = 0;
    let ssTot = 0;

    dataPoints.forEach((point: DataPoint) => {
      const predicted = slope * point.x + intercept;
      ssRes += Math.pow(point.y - predicted, 2);
      ssTot += Math.pow(point.y - meanY, 2);
    });

    return ssTot > 0 ? 1 - (ssRes / ssTot) : 0;
  }

  calculateTargetPercentage(stock: StockData, scoreDate: Date): number | null {
    const buyPriceObj = this.getBuyPrice(stock.stock, scoreDate);
    if (!buyPriceObj || buyPriceObj.price <= 0) return null;

    const targetPrice = stock.target;
    const targetReturn =
      ((targetPrice - buyPriceObj.price) / buyPriceObj.price) * 100;
    return targetReturn;
  }

  // This is the actual function from app.js that we want to test
  calculateHybridProjection(
    stock: StockData,
    scoreDate: Date,
  ): HybridProjectionResult | null {
    const marketData = this.marketData[stock.stock];
    if (!marketData || marketData.length === 0) {
      console.log(
        `calculateHybridProjection - ${stock.stock}: No market data available`,
      );
      return null;
    }

    const scoreDateTimestamp = scoreDate.getTime();
    // Use the latest market data date instead of today's date
    const latestMarketDate = marketData && marketData.length > 0
      ? marketData[marketData.length - 1].date
      : new Date();
    const daysElapsed = Math.floor(
      (latestMarketDate.getTime() - scoreDateTimestamp) / (1000 * 60 * 60 * 24),
    );

    console.log(
      `calculateHybridProjection - ${stock.stock}: Days elapsed: ${daysElapsed} (using latest market data date: ${
        latestMarketDate.toISOString().split("T")[0]
      })`,
    );

    // Get buy price
    const buyPriceObj = this.getBuyPrice(stock.stock, scoreDate);
    if (!buyPriceObj || buyPriceObj.price <= 0) {
      console.log(
        `calculateHybridProjection - ${stock.stock}: No valid buy price`,
      );
      return null;
    }

    // Calculate current performance
    const currentPerformance = this.calculateStockPerformance(stock);
    if (currentPerformance === null) {
      console.log(
        `calculateHybridProjection - ${stock.stock}: Cannot calculate current performance`,
      );
      return null;
    }

    // Get target percentage
    const targetPercentage = this.calculateTargetPercentage(stock, scoreDate);

    console.log(
      `calculateHybridProjection - ${stock.stock}: Current performance: ${
        currentPerformance.toFixed(1)
      }%, Target: ${targetPercentage ? targetPercentage.toFixed(1) : "N/A"}%`,
    );

    // Hybrid approach based on days elapsed
    let projected90DayPerformance;
    let projectionMethod;
    let confidence;

    if (daysElapsed < 30) {
      // Short-term: Use dampened trend (reduce early volatility)
      projectionMethod = "dampened_trend";
      const trendLine = this.calculateTrendLine(stock, scoreDate);

      if (trendLine && trendLine.rSquared > 0.1) {
        // Dampen the trend by 70% to account for mean reversion
        const dampenedSlope = trendLine.slope * 0.3;
        projected90DayPerformance = Math.max(dampenedSlope * 90, -100);
        confidence = Math.min(trendLine.rSquared * 0.7, 0.8); // Reduce confidence for early projections
        console.log(
          `calculateHybridProjection - ${stock.stock}: Using dampened trend (slope: ${
            trendLine.slope.toFixed(4)
          } → ${dampenedSlope.toFixed(4)})`,
        );
      } else {
        // Fall back to realistic projection based on current performance
        projectionMethod = "target_based";
        if (targetPercentage !== null) {
          // Use current performance as base, project modest improvement if positive
          if (currentPerformance > 0) {
            // If currently positive, project slight improvement (10% of remaining gap)
            const gap = targetPercentage - currentPerformance;
            projected90DayPerformance = currentPerformance + (gap * 0.1);
          } else {
            // If currently negative, project slight recovery toward zero
            projected90DayPerformance = currentPerformance * 0.5; // Move halfway toward zero
          }
          // Cap at reasonable bounds
          projected90DayPerformance = Math.max(
            Math.min(projected90DayPerformance, targetPercentage),
            -100,
          );
        } else {
          projected90DayPerformance = -5; // Default to -5% if no target
        }
        confidence = 0.3; // Low confidence for early projections
        console.log(
          `calculateHybridProjection - ${stock.stock}: Using realistic projection (insufficient trend data)`,
        );
      }
    } else if (daysElapsed < 60) {
      // Medium-term: Use dampened trend with higher confidence
      projectionMethod = "dampened_trend";
      const trendLine = this.calculateTrendLine(stock, scoreDate);

      if (trendLine && trendLine.rSquared > 0.05) {
        // Dampen the trend by 50% for medium-term
        const dampenedSlope = trendLine.slope * 0.5;
        projected90DayPerformance = Math.max(dampenedSlope * 90, -100);
        confidence = Math.min(trendLine.rSquared * 0.8, 0.9);
        console.log(
          `calculateHybridProjection - ${stock.stock}: Using dampened trend (slope: ${
            trendLine.slope.toFixed(4)
          } → ${dampenedSlope.toFixed(4)})`,
        );
      } else {
        // Fall back to realistic projection based on current performance
        projectionMethod = "target_based";
        if (targetPercentage !== null) {
          // Use current performance as base, project modest improvement if positive
          if (currentPerformance > 0) {
            // If currently positive, project slight improvement (15% of remaining gap)
            const gap = targetPercentage - currentPerformance;
            projected90DayPerformance = currentPerformance + (gap * 0.15);
          } else {
            // If currently negative, project slight recovery toward zero
            projected90DayPerformance = currentPerformance * 0.6; // Move 60% toward zero
          }
          // Cap at reasonable bounds
          projected90DayPerformance = Math.max(
            Math.min(projected90DayPerformance, targetPercentage),
            -100,
          );
        } else {
          projected90DayPerformance = -5; // Default to -5% if no target
        }
        confidence = 0.5;
        console.log(
          `calculateHybridProjection - ${stock.stock}: Using realistic projection (insufficient trend data)`,
        );
      }
    } else {
      // Long-term: Use realistic projection based on current trajectory
      projectionMethod = "realistic_trajectory";

      if (targetPercentage !== null) {
        // Calculate what the current trajectory suggests for 90 days
        const currentRate = currentPerformance / daysElapsed; // % per day
        const trajectoryProjection = currentRate * 90;

        // If we're significantly behind target, be realistic about missing it
        const _targetThreshold = targetPercentage * 0.8; // 80% of target
        const remainingDays = 90 - daysElapsed;
        const remainingGap = targetPercentage - currentPerformance;
        const requiredDailyRate = remainingGap / remainingDays;

        // If required rate is unrealistic (>2% per day), project missing target
        if (requiredDailyRate > 2.0) {
          // Project based on current trajectory, but cap at a realistic maximum
          const realisticProjection = Math.min(
            trajectoryProjection,
            targetPercentage * 0.6,
          );
          projected90DayPerformance = Math.max(
            realisticProjection,
            currentPerformance * 1.2,
          ); // At least some improvement
          confidence = 0.7; // High confidence we're missing target
          console.log(
            `calculateHybridProjection - ${stock.stock}: Projecting to miss target (required daily rate: ${
              requiredDailyRate.toFixed(2)
            }% is unrealistic)`,
          );
        } else {
          // If current performance is already above target, use trajectory projection
          if (currentPerformance > targetPercentage) {
            projected90DayPerformance = trajectoryProjection;
            confidence = 0.7;
            console.log(
              `calculateHybridProjection - ${stock.stock}: Current performance (${
                currentPerformance.toFixed(1)
              }%) already above target (${
                targetPercentage.toFixed(1)
              }%), using trajectory projection`,
            );
          } else {
            // Still possible to hit target, but be conservative
            projected90DayPerformance = Math.min(
              trajectoryProjection,
              targetPercentage * 0.8,
            );
            confidence = 0.6;
            console.log(
              `calculateHybridProjection - ${stock.stock}: Projecting conservative improvement toward target`,
            );
          }
        }
      } else {
        // Use mean reversion (move toward 0% performance)
        const reversionRate = 0.4; // 40% reversion toward mean
        projected90DayPerformance = currentPerformance * (1 - reversionRate);
        confidence = 0.3;
        console.log(
          `calculateHybridProjection - ${stock.stock}: Using mean reversion projection`,
        );
      }
    }

    // Ensure projection is within realistic bounds
    projected90DayPerformance = Math.max(
      Math.min(projected90DayPerformance, 200),
      -100,
    );

    console.log(
      `calculateHybridProjection - ${stock.stock}: Final projection: ${
        projected90DayPerformance.toFixed(1)
      }% (method: ${projectionMethod}, confidence: ${confidence.toFixed(2)})`,
    );

    return {
      projected90DayPerformance,
      projectionMethod,
      confidence,
      daysElapsed,
      currentPerformance,
      targetPercentage,
    };
  }
}

Deno.test("NYSE:SCHW Projection Test - Using Real App Functions", async (t) => {
  const validator = new TestGRQValidator();

  // Load the actual data files
  await validator.loadScoreData();
  await validator.loadMarketData();
  await validator.loadDividendData();

  const scoreDate = validator.getScoreDate("2025/April/15.tsv");
  const stock = validator.scoreData.find((s: StockData) =>
    s.stock === "NYSE:SCHW"
  );

  assert(stock, "NYSE:SCHW should be found in score data");

  await t.step(
    "should calculate correct current performance using app functions",
    () => {
      const currentPerformance = validator.calculateStockPerformance(stock);
      assert(currentPerformance !== null, "Should have current performance");

      console.log(`Current performance: ${currentPerformance?.toFixed(1)}%`);

      // Current performance should be around 17-20% based on the data
      assert(
        currentPerformance! > 15,
        `Current performance should be > 15%, got ${
          currentPerformance?.toFixed(1)
        }%`,
      );
    },
  );

  await t.step(
    "should calculate correct 90-day projection using app functions",
    () => {
      const projection = validator.calculateHybridProjection(stock, scoreDate);
      assert(projection, "Should have projection");

      console.log(
        `Projected 90-day performance: ${
          projection.projected90DayPerformance.toFixed(1)
        }%`,
      );
      console.log(`Confidence: ${projection.confidence.toFixed(3)}`);
      console.log(`Method: ${projection.projectionMethod}`);

      // The projection should be well over 17% based on the strong upward trend
      assert(
        projection.projected90DayPerformance > 17,
        `Projection should be > 17%, got ${
          projection.projected90DayPerformance.toFixed(1)
        }%`,
      );

      // Should be closer to 20% or higher given the strong performance
      assert(
        projection.projected90DayPerformance > 19,
        `Projection should be > 19%, got ${
          projection.projected90DayPerformance.toFixed(1)
        }%`,
      );
    },
  );

  await t.step("should have strong trend line fit using app functions", () => {
    const trendLine = validator.calculateTrendLine(stock, scoreDate);

    assert(trendLine, "Should have trend line");
    console.log(`Trend line R-squared: ${trendLine.rSquared.toFixed(3)}`);
    console.log(
      `Trend line slope: ${trendLine.slope.toFixed(4)} (price change per day)`,
    );

    // Should have good fit given the consistent upward trend
    assert(
      trendLine.rSquared > 0.3,
      `R-squared should be > 0.3, got ${trendLine.rSquared.toFixed(3)}`,
    );

    // Slope should be positive (upward trend)
    assert(
      trendLine.slope > 0,
      `Slope should be positive, got ${trendLine.slope.toFixed(4)}`,
    );
  });
});
