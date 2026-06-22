// Regression-through-the-origin tests for the PORTFOLIO trend line (issue #303).
//
// calculatePortfolioTrendLine() in docs/app.js used to fit a *free-intercept*
// slope and then pin the intercept to 0, which dropped the whole dashed
// "Portfolio Trend (Low Confidence)" line below data that rises fast then
// plateaus. The fix delegates the portfolio regression to the single shared
// kernel GRQProjection.computeTrendLine (docs/projection.js), which fits a
// least-squares line pinned to (0,0): slope = Σ(x·y) / Σ(x·x), intercept = 0.
//
// app.js is a browser-only UI class, so these tests exercise the kernel the
// production code now delegates to, feeding it the same { x: daysSinceScore,
// y: portfolioReturn } points app.js builds, mirroring
// tests/portfolio_view_consistency_test.ts.
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

Deno.test("portfolio trend line: rises-then-plateaus is not below all points", () => {
  // Portfolio average performance rises fast off the score date then plateaus
  // around 18%. With a free-intercept slope pinned to 0 the old line sat below
  // every point; the through-origin line must straddle them.
  const points = [
    { x: 0, y: 0 },
    { x: 1, y: 9 },
    { x: 2, y: 14 },
    { x: 3, y: 17 },
    { x: 4, y: 18 },
    { x: 5, y: 18 },
    { x: 6, y: 18 },
  ];

  const trend = GRQProjection.computeTrendLine(points);
  assert(trend !== null);

  // slope === Σ(x·y) / Σ(x·x), intercept === 0 (acceptance criteria).
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumXX = points.reduce((s, p) => s + p.x * p.x, 0);
  assertEquals(trend!.intercept, 0, "portfolio line must pass through (0,0)");
  assertAlmostEquals(trend!.slope, sumXY / sumXX, 1e-9);

  // Day-0 value is exactly 0%.
  assertEquals(trend!.slope * 0 + trend!.intercept, 0);

  // The line must NOT sit below every Performance point — points straddle it.
  const someOnOrBelow = points.some((p) => p.y <= trend!.slope * p.x + 1e-9);
  assert(someOnOrBelow, "trend line must not be strictly below all points");
});

Deno.test("portfolio trend line: 90-day prediction tracks the through-origin slope", () => {
  const points = [
    { x: 0, y: 0 },
    { x: 10, y: 5 },
    { x: 20, y: 10 },
    { x: 30, y: 15 },
  ];

  const trend = GRQProjection.computeTrendLine(points);
  assert(trend !== null);
  assertEquals(trend!.intercept, 0);

  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumXX = points.reduce((s, p) => s + p.x * p.x, 0);
  const expectedSlope = sumXY / sumXX;
  assertAlmostEquals(trend!.slope, expectedSlope, 1e-9);
  // predicted90DayPerformance = slope * 90 (intercept 0), floored at -100%.
  assertAlmostEquals(
    trend!.predicted90DayPerformance,
    Math.max(expectedSlope * 90, -100),
    1e-9,
  );
});
