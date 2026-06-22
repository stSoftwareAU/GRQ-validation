// Regression-through-the-origin tests for computeTrendLine (issue #302).
//
// The single-stock trend line must be a least-squares regression pinned to
// (0, 0) — day 0 reads 0% by definition (performance is measured against the
// buy price on the score date). The previous code fitted a *free-intercept*
// slope and then pinned the intercept to 0, which dropped the whole line below
// data that rises fast then plateaus. These tests import the REAL shipped
// helper from docs/projection.js and assert on its observable output.
import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import "../docs/projection.js";

const g = globalThis as unknown as {
  GRQProjection: {
    computeTrendLine: (
      dataPoints: { x: number; y: number }[],
    ) => {
      slope: number;
      intercept: number;
      predicted90DayPerformance: number;
      rSquared: number;
    } | null;
  };
};

const GRQProjection = g.GRQProjection;

Deno.test("computeTrendLine: rises-then-plateaus line is not below all points", () => {
  // Performance rises fast off the score date then plateaus around 20%.
  const points = [
    { x: 0, y: 0 },
    { x: 1, y: 10 },
    { x: 2, y: 16 },
    { x: 3, y: 19 },
    { x: 4, y: 20 },
    { x: 5, y: 20 },
    { x: 6, y: 20 },
  ];

  const trend = GRQProjection.computeTrendLine(points);
  assert(trend !== null);

  // Regression through the origin: slope = Σ(x·y) / Σ(x·x), intercept = 0.
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumXX = points.reduce((s, p) => s + p.x * p.x, 0);
  const expectedSlope = sumXY / sumXX;

  assertEquals(trend!.intercept, 0, "line must pass through the origin");
  assertAlmostEquals(trend!.slope, expectedSlope, 1e-9);

  // Day 0 reads exactly 0%.
  assertEquals(trend!.slope * 0 + trend!.intercept, 0);

  // The line must NOT sit below every data point: at least one actual point
  // lies on or below the line (points straddle the line).
  const someOnOrBelow = points.some((p) => p.y <= trend!.slope * p.x + 1e-9);
  assert(
    someOnOrBelow,
    "trend line must not be strictly below all data points",
  );
});

Deno.test("computeTrendLine: recovers the exact rate for a linear-from-origin series", () => {
  // y = 3x exactly — through-origin regression must recover slope 3.
  const points = [
    { x: 0, y: 0 },
    { x: 5, y: 15 },
    { x: 10, y: 30 },
    { x: 20, y: 60 },
  ];

  const trend = GRQProjection.computeTrendLine(points);
  assert(trend !== null);
  assertEquals(trend!.intercept, 0);
  assertAlmostEquals(trend!.slope, 3, 1e-9);
  assertAlmostEquals(trend!.rSquared, 1, 1e-9);
});
