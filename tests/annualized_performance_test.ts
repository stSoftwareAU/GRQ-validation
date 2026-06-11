// Test to verify annualized performance calculation uses compound interest
// and not simple multiplication

Deno.test("Annualized Performance Calculation - Compound Interest", () => {
  // Test cases with known 90-day performances
  const testCases = [
    {
      performance90Day: 6.07,
      expectedAnnualized: 27.00,
      description: "Positive performance",
    },
    {
      performance90Day: -12.98,
      expectedAnnualized: -43.09,
      description: "Negative performance",
    },
    {
      performance90Day: 0.48,
      expectedAnnualized: 1.95,
      description: "Small positive performance",
    },
    {
      performance90Day: -6.52,
      expectedAnnualized: -23.91,
      description: "Small negative performance",
    },
  ];

  testCases.forEach(({ performance90Day, expectedAnnualized, description }) => {
    // Calculate using compound interest formula: (1 + r)^(365.25/90) - 1
    const annualizedCompound =
      ((1 + performance90Day / 100) ** (365.25 / 90) - 1) * 100;

    // Calculate using simple multiplication (incorrect method)
    const annualizedSimple = performance90Day * 4;

    console.log(`${description}:`);
    console.log(`  90-day performance: ${performance90Day}%`);
    console.log(`  Compound interest: ${annualizedCompound.toFixed(2)}%`);
    console.log(`  Simple multiplication: ${annualizedSimple.toFixed(2)}%`);
    console.log(`  Expected: ${expectedAnnualized}%`);
    console.log(
      `  Difference: ${
        Math.abs(annualizedCompound - expectedAnnualized).toFixed(2)
      }%`,
    );
    console.log("");

    // Verify compound interest calculation is close to expected
    const tolerance = 0.5; // Allow 0.5% tolerance for rounding differences
    const isCorrect =
      Math.abs(annualizedCompound - expectedAnnualized) < tolerance;

    if (!isCorrect) {
      throw new Error(
        `${description}: Compound interest calculation (${
          annualizedCompound.toFixed(2)
        }%) ` +
          `does not match expected (${expectedAnnualized}%). ` +
          `Simple multiplication would be ${annualizedSimple.toFixed(2)}%`,
      );
    }

    // Verify that simple multiplication is significantly different (for larger values)
    const simpleDifference = Math.abs(annualizedSimple - expectedAnnualized);
    if (Math.abs(performance90Day) > 5 && simpleDifference < 2.0) {
      throw new Error(
        `${description}: Simple multiplication (${
          annualizedSimple.toFixed(2)
        }%) ` +
          `is too close to expected (${expectedAnnualized}%). ` +
          `This suggests the calculation might be using simple multiplication instead of compound interest.`,
      );
    }
  });
});

// NOTE (issue #104): a block of recompute-only tests previously sat here.
// They redefined the annualisation formula as local arrow functions
// (`calculateAnnualized`, `calculateAnnualizedWithActualDays`,
// `calculateAnnualizedWithFixed90Days`) and asserted on their own output, so
// they could never catch a regression in the production annualisation path.
// Because the dashboard does not annualise in JS — it reads the Rust-computed
// `performance_annualized` from index.json — there is no shipped JS helper for
// these tests to drive. The formula's production home is Rust
// (`calculate_annualized_performance`), now WHAT-tested by
// `tests::test_annualized_performance_calculation_with_actual_days` in
// src/utils.rs. Per issue #104 (option b) the following recompute-only cases
// were deleted rather than kept as HOW-tests:
//   - "Annualized Performance Formula Verification"
//   - "Annualized Performance Edge Cases"
//   - "Annualized Performance - Actual Days vs Fixed 90 Days"
//   - "Annualized Performance - Market Data Days vs Calendar Days"
//   - "Annualized Performance - Early Stage Scenarios"
//   - "Annualized Performance - Edge Cases and Error Handling"
//   - "Annualized Performance - Zero Bug Investigation"
//
// The tests retained below cover distinct concerns: the compound-vs-simple
// guard above is cross-checked against the documented real-data table in
// docs/fixes/ANNUALIZED_PERFORMANCE_CALCULATION.md; the two tests that follow cover
// index.json averaging (mirrors docs/list.js) and the hybrid-projection
// dampening algorithm respectively.

