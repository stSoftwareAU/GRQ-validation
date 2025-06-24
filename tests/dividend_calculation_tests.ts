import {
  assertAlmostEquals,
  assertEquals,
} from "https://deno.land/std@0.208.0/assert/mod.ts";

// Test case for dividend calculation within 90-day period
// Testing NYSE:WFG from 2024-11-15 score file

Deno.test("Dividend Calculation Tests", async (t) => {
  const scoreDate = new Date(2024, 10, 15); // November 15, 2024
  const ninetyDayDate = new Date(
    scoreDate.getTime() + (90 * 24 * 60 * 60 * 1000),
  );
  const testDividends = [
    { exDivDate: new Date("2024-12-19"), amount: 0.135 },
    { exDivDate: new Date("2024-12-27"), amount: 0.32 },
    { exDivDate: new Date("2025-03-14"), amount: 0.32 },
  ];

  await t.step("dividend filtering within 90 days", () => {
    // Test the filtering logic
    const dividendsWithin90Days = testDividends.filter((dividend) =>
      dividend.exDivDate <= ninetyDayDate
    );

    assertEquals(
      dividendsWithin90Days.length,
      2,
      "Should have 2 dividends within 90 days",
    );

    // Calculate total dividends within 90 days
    const totalDividends = dividendsWithin90Days.reduce(
      (sum, div) => sum + div.amount,
      0,
    );

    assertAlmostEquals(
      totalDividends,
      0.455,
      0.001,
      "Total dividends should be $0.455",
    );
  });

  await t.step("date calculations", () => {
    // Verify 90-day calculation
    const expected90DayDate = new Date(2025, 1, 13); // February 13, 2025
    const daysDiff = Math.round(
      (ninetyDayDate.getTime() - scoreDate.getTime()) / (1000 * 60 * 60 * 24),
    );

    assertEquals(daysDiff, 90, "Should be exactly 90 days");
    assertEquals(
      ninetyDayDate.getTime(),
      expected90DayDate.getTime(),
      "90-day date should match expected",
    );
  });

  await t.step("dividend date validation", () => {
    // Test that specific dividends are correctly identified
    const dividend1 = testDividends[0]; // 2024-12-19
    const dividend2 = testDividends[1]; // 2024-12-27
    const dividend3 = testDividends[2]; // 2025-03-14

    assertEquals(
      dividend1.exDivDate <= ninetyDayDate,
      true,
      "First dividend should be within 90 days",
    );
    assertEquals(
      dividend2.exDivDate <= ninetyDayDate,
      true,
      "Second dividend should be within 90 days",
    );
    assertEquals(
      dividend3.exDivDate <= ninetyDayDate,
      false,
      "Third dividend should be after 90 days",
    );
  });
});
