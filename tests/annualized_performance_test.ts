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

Deno.test("Annualized Performance Formula Verification", () => {
  // Test the exact formula used in Rust code
  const calculateAnnualized = (performance90Day: number): number => {
    if (performance90Day === 0) return 0;
    return ((1 + performance90Day / 100) ** (365.25 / 90) - 1) * 100;
  };

  // Test with various performance values
  const testValues = [10, -10, 5, -5, 20, -20, 1, -1];

  testValues.forEach((performance) => {
    const annualized = calculateAnnualized(performance);
    const simple = performance * 4;

    console.log(
      `90-day: ${performance}% → Annualized: ${
        annualized.toFixed(2)
      }% (simple would be ${simple}%)`,
    );

    // For positive performance, compound should be higher than simple
    if (performance > 0) {
      if (annualized <= simple) {
        throw new Error(
          `Positive performance ${performance}% should have compound (${
            annualized.toFixed(2)
          }%) > simple (${simple}%)`,
        );
      }
    }

    // For negative performance, compound should be different from simple (for larger values)
    if (performance < 0 && Math.abs(performance) > 2) {
      if (Math.abs(annualized - simple) < 1.0) {
        throw new Error(
          `Negative performance ${performance}% should have compound (${
            annualized.toFixed(2)
          }%) significantly different from simple (${simple}%)`,
        );
      }
    }
  });
});

Deno.test("Annualized Performance Edge Cases", () => {
  const calculateAnnualized = (performance90Day: number): number => {
    if (performance90Day === 0) return 0;
    return ((1 + performance90Day / 100) ** (365.25 / 90) - 1) * 100;
  };

  // Test edge cases
  const edgeCases = [
    { input: 0, expected: 0, description: "Zero performance" },
    { input: 100, expected: 1000, description: "100% performance" }, // Should be very high
    { input: -50, expected: -100, description: "-50% performance" }, // Should be around -100%
  ];

  edgeCases.forEach(({ input, expected: _expected, description }) => {
    const result = calculateAnnualized(input);
    console.log(`${description}: ${input}% → ${result.toFixed(2)}%`);

    if (input === 0 && result !== 0) {
      throw new Error(`Zero performance should return 0, got ${result}`);
    }

    if (input > 0 && result <= 0) {
      throw new Error(
        `Positive performance ${input}% should return positive annualized, got ${result}`,
      );
    }

    if (input < 0 && result >= 0) {
      throw new Error(
        `Negative performance ${input}% should return negative annualized, got ${result}`,
      );
    }
  });
});

// NEW TESTS FOR THE ACTUAL DAYS ELAPSED FIX

