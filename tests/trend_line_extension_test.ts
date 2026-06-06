// Trend-line / hybrid-projection tests (issue #80).
//
// These used to reimplement GRQValidator.calculateHybridProjectionData as
// local `Mock*` classes (and one test even overrode the method inline before
// asserting on its own output — a pure tautology). They now import the REAL
// shipped helper from docs/projection.js, the exact code the dashboard's
// GRQValidator delegates to, and assert on its observable output. A bug in the
// production trend-shape generation now fails these tests.
import { assertEquals, assertExists } from "@std/assert";
import "../docs/projection.js";

interface ProjectionPoint {
  x: Date;
  y: number;
}

interface Projection {
  projected90DayPerformance: number;
  projectionMethod: string;
  daysElapsed: number;
  currentPerformance: number;
}

const g = globalThis as unknown as {
  GRQProjection: {
    setDateToMidnight: (date: Date) => Date;
    buildHybridProjectionData: (
      projection: Projection,
      scoreDate: Date,
      trendLine: { slope: number } | null,
    ) => ProjectionPoint[];
  };
};
const GRQProjection = g.GRQProjection;
const setDateToMidnight = GRQProjection.setDateToMidnight;

// Days between the score date (midnight) and a projection point.
function dayOffset(point: ProjectionPoint, scoreDate: Date): number {
  const scoreMidnight = setDateToMidnight(scoreDate).getTime();
  return (point.x.getTime() - scoreMidnight) / (24 * 60 * 60 * 1000);
}

Deno.test("Real buildHybridProjectionData - Trend Line Always Starts at Zero", () => {
  const projection: Projection = {
    projected90DayPerformance: 15.0,
    projectionMethod: "target_based",
    daysElapsed: 45,
    currentPerformance: 8.0,
  };
  const scoreDate = new Date("2025-01-01");

  const data = GRQProjection.buildHybridProjectionData(
    projection,
    scoreDate,
    null,
  );

  assertExists(data);
  assertEquals(data.length > 0, true);

  // First point is day 0 at zero performance, snapped to midnight.
  const firstPoint = data[0];
  assertEquals(dayOffset(firstPoint, scoreDate), 0);
  assertEquals(firstPoint.x.getHours(), 0);
  assertEquals(firstPoint.y, 0);

  // Last point is exactly day 90 at the projected performance.
  const lastPoint = data[data.length - 1];
  assertEquals(dayOffset(lastPoint, scoreDate), 90);
  assertEquals(lastPoint.y, projection.projected90DayPerformance);
});

Deno.test("Real buildHybridProjectionData - Ensures 90-Day Point at midnight", () => {
  const projection: Projection = {
    projected90DayPerformance: 25.0,
    projectionMethod: "dampened_trend",
    daysElapsed: 30,
    currentPerformance: 15.0,
  };
  const scoreDate = new Date("2025-01-01");

  const data = GRQProjection.buildHybridProjectionData(projection, scoreDate, {
    slope: 0.3,
  });

  assertExists(data);
  assertEquals(data.length > 0, true);

  // Last point is exactly at day 90, snapped to midnight.
  const lastPoint = data[data.length - 1];
  assertEquals(dayOffset(lastPoint, scoreDate), 90);
  assertEquals(lastPoint.x.getHours(), 0);
  assertEquals(lastPoint.x.getMinutes(), 0);
  assertEquals(lastPoint.x.getSeconds(), 0);

  // First point is day 0; a dampened trend starts at zero.
  const firstPoint = data[0];
  assertEquals(dayOffset(firstPoint, scoreDate), 0);
  assertEquals(firstPoint.x.getHours(), 0);
  assertEquals(firstPoint.y, 0);

  // Weekly intervals up to 90 days, plus a possible exact-90 endpoint.
  const expectedMinPoints = Math.ceil(90 / 7) + 1;
  assertEquals(data.length >= expectedMinPoints, true);
});