// TEST FOR AVERAGE ANNUALIZED PERFORMANCE CALCULATION
Deno.test("Average Annualized Performance Calculation", () => {
  // Simulate the data structure from index.json
  const mockData = [
    {
      date: "2025-04-15",
      performance_90_day: 23.77,
      performance_annualized: 137.62,
    },
    {
      date: "2025-04-22",
      performance_90_day: 23.64,
      performance_annualized: 136.57,
    },
    {
      date: "2025-07-22",
      performance_90_day: null, // No 90-day performance yet
      performance_annualized: 0.0, // Hybrid projection
    },
    {
      date: "2025-07-23",
      performance_90_day: null, // No 90-day performance yet
      performance_annualized: 0.0, // Hybrid projection
    },
  ];

  // Simulate the fixed calculation logic
  let total90Day = 0;
  let totalAnnualized = 0;
  let valid90DayCount = 0;
  let validAnnualizedCount = 0;
  let positiveCount = 0;

  mockData.forEach((row) => {
    const performance90Day = row.performance_90_day;
    const performanceAnnualized = row.performance_annualized;

    if (performance90Day !== null && performance90Day !== undefined) {
      total90Day += performance90Day;
      valid90DayCount++;

      if (performance90Day > 0) {
        positiveCount++;
      }
    }

    if (performanceAnnualized !== null && performanceAnnualized !== undefined) {
      totalAnnualized += performanceAnnualized;
      validAnnualizedCount++;
    }
  });

  const avg90Day = valid90DayCount > 0 ? total90Day / valid90DayCount : 0;
  const avgAnnualized = validAnnualizedCount > 0
    ? totalAnnualized / validAnnualizedCount
    : 0;

  console.log("Test Results:");
  console.log(`Total 90-day: ${total90Day}`);
  console.log(`Total annualized: ${totalAnnualized}`);
  console.log(`Valid 90-day count: ${valid90DayCount}`);
  console.log(`Valid annualized count: ${validAnnualizedCount}`);
  console.log(`Average 90-day: ${avg90Day.toFixed(2)}%`);
  console.log(`Average annualized: ${avgAnnualized.toFixed(2)}%`);
  console.log(`Positive count: ${positiveCount}`);

  // Verify the calculations are correct
  const expectedAvg90Day = (23.77 + 23.64) / 2; // Only the 2 valid entries
  const expectedAvgAnnualized = (137.62 + 136.57 + 0.0 + 0.0) / 4; // All 4 entries

  console.log(`Expected avg 90-day: ${expectedAvg90Day.toFixed(2)}%`);
  console.log(`Expected avg annualized: ${expectedAvgAnnualized.toFixed(2)}%`);

  // Assertions
  if (Math.abs(avg90Day - expectedAvg90Day) > 0.01) {
    throw new Error(
      `Average 90-day calculation wrong: expected ${
        expectedAvg90Day.toFixed(2)
      }%, got ${avg90Day.toFixed(2)}%`,
    );
  }

  if (Math.abs(avgAnnualized - expectedAvgAnnualized) > 0.01) {
    throw new Error(
      `Average annualized calculation wrong: expected ${
        expectedAvgAnnualized.toFixed(2)
      }%, got ${avgAnnualized.toFixed(2)}%`,
    );
  }

  if (valid90DayCount !== 2) {
    throw new Error(
      `Should have 2 valid 90-day entries, got ${valid90DayCount}`,
    );
  }

  if (validAnnualizedCount !== 4) {
    throw new Error(
      `Should have 4 valid annualized entries, got ${validAnnualizedCount}`,
    );
  }

  if (positiveCount !== 2) {
    throw new Error(
      `Should have 2 positive 90-day entries, got ${positiveCount}`,
    );
  }

  console.log("✅ Average annualized performance calculation test passed");
});