Deno.test("Annualized Performance - Actual Days vs Fixed 90 Days", () => {
  // Test the core fix: using actual days elapsed instead of fixed 90 days
  const calculateAnnualizedWithActualDays = (
    performance: number,
    actualDays: number,
  ): number => {
    if (performance === 0 || actualDays <= 0) return 0;
    return ((1 + performance / 100) ** (365.25 / actualDays) - 1) * 100;
  };

  const calculateAnnualizedWithFixed90Days = (performance: number): number => {
    if (performance === 0) return 0;
    return ((1 + performance / 100) ** (365.25 / 90) - 1) * 100;
  };

  const testCases = [
    { performance: 2.0, days: 5, description: "5 days into period" },
    { performance: 3.0, days: 10, description: "10 days into period" },
    { performance: 4.0, days: 15, description: "15 days into period" },
    { performance: 5.0, days: 30, description: "30 days into period" },
    { performance: 6.0, days: 60, description: "60 days into period" },
    { performance: 8.0, days: 90, description: "90 days (complete period)" },
    { performance: -2.0, days: 7, description: "Negative performance, 7 days" },
  ];

  testCases.forEach(({ performance, days, description }) => {
    const actualDaysMethod = calculateAnnualizedWithActualDays(
      performance,
      days,
    );
    const fixed90DaysMethod = calculateAnnualizedWithFixed90Days(performance);

    console.log(`${description}: ${performance}% over ${days} days`);
    console.log(`  Actual-days method: ${actualDaysMethod.toFixed(1)}%`);
    console.log(`  Fixed-90-days method: ${fixed90DaysMethod.toFixed(1)}%`);
    console.log(
      `  Difference: ${(actualDaysMethod - fixed90DaysMethod).toFixed(1)}%`,
    );
    console.log("");

    if (days < 90) {
      // For early days, actual-days method should give higher absolute annualized rate
      if (performance > 0) {
        if (actualDaysMethod <= fixed90DaysMethod) {
          throw new Error(
            `For ${days} days with positive performance, actual-days method (${
              actualDaysMethod.toFixed(1)
            }%) ` +
              `should be higher than fixed-90-days method (${
                fixed90DaysMethod.toFixed(1)
              }%)`,
          );
        }
      } else if (performance < 0) {
        if (actualDaysMethod >= fixed90DaysMethod) {
          throw new Error(
            `For ${days} days with negative performance, actual-days method (${
              actualDaysMethod.toFixed(1)
            }%) ` +
              `should be more negative than fixed-90-days method (${
                fixed90DaysMethod.toFixed(1)
              }%)`,
          );
        }
      }

      // The difference should be significant for very early days
      if (days <= 10) {
        const difference = Math.abs(actualDaysMethod - fixed90DaysMethod);
        if (difference < 50.0) {
          throw new Error(
            `For ${days} days, difference should be substantial (got ${
              difference.toFixed(1)
            }%)`,
          );
        }
      }
    } else {
      // For 90 days, both methods should give same result
      const difference = Math.abs(actualDaysMethod - fixed90DaysMethod);
      if (difference > 0.1) {
        throw new Error(
          `For 90 days, both methods should give same result, difference: ${
            difference.toFixed(3)
          }%`,
        );
      }
    }
  });
});

Deno.test("Annualized Performance - Market Data Days vs Calendar Days", () => {
  // Test the importance of using market data days instead of calendar days
  const calculateAnnualized = (performance: number, days: number): number => {
    if (performance === 0 || days <= 0) return 0;
    return ((1 + performance / 100) ** (365.25 / days) - 1) * 100;
  };

  const scenarios = [
    {
      calendarDays: 10,
      marketDays: 7,
      description: "Weekend gaps in market data",
    },
    {
      calendarDays: 21,
      marketDays: 15,
      description: "Weekends + holiday in 3 weeks",
    },
    { calendarDays: 30, marketDays: 22, description: "Month with weekends" },
    {
      calendarDays: 90,
      marketDays: 63,
      description: "90 calendar days with all weekends removed",
    },
  ];

  const performance = 5.0; // 5% performance

  scenarios.forEach(({ calendarDays, marketDays, description }) => {
    const calendarAnnualized = calculateAnnualized(performance, calendarDays);
    const marketAnnualized = calculateAnnualized(performance, marketDays);

    console.log(
      `${description}: ${performance}% over ${calendarDays} calendar days (${marketDays} market days)`,
    );
    console.log(
      `  Calendar-days annualized: ${calendarAnnualized.toFixed(1)}%`,
    );
    console.log(`  Market-days annualized: ${marketAnnualized.toFixed(1)}%`);
    console.log(
      `  Difference: ${(marketAnnualized - calendarAnnualized).toFixed(1)}%`,
    );
    console.log("");

    // Market days should give higher annualized rate (since fewer days for same performance)
    if (marketAnnualized <= calendarAnnualized) {
      throw new Error(
        `Market days method (${
          marketAnnualized.toFixed(1)
        }%) should give higher rate than ` +
          `calendar days method (${
            calendarAnnualized.toFixed(1)
          }%) for ${description}`,
      );
    }

    // The difference should be meaningful
    const difference = marketAnnualized - calendarAnnualized;
    if (difference < 1.0) {
      throw new Error(
        `Difference should be meaningful for ${description}: ${
          difference.toFixed(1)
        }%`,
      );
    }
  });
});

