import { assertEquals } from "@std/assert";
import "../docs/projection.js";

const g = globalThis as unknown as {
  GRQProjection: {
    calculatePerformanceReturn: (
      buyPrice: number,
      currentPrice: number,
      totalDividends?: number,
    ) => number | null;
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
    // Test that all calculations respect the 90-day boundary
    const testDate = new Date("2025-03-14"); // After 90 days
    const isAfter90Days = testDate > ninetyDayDate;

    assertEquals(
      isAfter90Days,
      true,
      "Test date should be after 90-day boundary",
    );
  });

  // NOTE (issue #80): the former "portfolio target logic" step asserted
  // `20.0 ≈ 20.0` against two locally-declared constants — a tautology that
  // verified no production code. It has been removed in favour of the
  // real-function "performance calculation" step below.

  await t.step("dividend exclusion after 90 days", () => {
    // Test that dividends after 90 days are excluded
    const testDividends = [
      { exDivDate: new Date("2024-12-19"), amount: 0.135 }, // Within 90 days
      { exDivDate: new Date("2024-12-27"), amount: 0.32 }, // Within 90 days
      { exDivDate: new Date("2025-03-14"), amount: 0.32 }, // After 90 days
    ];

    const dividendsWithin90Days = testDividends.filter((d) =>
      d.exDivDate <= ninetyDayDate
    );

    assertEquals(
      dividendsWithin90Days.length,
      2,
      "Should have 2 dividends within 90 days",
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
