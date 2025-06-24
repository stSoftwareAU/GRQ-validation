import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";

// Test case for judgement calculations and logic

Deno.test("Judgement Tests", async (t) => {
  const scoreDate = new Date(2024, 10, 15); // November 15, 2024
  const ninetyDayDate = new Date(
    scoreDate.getTime() + (90 * 24 * 60 * 60 * 1000),
  );

  function calculateJudgement(performance: number, target: number): string {
    if (performance >= target) {
      return performance > target ? "EXCEEDED" : "MET";
    } else {
      return "BELOW";
    }
  }

  function calculateProgressVsCostOfCapital(
    performance: number,
    costOfCapital: number,
  ): string {
    if (performance > costOfCapital) {
      return "ABOVE";
    } else if (performance === costOfCapital) {
      return "AT";
    } else {
      return "BELOW";
    }
  }

  await t.step("judgement calculation", () => {
    // Test judgement calculation based on performance vs target
    const testCases = [
      { performance: 25.0, target: 20.0, expected: "EXCEEDED" },
      { performance: 20.0, target: 20.0, expected: "MET" },
      { performance: 15.0, target: 20.0, expected: "BELOW" },
      { performance: 10.0, target: 20.0, expected: "BELOW" },
      { performance: -5.0, target: 20.0, expected: "BELOW" },
    ];

    testCases.forEach((testCase, index) => {
      const judgement = calculateJudgement(
        testCase.performance,
        testCase.target,
      );
      assertEquals(
        judgement,
        testCase.expected,
        `Test ${index + 1}: Judgement should be ${testCase.expected}`,
      );
    });
  });

  await t.step("cost of capital comparison", () => {
    // Test progress vs cost of capital calculation
    const costOfCapital = 10.0; // 10% cost of capital
    const testCases = [
      { performance: 15.0, expected: "ABOVE" },
      { performance: 10.0, expected: "AT" },
      { performance: 5.0, expected: "BELOW" },
      { performance: -5.0, expected: "BELOW" },
    ];

    testCases.forEach((testCase, index) => {
      const progress = calculateProgressVsCostOfCapital(
        testCase.performance,
        costOfCapital,
      );
      assertEquals(
        progress,
        testCase.expected,
        `Test ${index + 1}: Progress should be ${testCase.expected}`,
      );
    });
  });

  await t.step("date boundary logic", () => {
    // Test that judgements are calculated within the 90-day boundary
    const testDate = new Date("2025-02-12"); // One day before 90-day boundary
    const isWithin90Days = testDate <= ninetyDayDate;

    assertEquals(isWithin90Days, true, "Test date should be within 90 days");
  });

  await t.step("boundary date inclusion", () => {
    // Test that the boundary date itself is included
    const boundaryDate = new Date("2025-02-13"); // Exactly 90 days
    // Compare only the date parts (year, month, day)
    const isSameDay =
      boundaryDate.getFullYear() === ninetyDayDate.getFullYear() &&
      boundaryDate.getMonth() === ninetyDayDate.getMonth() &&
      boundaryDate.getDate() === ninetyDayDate.getDate();
    const isWithin90Days = isSameDay || boundaryDate < ninetyDayDate;

    assertEquals(isWithin90Days, true, "Boundary date should be included");
  });
});