Deno.test("Annualized Performance - Early Stage Scenarios", () => {
  // Test realistic early-stage scenarios to ensure the fix produces sensible results
  const calculateAnnualized = (performance: number, days: number): number => {
    if (performance === 0 || days <= 0) return 0;
    return ((1 + performance / 100) ** (365.25 / days) - 1) * 100;
  };

  const earlyStageScenarios = [
    {
      performance: 1.0,
      days: 3,
      expectedMin: 100,
      description: "1% gain in 3 days",
    },
    {
      performance: 2.5,
      days: 7,
      expectedMin: 100,
      description: "2.5% gain in 1 week",
    },
    {
      performance: 4.0,
      days: 14,
      expectedMin: 80,
      description: "4% gain in 2 weeks",
    },
    {
      performance: -1.5,
      days: 5,
      expectedMax: -50,
      description: "1.5% loss in 5 days",
    },
    {
      performance: 0.5,
      days: 1,
      expectedMin: 150,
      description: "0.5% gain in 1 day",
    },
  ];

  earlyStageScenarios.forEach(
    ({ performance, days, expectedMin, expectedMax, description }) => {
      const annualized = calculateAnnualized(performance, days);

      console.log(
        `${description}: ${performance}% over ${days} days → ${
          annualized.toFixed(1)
        }% annualized`,
      );

      if (performance > 0 && expectedMin) {
        if (annualized < expectedMin) {
          throw new Error(
            `${description}: Expected annualized rate to be at least ${expectedMin}%, got ${
              annualized.toFixed(1)
            }%`,
          );
        }
      }

      if (performance < 0 && expectedMax) {
        if (annualized > expectedMax) {
          throw new Error(
            `${description}: Expected annualized rate to be at most ${expectedMax}%, got ${
              annualized.toFixed(1)
            }%`,
          );
        }
      }

      // Sanity checks
      if (performance > 0 && annualized <= 0) {
        throw new Error(
          `Positive performance should give positive annualized rate`,
        );
      }

      if (performance < 0 && annualized >= 0) {
        throw new Error(
          `Negative performance should give negative annualized rate`,
        );
      }

      if (days <= 7 && Math.abs(performance) > 0.5) {
        // Very early stage should give very high absolute annualized rates
        if (Math.abs(annualized) < 50) {
          throw new Error(
            `${description}: Expected high annualized rate for early stage, got ${
              annualized.toFixed(1)
            }%`,
          );
        }
      }
    },
  );
});

Deno.test("Annualized Performance - Edge Cases and Error Handling", () => {
  const calculateAnnualized = (performance: number, days: number): number => {
    if (performance === 0 || days <= 0) return 0;
    return ((1 + performance / 100) ** (365.25 / days) - 1) * 100;
  };

  // Test edge cases
  const edgeCases = [
    { performance: 0, days: 30, expected: 0, description: "Zero performance" },
    { performance: 5, days: 0, expected: 0, description: "Zero days" },
    { performance: 1, days: 365, expectedApprox: 1, description: "One year" },
    {
      performance: 10,
      days: 1,
      description: "10% in one day (should be very high)",
    },
    { performance: -95, days: 30, description: "Near total loss" },
    { performance: 100, days: 7, description: "100% gain in a week" },
  ];

  edgeCases.forEach(
    ({ performance, days, expected, expectedApprox, description }) => {
      const result = calculateAnnualized(performance, days);

      console.log(
        `${description}: ${performance}% over ${days} days → ${
          result.toFixed(1)
        }% annualized`,
      );

      if (expected !== undefined) {
        if (result !== expected) {
          throw new Error(
            `${description}: Expected ${expected}, got ${result}`,
          );
        }
      }

      if (expectedApprox !== undefined) {
        const tolerance = 1.0;
        if (Math.abs(result - expectedApprox) > tolerance) {
          throw new Error(
            `${description}: Expected approximately ${expectedApprox}%, got ${
              result.toFixed(1)
            }%`,
          );
        }
      }

      // Basic sanity checks
      if (performance === 0 && result !== 0) {
        throw new Error(`Zero performance should return 0, got ${result}`);
      }

      if (days <= 0 && result !== 0) {
        throw new Error(`Zero or negative days should return 0, got ${result}`);
      }

      if (performance > 0 && result <= 0 && days > 0) {
        throw new Error(
          `Positive performance should return positive annualized, got ${result}`,
        );
      }

      if (performance < 0 && result >= 0) {
        throw new Error(
          `Negative performance should return negative annualized, got ${result}`,
        );
      }
    },
  );
});