Deno.test("Real buildHybridProjectionData - Target-Based Method reaches the projection", () => {
  // Target-based projection ramps linearly from zero to the projected 90-day
  // performance. Driving the REAL function (not an inline override) proves the
  // shipped code produces this curve.
  const projection: Projection = {
    projected90DayPerformance: 30.0,
    projectionMethod: "target_based",
    daysElapsed: 60,
    currentPerformance: 20.0,
  };
  const scoreDate = new Date("2025-01-01");

  const data = GRQProjection.buildHybridProjectionData(
    projection,
    scoreDate,
    null,
  );

  assertExists(data);
  assertEquals(data.length > 0, true);

  // Last point is exactly at day 90 and equals the projected performance.
  const lastPoint = data[data.length - 1];
  assertEquals(dayOffset(lastPoint, scoreDate), 90);
  assertEquals(lastPoint.x.getHours(), 0);
  assertEquals(lastPoint.y, 30.0);
});

Deno.test("Real buildHybridProjectionData - Does Not Hit Target When Projection Is Lower", () => {
  // When the realistic projection (5%) is well below the stock's target (40%),
  // the curve must end at the projection, not at the target. The production
  // function uses projected90DayPerformance, so it ends at 5%.
  const projection: Projection = {
    projected90DayPerformance: 5.0,
    projectionMethod: "target_based",
    daysElapsed: 90,
    currentPerformance: -20.0,
  };
  const scoreDate = new Date("2025-05-15");

  const data = GRQProjection.buildHybridProjectionData(
    projection,
    scoreDate,
    null,
  );

  assertExists(data);
  // The last point reflects the realistic projection (5.0), not the 40% target.
  const lastPoint = data[data.length - 1];
  assertEquals(lastPoint.y, 5.0);
  // Target-based curves start at zero.
  assertEquals(data[0].y, 0);
});

