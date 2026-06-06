// Tests for the shared projection/scoring module (issue #80).
//
// These import the REAL shipped helpers from docs/projection.js — the same
// code the dashboard's GRQValidator delegates to — and assert on their
// observable output. They replace the former tautological tests that
// reimplemented the algorithms as local mocks and asserted on the copy.
import { assert, assertEquals } from "@std/assert";
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
    getDaysElapsed: (scoreDate: Date, today: Date) => number;
    calculatePerformanceReturn: (
      buyPrice: number,
      currentPrice: number,
      totalDividends?: number,
    ) => number | null;
    buildHybridProjectionData: (
      projection: Projection,
      scoreDate: Date,
      trendLine: { slope: number } | null,
    ) => ProjectionPoint[];
  };
};
const GRQProjection = g.GRQProjection;

Deno.test("projection.js publishes helpers on globalThis", () => {
  assertEquals(typeof GRQProjection, "object");
  assertEquals(typeof GRQProjection.getDaysElapsed, "function");
  assertEquals(typeof GRQProjection.calculatePerformanceReturn, "function");
  assertEquals(typeof GRQProjection.buildHybridProjectionData, "function");
});

Deno.test("setDateToMidnight zeroes the time and does not mutate input", () => {
  const input = new Date("2025-01-15T13:45:30.500");
  const result = GRQProjection.setDateToMidnight(input);
  assertEquals(result.getHours(), 0);
  assertEquals(result.getMinutes(), 0);
  assertEquals(result.getSeconds(), 0);
  assertEquals(result.getMilliseconds(), 0);
  // The original Date is untouched.
  assertEquals(input.getHours(), 13);
});

Deno.test("getDaysElapsed counts calendar days between dates", () => {
  const scoreDate = new Date("2024-11-15");
  const today = new Date("2025-02-13"); // exactly 90 days later
  assertEquals(GRQProjection.getDaysElapsed(scoreDate, today), 90);
});

Deno.test("getDaysElapsed is symmetric (absolute difference)", () => {
  const a = new Date("2025-01-01");
  const b = new Date("2025-01-11");
  assertEquals(GRQProjection.getDaysElapsed(a, b), 10);
  assertEquals(GRQProjection.getDaysElapsed(b, a), 10);
});

Deno.test("calculatePerformanceReturn sums price and dividend returns", () => {
  // $100 -> $120 is +20%; $2 of dividends adds another +2%.
  const result = GRQProjection.calculatePerformanceReturn(100, 120, 2);
  assert(result !== null);
  assertEquals(result, 22);
});

Deno.test("calculatePerformanceReturn handles a price loss", () => {
  // $100 -> $80 with no dividends is -20%.
  assertEquals(GRQProjection.calculatePerformanceReturn(100, 80, 0), -20);
});

Deno.test("calculatePerformanceReturn returns null for an invalid buy price", () => {
  assertEquals(GRQProjection.calculatePerformanceReturn(0, 120, 0), null);
  assertEquals(GRQProjection.calculatePerformanceReturn(-5, 120, 0), null);
});

Deno.test("buildHybridProjectionData (target_based) ramps from zero to projection", () => {
  const scoreDate = new Date("2025-01-01");
  const projection: Projection = {
    projected90DayPerformance: 30.0,
    projectionMethod: "target_based",
    daysElapsed: 60,
    currentPerformance: 20.0,
  };

  const data = GRQProjection.buildHybridProjectionData(
    projection,
    scoreDate,
    null,
  );

  // Starts at day 0 with zero performance.
  const scoreMidnight = GRQProjection.setDateToMidnight(scoreDate).getTime();
  const firstDay = (data[0].x.getTime() - scoreMidnight) /
    (24 * 60 * 60 * 1000);
  assertEquals(firstDay, 0);
  assertEquals(data[0].y, 0);
  assertEquals(data[0].x.getHours(), 0);

  // Ends exactly at day 90 with the projected performance.
  const last = data[data.length - 1];
  const lastDay = (last.x.getTime() - scoreMidnight) / (24 * 60 * 60 * 1000);
  assertEquals(lastDay, 90);
  assertEquals(last.y, 30.0);
});

Deno.test("buildHybridProjectionData (dampened_trend) follows the trend slope", () => {
  const scoreDate = new Date("2025-01-01");
  const projection: Projection = {
    projected90DayPerformance: 25.0,
    projectionMethod: "dampened_trend",
    daysElapsed: 30,
    currentPerformance: 15.0,
  };
  // daysElapsed >= 30 -> dampen factor 0.5; slope 0.4 -> dampened 0.2.
  const data = GRQProjection.buildHybridProjectionData(projection, scoreDate, {
    slope: 0.4,
  });

  assertEquals(data[0].y, 0); // day 0 -> 0.2 * 0 = 0
  const last = data[data.length - 1];
  const scoreMidnight = GRQProjection.setDateToMidnight(scoreDate).getTime();
  const lastDay = (last.x.getTime() - scoreMidnight) / (24 * 60 * 60 * 1000);
  assertEquals(lastDay, 90);
  assertEquals(last.y, 0.2 * 90); // 18.0
});

Deno.test("buildHybridProjectionData (dampened_trend) yields no points without a trend line", () => {
  const scoreDate = new Date("2025-01-01");
  const projection: Projection = {
    projected90DayPerformance: 25.0,
    projectionMethod: "dampened_trend",
    daysElapsed: 30,
    currentPerformance: 15.0,
  };
  const data = GRQProjection.buildHybridProjectionData(
    projection,
    scoreDate,
    null,
  );
  assertEquals(data.length, 0);
});

Deno.test("buildHybridProjectionData (realistic_trajectory) interpolates then extrapolates", () => {
  const scoreDate = new Date("2025-01-01");
  const projection: Projection = {
    projected90DayPerformance: 18.0,
    projectionMethod: "realistic_trajectory",
    daysElapsed: 28,
    currentPerformance: 14.0, // 0.5% per day up to day 28
  };
  const data = GRQProjection.buildHybridProjectionData(
    projection,
    scoreDate,
    null,
  );

  // Day 0 starts at zero.
  assertEquals(data[0].y, 0);
  // Day 14 (<= daysElapsed) interpolates: 14/28 * 14 = 7.
  assertEquals(data[2].y, 7);
  // Last point is exactly day 90 at the projected figure.
  const last = data[data.length - 1];
  const scoreMidnight = GRQProjection.setDateToMidnight(scoreDate).getTime();
  const lastDay = (last.x.getTime() - scoreMidnight) / (24 * 60 * 60 * 1000);
  assertEquals(lastDay, 90);
  assertEquals(last.y, 18.0);
});

Deno.test("buildHybridProjectionData (dampened_trend) floors performance at -100", () => {
  const scoreDate = new Date("2025-01-01");
  const projection: Projection = {
    projected90DayPerformance: -250.0,
    projectionMethod: "dampened_trend",
    daysElapsed: 90,
    currentPerformance: -90.0,
  };
  // A steeply negative slope would project well below -100% without the floor.
  const data = GRQProjection.buildHybridProjectionData(projection, scoreDate, {
    slope: -5.0,
  });
  // Every dampened-trend point (weekly and the appended 90-day point) is
  // clamped to the -100% floor.
  for (const point of data) {
    assert(point.y >= -100, `Point ${point.y} fell below the -100% floor`);
  }
  // The deeply negative tail is pinned exactly at the floor.
  assertEquals(data[data.length - 1].y, -100);
});