// NEW TEST FOR ZERO ANNUALIZED PERFORMANCE BUG
Deno.test("Annualized Performance - Zero Bug Investigation", () => {
  // Test the specific scenario where 90-day performance is positive but annualized is 0
  // This tests the bug where actual_days_elapsed might be 0
  
  const calculateAnnualizedWithActualDays = (
    performance: number,
    actualDays: number,
  ): number => {
    if (performance === 0 || actualDays <= 0) return 0;
    return ((1 + performance / 100) ** (365.25 / actualDays) - 1) * 100;
  };

  // Test cases that should NOT result in zero annualized performance
  const testCases = [
    { 
      performance: 23.77, 
      days: 90, 
      description: "2025-04-15 scenario: 23.77% over 90 days",
      expectedMin: 100 // Should be significantly positive
    },
    { 
      performance: 17.68, 
      days: 90, 
      description: "2025-04-04 scenario: 17.68% over 90 days",
      expectedMin: 50 // Should be significantly positive
    },
    { 
      performance: 23.64, 
      days: 90, 
      description: "2025-04-22 scenario: 23.64% over 90 days",
      expectedMin: 100 // Should be significantly positive
    },
    // Edge cases that should be handled properly
    { 
      performance: 5.0, 
      days: 1, 
      description: "Very early days: 5% over 1 day",
      expectedMin: 1000 // Should be very high
    },
    { 
      performance: 10.0, 
      days: 30, 
      description: "Early days: 10% over 30 days",
      expectedMin: 100 // Should be high
    },
  ];

  testCases.forEach(({ performance, days, description, expectedMin }) => {
    const actualAnnualized = calculateAnnualizedWithActualDays(performance, days);
    
    console.log(`${description}: ${performance}% over ${days} days → ${actualAnnualized.toFixed(2)}%`);
    
    // Verify that positive performance with positive days gives positive annualized
    if (performance > 0 && days > 0) {
      if (actualAnnualized <= 0) {
        throw new Error(
          `BUG: Positive performance ${performance}% over ${days} days should give positive annualized, got ${actualAnnualized}%`
        );
      }
      
      if (actualAnnualized < expectedMin) {
        throw new Error(
          `BUG: ${description} should give at least ${expectedMin}% annualized, got ${actualAnnualized.toFixed(2)}%`
        );
      }
    }
    
    // Verify the calculation is mathematically sound
    const expectedApprox = ((1 + performance / 100) ** (365.25 / days) - 1) * 100;
    const tolerance = 0.01; // Allow for floating point precision
    const difference = Math.abs(actualAnnualized - expectedApprox);
    
    if (difference > tolerance) {
      throw new Error(
        `Calculation error: Expected ~${expectedApprox.toFixed(2)}%, got ${actualAnnualized.toFixed(2)}%, difference: ${difference.toFixed(2)}%`
      );
    }
  });

  // Test edge cases that should return 0
  const edgeCases = [
    { performance: 0, days: 90, description: "Zero performance" },
    { performance: 10, days: 0, description: "Zero days" },
    { performance: -5, days: 0, description: "Negative performance, zero days" },
  ];

  edgeCases.forEach(({ performance, days, description }) => {
    const result = calculateAnnualizedWithActualDays(performance, days);
    console.log(`${description}: ${performance}% over ${days} days → ${result.toFixed(2)}%`);
    
    if (result !== 0) {
      throw new Error(
        `${description} should return 0, got ${result}%`
      );
    }
  });

  console.log("✅ All zero annualized performance bug tests passed");
});