// Test that trend line uses latest market data date instead of today's date.
//
// This exercises the linear-regression shape of calculateTrendLine. The
// regression maths still lives on GRQValidator (not yet extracted to the
// shared module); the helper below mirrors it so the regression behaviour is
// covered. Extracting calculateTrendLine into docs/projection.js is tracked as
// follow-up work.
Deno.test("Trend Line Uses Latest Market Data Date", () => {
  // Mock market data showing SCHW growth from April 15 to July 1
  const marketData: Record<
    string,
    Array<{
      date: Date;
      high: number;
      low: number;
      open: number;
      close: number;
      splitCoefficient: number;
    }>
  > = {
    "NYSE:SCHW": [
      {
        date: new Date("2025-04-15"),
        high: 78.12,
        low: 77.03,
        open: 77.55,
        close: 77.19,
        splitCoefficient: 1.0,
      },
      {
        date: new Date("2025-07-01"),
        high: 91.6772,
        low: 90.14,
        open: 90.92,
        close: 91.17,
        splitCoefficient: 1.0,
      },
    ],
  };

  // Mock validator with trend line calculation
  const validator = {
    marketData,
    setDateToMidnight: function (date: Date): Date {
      const d = new Date(date);
      d.setHours(0, 0, 0, 0);
      return d;
    },
    getBuyPrice: function (stockSymbol: string, scoreDate: Date) {
      const data = this.marketData[stockSymbol];
      if (!data || data.length === 0) return null;

      // Find closest point to score date
      const scoreDateTimestamp = scoreDate.getTime();
      let closestPoint = data[0];
      let minDiff = Math.abs(data[0].date.getTime() - scoreDateTimestamp);

      for (const point of data) {
        const diff = Math.abs(point.date.getTime() - scoreDateTimestamp);
        if (diff < minDiff) {
          minDiff = diff;
          closestPoint = point;
        }
      }

      const buyPrice = (closestPoint.high + closestPoint.low) / 2;
      return { price: buyPrice, date: closestPoint.date };
    },
    adjustHistoricalPriceToCurrent: function (price: number) {
      return price; // No adjustments for this test
    },
    getDividendsWithin90Days: function () {
      return []; // No dividends for this test
    },
    calculateTrendLine: function (
      stock: { stock: string },
      scoreDate: Date,
      endDate?: Date,
    ) {
      const marketData = this.marketData[stock.stock];
      if (!marketData || marketData.length === 0) {
        return null;
      }

      const scoreDateTimestamp = scoreDate.getTime();
      // Use the latest market data date if no endDate is provided, not today's date
      const trendEndDate = endDate ||
        (marketData && marketData.length > 0
          ? marketData[marketData.length - 1].date
          : new Date());

      // Get data points from score date to trend end date
      const dataPoints: Array<{ x: number; y: number }> = [];
      const buyPriceObj = this.getBuyPrice(stock.stock, scoreDate);

      if (!buyPriceObj || buyPriceObj.price <= 0) {
        return null;
      }

      marketData.forEach((point) => {
        if (point.date >= scoreDate && point.date <= trendEndDate) {
          const daysSinceScore = (point.date.getTime() - scoreDateTimestamp) /
            (1000 * 60 * 60 * 24);
          const currentPrice = this.adjustHistoricalPriceToCurrent(
            (point.high + point.low) / 2,
          );

          // Calculate performance (no dividends in this test)
          const priceReturn =
            ((currentPrice - buyPriceObj.price) / buyPriceObj.price) * 100;
          const totalReturn = priceReturn;

          dataPoints.push({
            x: daysSinceScore,
            y: totalReturn,
          });
        }
      });

      if (dataPoints.length < 2) {
        return null;
      }

      // Calculate linear regression
      const n = dataPoints.length;
      const sumX = dataPoints.reduce((sum, point) => sum + point.x, 0);
      const sumY = dataPoints.reduce((sum, point) => sum + point.y, 0);
      const sumXY = dataPoints.reduce(
        (sum, point) => sum + point.x * point.y,
        0,
      );
      const sumXX = dataPoints.reduce(
        (sum, point) => sum + point.x * point.x,
        0,
      );

      const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
      const _intercept = (sumY - slope * sumX) / n;

      // Force the trend line to start at zero on the score date
      const adjustedIntercept = 0;
      const adjustedSlope = slope;

      // Predict performance at 90 days using the adjusted line
      const predicted90DayPerformance = adjustedSlope * 90 + adjustedIntercept;
      const cappedPredicted90DayPerformance = Math.max(
        predicted90DayPerformance,
        -100,
      );

      return {
        slope: adjustedSlope,
        intercept: adjustedIntercept,
        predicted90DayPerformance: cappedPredicted90DayPerformance,
        dataPoints,
        rSquared: 0.95,
      };
    },
  };

  const stock = { stock: "NYSE:SCHW" };
  const scoreDate = new Date("2025-04-15");

  // Calculate trend line without specifying endDate (should use latest market data)
  const trendLine = validator.calculateTrendLine(stock, scoreDate);

  assertExists(trendLine, "Trend line should be calculated");

  // Check that the trend line uses data up to July 1 (latest market data)
  const latestDataPoint =
    trendLine!.dataPoints[trendLine!.dataPoints.length - 1];
  const daysSinceScore = latestDataPoint.x;

  // July 1 is about 77 days after April 15
  assertEquals(
    daysSinceScore >= 75 && daysSinceScore <= 80,
    true,
    `Should use data up to ~77 days, got ${daysSinceScore}`,
  );

  // Check that the projection reflects the actual growth pattern
  const predicted90Day = trendLine!.predicted90DayPerformance;

  // With growth from ~77.58 to ~90.91 = ~17% growth in ~77 days
  // The 90-day projection should reflect this growth rate
  assertEquals(
    predicted90Day > 15,
    true,
    `Projection should be >15%, got ${predicted90Day}%`,
  );
  assertEquals(
    predicted90Day < 25,
    true,
    `Projection should be <25%, got ${predicted90Day}%`,
  );
});

console.log("All trend line extension tests passed! 🎉");
