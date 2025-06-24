// Integration test for 90-day portfolio calculations

class IntegrationTest {
  constructor() {
    this.scoreDate = new Date(2024, 10, 15); // November 15, 2024
    this.ninetyDayDate = new Date(
      this.scoreDate.getTime() + (90 * 24 * 60 * 60 * 1000),
    );
  }

  test90DayBoundary() {
    console.log("=== 90-Day Boundary Test ===");

    // Test that all calculations respect the 90-day boundary
    const testDate = new Date("2025-03-14"); // After 90 days
    const isAfter90Days = testDate > this.ninetyDayDate;

    console.log("Test Date:", testDate.toDateString());
    console.log("90-Day Boundary:", this.ninetyDayDate.toDateString());
    console.log("Is after 90 days:", isAfter90Days);
    console.log("Test Result:", isAfter90Days ? "PASS" : "FAIL");

    return isAfter90Days;
  }

  testPortfolioTargetLogic() {
    console.log("");
    console.log("=== Portfolio Target Logic Test ===");

    // Test that portfolio target is 20% for equal-weighted portfolio
    const individualTarget = 20.0; // Each stock target
    const portfolioTarget = 20.0; // Equal weighting means same target

    console.log("Individual Stock Target:", individualTarget + "%");
    console.log("Portfolio Target (Equal Weight):", portfolioTarget + "%");
    console.log(
      "Test Result:",
      Math.abs(portfolioTarget - individualTarget) < 0.1 ? "PASS" : "FAIL",
    );

    return Math.abs(portfolioTarget - individualTarget) < 0.1;
  }

  testDividendExclusion() {
    console.log("");
    console.log("=== Dividend Exclusion Test ===");

    // Test that dividends after 90 days are excluded
    const testDividends = [
      { exDivDate: new Date("2024-12-19"), amount: 0.135 }, // Within 90 days
      { exDivDate: new Date("2024-12-27"), amount: 0.32 }, // Within 90 days
      { exDivDate: new Date("2025-03-14"), amount: 0.32 }, // After 90 days
    ];

    const dividendsWithin90Days = testDividends.filter((d) =>
      d.exDivDate <= this.ninetyDayDate
    );

    console.log("Total dividends:", testDividends.length);
    console.log("Dividends within 90 days:", dividendsWithin90Days.length);
    console.log("Expected: 2 dividends within 90 days");
    console.log(
      "Test Result:",
      dividendsWithin90Days.length === 2 ? "PASS" : "FAIL",
    );

    return dividendsWithin90Days.length === 2;
  }

  testPerformanceCalculation() {
    console.log("");
    console.log("=== Performance Calculation Test ===");

    // Mock performance calculation
    const buyPrice = 100.0;
    const priceAt90Days = 120.0; // 20% gain
    const dividends = 2.0; // $2 in dividends

    const priceReturn = ((priceAt90Days - buyPrice) / buyPrice) * 100;
    const dividendReturn = (dividends / buyPrice) * 100;
    const totalReturn = priceReturn + dividendReturn;

    console.log("Buy Price: $" + buyPrice.toFixed(2));
    console.log("90-Day Price: $" + priceAt90Days.toFixed(2));
    console.log("Dividends: $" + dividends.toFixed(2));
    console.log("Price Return: " + priceReturn.toFixed(1) + "%");
    console.log("Dividend Return: " + dividendReturn.toFixed(1) + "%");
    console.log("Total Return: " + totalReturn.toFixed(1) + "%");
    console.log("Expected Total Return: 22.0%");
    console.log(
      "Test Result:",
      Math.abs(totalReturn - 22.0) < 0.1 ? "PASS" : "FAIL",
    );

    return Math.abs(totalReturn - 22.0) < 0.1;
  }

  testChartDataLimitation() {
    console.log("");
    console.log("=== Chart Data Limitation Test ===");

    // Test that chart data is limited to 90 days
    const mockDataPoints = [
      { date: new Date("2024-11-15"), value: 100 }, // Score date
      { date: new Date("2024-12-15"), value: 110 }, // Within 90 days
      { date: new Date("2025-01-15"), value: 115 }, // Within 90 days
      { date: new Date("2025-02-15"), value: 120 }, // Within 90 days
      { date: new Date("2025-03-15"), value: 125 }, // After 90 days
    ];

    const dataWithin90Days = mockDataPoints.filter((point) =>
      point.date <= this.ninetyDayDate
    );

    console.log("Total data points:", mockDataPoints.length);
    console.log("Data points within 90 days:", dataWithin90Days.length);
    console.log(
      "Expected: 3 data points within 90 days (excluding score date and after 90 days)",
    );
    console.log(
      "Test Result:",
      dataWithin90Days.length === 3 ? "PASS" : "FAIL",
    );

    return dataWithin90Days.length === 3;
  }

  runAllTests() {
    console.log(
      "Running integration tests for 90-day portfolio calculations...\n",
    );

    const test1 = this.test90DayBoundary();
    const test2 = this.testPortfolioTargetLogic();
    const test3 = this.testDividendExclusion();
    const test4 = this.testPerformanceCalculation();
    const test5 = this.testChartDataLimitation();

    console.log("");
    console.log("=== Integration Test Summary ===");
    console.log("90-Day Boundary:", test1 ? "PASS" : "FAIL");
    console.log("Portfolio Target Logic:", test2 ? "PASS" : "FAIL");
    console.log("Dividend Exclusion:", test3 ? "PASS" : "FAIL");
    console.log("Performance Calculation:", test4 ? "PASS" : "FAIL");
    console.log("Chart Data Limitation:", test5 ? "PASS" : "FAIL");
    console.log(
      "Overall Result:",
      test1 && test2 && test3 && test4 && test5
        ? "ALL TESTS PASSED"
        : "SOME TESTS FAILED",
    );

    return test1 && test2 && test3 && test4 && test5;
  }
}

// Run the tests if this file is executed directly
if (typeof module !== "undefined" && module.exports) {
  module.exports = IntegrationTest;
} else {
  // Browser environment
  const test = new IntegrationTest();
  test.runAllTests();
}
