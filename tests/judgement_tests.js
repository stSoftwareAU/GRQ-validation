#!/usr/bin/env -S deno run
/**
 * Judgement Calculation Tests
 *
 * These tests verify the rules for calculating 90-day judgement performance,
 * including dividend accumulation and other edge cases.
 */

// Test data structure for a stock performance scenario
class StockScenario {
  constructor(
    buyPrice,
    targetPrice,
    dividends = [],
    finalPrice,
    daysElapsed = 90,
  ) {
    this.buyPrice = buyPrice;
    this.targetPrice = targetPrice;
    this.dividends = dividends; // Array of {exDivDate: string, amount: number}
    this.finalPrice = finalPrice;
    this.daysElapsed = daysElapsed;
  }

  // Calculate total return including dividends
  calculateTotalReturn() {
    const priceReturn = (this.finalPrice - this.buyPrice) / this.buyPrice;
    const dividendReturn =
      this.dividends.reduce((sum, div) => sum + div.amount, 0) / this.buyPrice;
    return (priceReturn + dividendReturn) * 100; // Convert to percentage
  }

  // Calculate target return
  calculateTargetReturn() {
    return ((this.targetPrice - this.buyPrice) / this.buyPrice) * 100;
  }

  // Determine judgement based on total return vs target
  getJudgement() {
    const totalReturn = this.calculateTotalReturn();
    const targetReturn = this.calculateTargetReturn();

    if (totalReturn >= targetReturn * 0.8) { // Within 20% of target
      return "Hit Target";
    } else if (totalReturn > 0) {
      return "Partial Success";
    } else {
      return "Missed Target";
    }
  }
}

// Test suite
class JudgementTestSuite {
  constructor() {
    this.tests = [];
    this.passed = 0;
    this.failed = 0;
  }

  // Add a test case
  addTest(name, scenario, expectedJudgement, expectedTotalReturn) {
    this.tests.push({
      name,
      scenario,
      expectedJudgement,
      expectedTotalReturn,
    });
  }

  // Run all tests
  runTests() {
    console.log("🧪 Running Judgement Calculation Tests\n");

    this.tests.forEach((test) => {
      const actualJudgement = test.scenario.getJudgement();
      const actualTotalReturn = test.scenario.calculateTotalReturn();

      const judgementPass = actualJudgement === test.expectedJudgement;
      const returnPass =
        Math.abs(actualTotalReturn - test.expectedTotalReturn) < 0.01;

      if (judgementPass && returnPass) {
        console.log(`✅ ${test.name}`);
        this.passed++;
      } else {
        console.log(`❌ ${test.name}`);
        console.log(
          `   Expected: ${test.expectedJudgement} (${
            test.expectedTotalReturn.toFixed(2)
          }%)`,
        );
        console.log(
          `   Actual:   ${actualJudgement} (${actualTotalReturn.toFixed(2)}%)`,
        );
        this.failed++;
      }
    });

    console.log(`\n📊 Results: ${this.passed} passed, ${this.failed} failed`);
    return this.failed === 0;
  }
}

// Create test suite
const testSuite = new JudgementTestSuite();

// Test 1: Dividend accumulation - stock loses value but dividends make it profitable
testSuite.addTest(
  "Dividend Accumulation - Profitable with Dividends",
  new StockScenario(
    1.00, // Buy price
    1.20, // Target price (20% gain)
    [
      { exDivDate: "2025-04-15", amount: 0.10 },
    ],
    0.95, // Final price (5% loss)
    90, // Days elapsed
  ),
  "Partial Success", // Should be partial success (5% < 80% of 20%)
  5.0, // 5% total return (-5% price + 10% dividend)
);

// Test 2: No dividends, stock hits target
testSuite.addTest(
  "No Dividends - Stock Hits Target",
  new StockScenario(
    1.00, // Buy price
    1.20, // Target price (20% gain)
    [], // No dividends
    1.25, // Final price (25% gain)
    90, // Days elapsed
  ),
  "Hit Target", // Should hit target
  25.0, // 25% total return
);

// Test 3: Multiple dividends
testSuite.addTest(
  "Multiple Dividends - Complex Scenario",
  new StockScenario(
    10.00, // Buy price
    12.00, // Target price (20% gain)
    [
      { exDivDate: "2025-04-15", amount: 0.50 },
      { exDivDate: "2025-05-15", amount: 0.50 },
    ],
    10.50, // Final price (5% gain)
    90, // Days elapsed
  ),
  "Partial Success", // Should be partial success (15% < 80% of 20%)
  15.0, // 15% total return (5% price + 10% dividends = 15% total)
);

// Test 4: Stock loses money even with dividends
testSuite.addTest(
  "Dividends Not Enough - Still Losing",
  new StockScenario(
    1.00, // Buy price
    1.20, // Target price (20% gain)
    [
      { exDivDate: "2025-04-15", amount: 0.05 },
    ],
    0.90, // Final price (10% loss)
    90, // Days elapsed
  ),
  "Missed Target", // Should miss target
  -5.0, // -5% total return (-10% price + 5% dividend)
);

// Test 5: Partial success with dividends
testSuite.addTest(
  "Partial Success - Small Gain with Dividends",
  new StockScenario(
    1.00, // Buy price
    1.20, // Target price (20% gain)
    [
      { exDivDate: "2025-04-15", amount: 0.08 },
    ],
    1.00, // Final price (no change)
    90, // Days elapsed
  ),
  "Partial Success", // Should be partial success
  8.0, // 8% total return (0% price + 8% dividend)
);

// Test 6: Edge case - exactly 80% of target
testSuite.addTest(
  "Edge Case - Exactly 80% of Target",
  new StockScenario(
    1.00, // Buy price
    1.20, // Target price (20% gain)
    [
      { exDivDate: "2025-04-15", amount: 0.16 },
    ],
    1.00, // Final price (no change)
    90, // Days elapsed
  ),
  "Hit Target", // Should hit target (16% = 80% of 20%)
  16.0, // 16% total return
);

// Test 7: Edge case - just under 80% of target
testSuite.addTest(
  "Edge Case - Just Under 80% of Target",
  new StockScenario(
    1.00, // Buy price
    1.20, // Target price (20% gain)
    [
      { exDivDate: "2025-04-15", amount: 0.15 },
    ],
    1.00, // Final price (no change)
    90, // Days elapsed
  ),
  "Partial Success", // Should be partial success (15% < 80% of 20%)
  15.0, // 15% total return
);

// Test 8: Zero dividends, stock loses money
testSuite.addTest(
  "No Dividends - Stock Loses Money",
  new StockScenario(
    1.00, // Buy price
    1.20, // Target price (20% gain)
    [], // No dividends
    0.90, // Final price (10% loss)
    90, // Days elapsed
  ),
  "Missed Target", // Should miss target
  -10.0, // -10% total return
);

// Run the tests
const allTestsPassed = testSuite.runTests();

console.log(
  `\n${allTestsPassed ? "🎉 All tests passed!" : "💥 Some tests failed!"}`,
);
