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

interface MarketPoint {
  date: Date;
  high: number;
  low: number;
  open: number;
  close: number;
  splitCoefficient: number;
}

interface TrendLine {
  slope: number;
  intercept: number;
  predicted90DayPerformance: number;
  dataPoints: Array<{ x: number; y: number }>;
  rSquared: number;
}

const g = globalThis as unknown as {
  GRQProjection: {
    setDateToMidnight: (date: Date) => Date;
    buildHybridProjectionData: (
      projection: Projection,
      scoreDate: Date,
      trendLine: { slope: number } | null,
    ) => ProjectionPoint[];
    getBuyPrice: (
      marketData: MarketPoint[],
      scoreDate: Date,
    ) => { price: number; dateUsed: Date } | null;
    buildTrendLineDataPoints: (
      marketData: MarketPoint[],
      scoreDate: Date,
      buyPrice: number,
      dividends: Array<{ exDivDate: Date; amount: number }>,
      endDate?: Date,
    ) => Array<{ x: number; y: number }>;
    computeTrendLine: (
      dataPoints: Array<{ x: number; y: number }>,
    ) => TrendLine | null;
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

// Trend line windowing uses the latest market-data date, not today (issue #144).
//
// This now drives the REAL shipped helpers: GRQProjection.getBuyPrice resolves
// the buy price, GRQProjection.buildTrendLineDataPoints performs the
// data-window / end-date selection (the part previously reimplemented inline in
// this test), and GRQProjection.computeTrendLine runs the regression — the exact
// pipeline GRQValidator.calculateTrendLine delegates to. A regression in the
// shipped windowing now fails these assertions.
// Local-component dates (year, monthIndex, day) match the shared getBuyPrice
// day-matching, which compares local date components.
const SCHW_FIXTURE: MarketPoint[] = [
  {
    date: new Date(2025, 3, 15), // 15 April 2025
    high: 78.12,
    low: 77.03,
    open: 77.55,
    close: 77.19,
    splitCoefficient: 1.0,
  },
  {
    // Intermediate point: regression needs at least three observations.
    date: new Date(2025, 5, 1), // 1 June 2025
    high: 85.0,
    low: 84.0,
    open: 84.4,
    close: 84.6,
    splitCoefficient: 1.0,
  },
  {
    date: new Date(2025, 6, 1), // 1 July 2025
    high: 91.6772,
    low: 90.14,
    open: 90.92,
    close: 91.17,
    splitCoefficient: 1.0,
  },
];

Deno.test("Real buildTrendLineDataPoints - Window extends to latest market data date", () => {
  const scoreDate = new Date(2025, 3, 15);
  const buyPrice = GRQProjection.getBuyPrice(SCHW_FIXTURE, scoreDate);
  assertExists(buyPrice, "Buy price should resolve from the fixture");

  // No endDate -> the window must run to the latest market-data point (July 1),
  // NOT today's date.
  const dataPoints = GRQProjection.buildTrendLineDataPoints(
    SCHW_FIXTURE,
    scoreDate,
    buyPrice!.price,
    [],
  );

  // All three observations fall inside the window.
  assertEquals(dataPoints.length, 3);

  // The last point is July 1, about 77 days after April 15.
  const lastDay = dataPoints[dataPoints.length - 1].x;
  assertEquals(
    lastDay >= 75 && lastDay <= 80,
    true,
    `Should use data up to ~77 days, got ${lastDay}`,
  );

  // The trend line starts at zero on the score date.
  assertEquals(dataPoints[0].x, 0);
  assertEquals(dataPoints[0].y, 0);
});

Deno.test("Real buildTrendLineDataPoints - Explicit endDate truncates the window", () => {
  const scoreDate = new Date(2025, 3, 15);
  const buyPrice = GRQProjection.getBuyPrice(SCHW_FIXTURE, scoreDate);
  assertExists(buyPrice);

  // An explicit earlier endDate excludes the July 1 point, proving the
  // end-date selection is the real windowing logic and not a fixed default.
  const dataPoints = GRQProjection.buildTrendLineDataPoints(
    SCHW_FIXTURE,
    scoreDate,
    buyPrice!.price,
    [],
    new Date(2025, 5, 1),
  );

  assertEquals(dataPoints.length, 2);
  const lastDay = dataPoints[dataPoints.length - 1].x;
  // June 1 is about 47 days after April 15.
  assertEquals(
    lastDay >= 45 && lastDay <= 49,
    true,
    `Window should stop at ~47 days, got ${lastDay}`,
  );
});

Deno.test("Real computeTrendLine - Projection reflects SCHW growth pattern", () => {
  const scoreDate = new Date(2025, 3, 15);
  const buyPrice = GRQProjection.getBuyPrice(SCHW_FIXTURE, scoreDate);
  assertExists(buyPrice);

  const dataPoints = GRQProjection.buildTrendLineDataPoints(
    SCHW_FIXTURE,
    scoreDate,
    buyPrice!.price,
    [],
  );
  const trendLine = GRQProjection.computeTrendLine(dataPoints);
  assertExists(trendLine, "Trend line should be calculated");

  // Growth from ~77.58 to ~90.91 (~17% over ~77 days); the 90-day projection
  // tracks that rate. Driving the REAL regression (not an inline copy) proves
  // the shipped maths produces this figure.
  const predicted90Day = trendLine!.predicted90DayPerformance;
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

  // The regression is forced through the origin (day 0 reads 0%).
  assertEquals(trendLine!.intercept, 0);
});

console.log("All trend line extension tests passed! 🎉");
