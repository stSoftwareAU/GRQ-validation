import { assertEquals } from "@std/assert";
import "../docs/projection.js";

interface Dividend {
  exDivDate: Date;
  amount: number;
}

const g = globalThis as unknown as {
  GRQProjection: {
    calculatePerformanceReturn: (
      buyPrice: number,
      currentPrice: number,
      totalDividends?: number,
    ) => number | null;
    getDaysElapsed: (scoreDate: Date, today: Date) => number;
    filterDividendsWithin90Days: (
      dividends: Dividend[],
      scoreDate: Date,
    ) => Dividend[];
  };
};
const GRQProjection = g.GRQProjection;

// Integration test for 90-day portfolio calculations

Deno.test("Integration Tests", async (t) => {
  const scoreDate = new Date(2024, 10, 15); // November 15, 2024
  const ninetyDayDate = new Date(
    scoreDate.getTime() + (90 * 24 * 60 * 60 * 1000),
  );

  await t.step("90-day boundary respect", () => {
    // Drive the REAL elapsed-day maths rather than recomputing the boundary
    // inline: a date past the window must report > 90 days, one inside it
    // must report <= 90 (issue #201).
    const afterWindow = new Date("2025-03-14"); // After 90 days
    const withinWindow = new Date("2025-01-15"); // Within 90 days

    assertEquals(
      GRQProjection.getDaysElapsed(scoreDate, afterWindow) > 90,
      true,
      "A date past the window should report more than 90 elapsed days",
    );
    assertEquals(
      GRQProjection.getDaysElapsed(scoreDate, withinWindow) <= 90,
      true,
      "A date inside the window should report 90 or fewer elapsed days",
    );
  });

  // NOTE (issue #80): the former "portfolio target logic" step asserted
  // `20.0 ≈ 20.0` against two locally-declared constants — a tautology that
  // verified no production code. It has been removed in favour of the
  // real-function "performance calculation" step below.

  await t.step("dividend exclusion after 90 days", () => {
    // Drive the REAL production window filter (issue #201) instead of
    // re-implementing the predicate inline.
    const testDividends = [
      { exDivDate: new Date("2024-12-19"), amount: 0.135 }, // Within 90 days
      { exDivDate: new Date("2024-12-27"), amount: 0.32 }, // Within 90 days
      { exDivDate: new Date("2025-03-14"), amount: 0.32 }, // After 90 days
    ];

    const within = GRQProjection.filterDividendsWithin90Days(
      testDividends,
      scoreDate,
    );

    assertEquals(
      within.map((d) => d.amount),
      [0.135, 0.32],
      "Only the two dividends inside the 90-day window should remain",
    );
  });

  await t.step("performance calculation", () => {
    // Drive the REAL shared performance maths (issue #80) rather than
    // recomputing the formula inline and asserting on our own arithmetic.
    const buyPrice = 100.0;
    const priceAt90Days = 120.0; // 20% price gain
    const dividends = 2.0; // $2 in dividends -> +2%

    const totalReturn = GRQProjection.calculatePerformanceReturn(
      buyPrice,
      priceAt90Days,
      dividends,
    );

    assertEquals(totalReturn, 22.0, "Total return should be 22.0%");
  });

  await t.step("chart data limitation", () => {
    // Test that chart data is limited to 90 days
    const mockDataPoints = [
      { date: new Date("2024-11-15"), value: 100 }, // Score date
      { date: new Date("2024-12-15"), value: 110 }, // Within 90 days
      { date: new Date("2025-01-15"), value: 115 }, // Within 90 days
      { date: new Date("2025-02-15"), value: 120 }, // Within 90 days
      { date: new Date("2025-03-15"), value: 125 }, // After 90 days
    ];

    const dataWithin90Days = mockDataPoints.filter((point) =>
      point.date <= ninetyDayDate
    );

    assertEquals(
      dataWithin90Days.length,
      3,
      "Should have 3 data points within 90 days",
    );
  });
});
