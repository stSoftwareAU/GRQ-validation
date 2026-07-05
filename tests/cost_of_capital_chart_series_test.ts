// Regression tests for the chart's Cost of Capital series (issue #717).
//
// The grey "Cost of Capital" line on a score's performance chart used to cap
// its accrual at 90 days (Math.min(daysSinceScore, 90)), so on a 180-day view
// the line rose for the first 90 days then ran dead flat to the end. The chart
// series must instead keep accruing at the annual cost of capital to the end of
// the visible window, staying comparable with the plotted actuals.
//
// The maths now lives in the real shared kernel
// GRQProjection.calculateCostOfCapitalSeries (docs/projection.js), so these
// tests exercise the exact code the dashboard runs — not a reimplementation.
import { assertAlmostEquals, assertEquals } from "@std/assert";
import "../docs/projection.js";

interface SeriesPoint {
  x: Date;
  y: number;
}

const g = globalThis as unknown as {
  GRQProjection: {
    calculateCostOfCapitalSeries: (
      scoreDate: Date,
      dates: Date[],
      costOfCapital: number,
    ) => SeriesPoint[];
    costOfCapitalHurdle: (costOfCapital: number, daysElapsed: number) => number;
  };
};
const GRQProjection = g.GRQProjection;

const DAY = 24 * 60 * 60 * 1000;
const COST_OF_CAPITAL = 10; // 10% p.a., the dashboard default.

function datesFrom(scoreDate: Date, dayOffsets: number[]): Date[] {
  return dayOffsets.map((d) => new Date(scoreDate.getTime() + d * DAY));
}

Deno.test("calculateCostOfCapitalSeries keeps accruing past day 90 (issue #717)", () => {
  const scoreDate = new Date(2025, 0, 1);
  const dates = datesFrom(scoreDate, [0, 45, 90, 135, 180]);
  const series = GRQProjection.calculateCostOfCapitalSeries(
    scoreDate,
    dates,
    COST_OF_CAPITAL,
  );

  assertEquals(series.length, 5, "one point per plotted date");

  // Day 90 ≈ 2.47%, day 180 ≈ 4.93% — the line must NOT freeze at ~2.47%.
  assertAlmostEquals(series[2].y, (COST_OF_CAPITAL / 365) * 90, 1e-9);
  assertAlmostEquals(series[4].y, (COST_OF_CAPITAL / 365) * 180, 1e-9);

  // The day-180 value is strictly greater than the day-90 value: no flat tail.
  if (!(series[4].y > series[2].y)) {
    throw new Error(
      `Cost of Capital line went flat after day 90: day90=${
        series[2].y
      }, day180=${series[4].y}`,
    );
  }
});

Deno.test("calculateCostOfCapitalSeries is strictly increasing across the window", () => {
  const scoreDate = new Date(2025, 0, 1);
  const dates = datesFrom(scoreDate, [10, 60, 90, 120, 150, 180]);
  const series = GRQProjection.calculateCostOfCapitalSeries(
    scoreDate,
    dates,
    COST_OF_CAPITAL,
  );
  for (let i = 1; i < series.length; i++) {
    if (!(series[i].y > series[i - 1].y)) {
      throw new Error(
        `series not increasing at index ${i}: ${series[i - 1].y} -> ${
          series[i].y
        }`,
      );
    }
  }
});

Deno.test("calculateCostOfCapitalSeries matches the shared hurdle kernel with NO cap", () => {
  const scoreDate = new Date(2025, 0, 1);
  const dates = datesFrom(scoreDate, [30, 90, 175]);
  const series = GRQProjection.calculateCostOfCapitalSeries(
    scoreDate,
    dates,
    COST_OF_CAPITAL,
  );
  // Each y equals the uncapped hurdle for its elapsed days.
  assertAlmostEquals(
    series[0].y,
    GRQProjection.costOfCapitalHurdle(COST_OF_CAPITAL, 30),
    1e-9,
  );
  assertAlmostEquals(
    series[2].y,
    GRQProjection.costOfCapitalHurdle(COST_OF_CAPITAL, 175),
    1e-9,
  );
});

Deno.test("calculateCostOfCapitalSeries preserves the plotted date on each point", () => {
  const scoreDate = new Date(2025, 0, 1);
  const dates = datesFrom(scoreDate, [0, 90, 180]);
  const series = GRQProjection.calculateCostOfCapitalSeries(
    scoreDate,
    dates,
    COST_OF_CAPITAL,
  );
  series.forEach((point, i) => {
    assertEquals(point.x.getTime(), dates[i].getTime(), "x carries the date");
  });
  // Score date itself accrues nothing.
  assertAlmostEquals(series[0].y, 0, 1e-9);
});