// TEST FOR HYBRID PROJECTION FIX
Deno.test("Hybrid Projection - Realistic Annualized Performance", () => {
  // Test the fix for unrealistic annualized performance in hybrid projections
  // This simulates the scenario where a small gain over a few days was giving 119,592.89% annualized

  const calculateHybridProjection = (
    gainLossPercent: number,
    marketDaysElapsed: number,
  ): { projected90Day: number; annualized: number } => {
    // Simulate the new hybrid projection logic
    if (marketDaysElapsed <= 0) {
      return { projected90Day: 0, annualized: 0 };
    }

    // Calculate daily rate
    const dailyRate = gainLossPercent / marketDaysElapsed;

    // Apply dampening based on market data days elapsed
    let dampeningFactor = 0.1; // Very early days: dampen by 90%
    if (marketDaysElapsed >= 7) dampeningFactor = 0.2; // Early days: dampen by 80%
    if (marketDaysElapsed >= 14) dampeningFactor = 0.3; // Early days: dampen by 70%
    if (marketDaysElapsed >= 30) dampeningFactor = 0.5; // Medium term: dampen by 50%
    if (marketDaysElapsed >= 60) dampeningFactor = 0.7; // Later days: dampen by 30%

    // Calculate raw projection
    const rawProjection = dailyRate * 90.0;
    let projected90Day = rawProjection * dampeningFactor;

    // Apply realistic bounds based on market data days elapsed
    let maxGain = 10.0; // Very early: max 10% gain
    let maxLoss = -5.0; // Very early: max 5% loss
    if (marketDaysElapsed >= 7) {
      maxGain = 20.0;
      maxLoss = -10.0;
    }
    if (marketDaysElapsed >= 14) {
      maxGain = 40.0;
      maxLoss = -20.0;
    }
    if (marketDaysElapsed >= 30) {
      maxGain = 80.0;
      maxLoss = -40.0;
    }
    if (marketDaysElapsed >= 60) {
      maxGain = 150.0;
      maxLoss = -80.0;
    }

    projected90Day = Math.max(maxLoss, Math.min(maxGain, projected90Day));

    // Use quarterly compounding for annualized performance
    const annualized = ((1 + projected90Day / 100) ** 4 - 1) * 100;

    return { projected90Day, annualized };
  };

  // Test the problematic scenario: 1.96% gain in 3 days
  const testCase = calculateHybridProjection(1.96, 3);
  console.log("Test Case: 1.96% gain in 3 days");
  console.log(`Projected 90-day: ${testCase.projected90Day.toFixed(2)}%`);
  console.log(`Annualized: ${testCase.annualized.toFixed(2)}%`);

  // Verify the results are realistic
  if (testCase.annualized > 1000) {
    throw new Error(
      `Annualized performance should be realistic, got ${
        testCase.annualized.toFixed(2)
      }%`,
    );
  }

  if (testCase.projected90Day > 50) {
    throw new Error(
      `90-day projection should be realistic, got ${
        testCase.projected90Day.toFixed(2)
      }%`,
    );
  }

  // Test different scenarios
  const scenarios = [
    { gain: 1.96, days: 3, description: "1.96% gain in 3 days" },
    { gain: 5.0, days: 7, description: "5% gain in 1 week" },
    { gain: 10.0, days: 14, description: "10% gain in 2 weeks" },
    { gain: -2.0, days: 5, description: "2% loss in 5 days" },
    { gain: 15.0, days: 30, description: "15% gain in 1 month" },
  ];

  console.log("\n=== Hybrid Projection Test Results ===");
  scenarios.forEach(({ gain, days, description }) => {
    const result = calculateHybridProjection(gain, days);
    console.log(
      `${description}: ${gain}% over ${days} days → 90-day: ${
        result.projected90Day.toFixed(2)
      }%, Annualized: ${result.annualized.toFixed(2)}%`,
    );

    // Verify results are realistic
    if (result.annualized > 1000) {
      throw new Error(
        `${description}: Annualized performance too high: ${
          result.annualized.toFixed(2)
        }%`,
      );
    }

    if (result.projected90Day > 200) {
      throw new Error(
        `${description}: 90-day projection too high: ${
          result.projected90Day.toFixed(2)
        }%`,
      );
    }

    if (result.projected90Day < -100) {
      throw new Error(
        `${description}: 90-day projection too low: ${
          result.projected90Day.toFixed(2)
        }%`,
      );
    }
  });

  console.log("✅ Hybrid projection fix test passed");
});
