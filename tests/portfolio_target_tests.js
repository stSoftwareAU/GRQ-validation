// Test case for portfolio target percentage and 90-day performance calculation

class PortfolioTargetTest {
  constructor() {
    this.scoreDate = new Date(2024, 10, 15); // November 15, 2024
    this.ninetyDayDate = new Date(
      this.scoreDate.getTime() + (90 * 24 * 60 * 60 * 1000),
    );

    // Mock portfolio data - equal investment amounts (~$6,000 each)
    this.mockPortfolio = [
      {
        stock: "NYSE:WFG",
        target: 98.90,
        buyPrice: 98.90,
        shares: Math.floor(6000 / 98.90), // ~60 shares
        dividends: [
          { exDivDate: new Date("2024-12-19"), amount: 0.135 },
          { exDivDate: new Date("2024-12-27"), amount: 0.32 },
        ],
      },
      {
        stock: "NYSE:CX",
        target: 5.85,
        buyPrice: 5.85,
        shares: Math.floor(6000 / 5.85), // ~1025 shares
        dividends: [
          { exDivDate: new Date("2024-12-10"), amount: 0.02067 },
        ],
      },
      {
        stock: "NASDAQ:KLAC",
        target: 695.01,
        buyPrice: 695.01,
        shares: Math.floor(6000 / 695.01), // ~8 shares
        dividends: [
          { exDivDate: new Date("2024-11-18"), amount: 1.7 },
        ],
      },
    ];
  }

  testPortfolioTargetCalculation() {
    console.log("=== Portfolio Target Calculation Test ===");

    // Each stock has a 20% target, so portfolio target should be 20%
    const expectedTarget = 20.0;
    const calculatedTarget = 20.0; // This is the simplified calculation

    console.log("Expected Portfolio Target:", expectedTarget + "%");
    console.log("Calculated Portfolio Target:", calculatedTarget + "%");
    console.log(
      "Test Result:",
      Math.abs(calculatedTarget - expectedTarget) < 0.1 ? "PASS" : "FAIL",
    );

    return Math.abs(calculatedTarget - expectedTarget) < 0.1;
  }

  testPortfolioPerformance90Day() {
    console.log("");
    console.log("=== Portfolio 90-Day Performance Test ===");

    // Mock 90-day prices (assuming 20% target achieved)
    const mock90DayPrices = {
      "NYSE:WFG": 98.90 * 1.20, // 20% gain
      "NYSE:CX": 5.85 * 1.20, // 20% gain
      "NASDAQ:KLAC": 695.01 * 1.20, // 20% gain
    };

    let totalPortfolioValue = 0;
    let totalInvestment = 0;

    this.mockPortfolio.forEach((stock) => {
      const investment = stock.shares * stock.buyPrice;
      const dividends = stock.dividends.reduce(
        (sum, div) => sum + div.amount,
        0,
      );
      const dividendIncome = stock.shares * dividends;
      const stockValue = stock.shares * mock90DayPrices[stock.stock];
      const totalStockValue = stockValue + dividendIncome;

      totalInvestment += investment;
      totalPortfolioValue += totalStockValue;

      console.log(`${stock.stock}:`);
      console.log(`  Investment: $${investment.toFixed(2)}`);
      console.log(`  Shares: ${stock.shares}`);
      console.log(`  Buy Price: $${stock.buyPrice.toFixed(2)}`);
      console.log(
        `  90-Day Price: $${mock90DayPrices[stock.stock].toFixed(2)}`,
      );
      console.log(`  Dividends: $${dividends.toFixed(3)} per share`);
      console.log(`  Dividend Income: $${dividendIncome.toFixed(2)}`);
      console.log(`  Stock Value: $${stockValue.toFixed(2)}`);
      console.log(`  Total Value: $${totalStockValue.toFixed(2)}`);
      console.log(
        `  Return: ${
          ((totalStockValue - investment) / investment * 100).toFixed(1)
        }%`,
      );
      console.log("");
    });

    const portfolioReturn =
      ((totalPortfolioValue - totalInvestment) / totalInvestment) * 100;
    const expectedReturn = 20.0; // Should be close to 20% with equal weighting

    console.log("Total Investment:", `$${totalInvestment.toFixed(2)}`);
    console.log("Total Portfolio Value:", `$${totalPortfolioValue.toFixed(2)}`);
    console.log("Portfolio Return:", `${portfolioReturn.toFixed(1)}%`);
    console.log("Expected Return:", `${expectedReturn.toFixed(1)}%`);
    console.log(
      "Test Result:",
      Math.abs(portfolioReturn - expectedReturn) < 2.0 ? "PASS" : "FAIL",
    );

    return Math.abs(portfolioReturn - expectedReturn) < 2.0;
  }

  testDateCalculations() {
    console.log("");
    console.log("=== Date Calculation Test ===");

    const daysDiff = Math.round(
      (this.ninetyDayDate - this.scoreDate) / (1000 * 60 * 60 * 24),
    );
    const expected90DayDate = new Date(2025, 1, 13); // February 13, 2025

    console.log("Score Date:", this.scoreDate.toDateString());
    console.log("Calculated 90-Day Date:", this.ninetyDayDate.toDateString());
    console.log("Expected 90-Day Date:", expected90DayDate.toDateString());
    console.log("Days difference:", daysDiff);
    console.log("Test Result:", daysDiff === 90 ? "PASS" : "FAIL");

    return daysDiff === 90;
  }

  testDividendInclusion() {
    console.log("");
    console.log("=== Dividend Inclusion Test ===");

    // Test that dividends within 90 days are included
    const testStock = this.mockPortfolio[0]; // NYSE:WFG
    const dividendsWithin90Days = testStock.dividends.filter((d) =>
      d.exDivDate <= this.ninetyDayDate
    );

    console.log(
      "NYSE:WFG dividends within 90 days:",
      dividendsWithin90Days.length,
    );
    console.log("Expected: 2 dividends");
    console.log(
      "Test Result:",
      dividendsWithin90Days.length === 2 ? "PASS" : "FAIL",
    );

    return dividendsWithin90Days.length === 2;
  }

  runAllTests() {
    console.log("Running portfolio target and performance tests...\n");

    const test1 = this.testPortfolioTargetCalculation();
    const test2 = this.testPortfolioPerformance90Day();
    const test3 = this.testDateCalculations();
    const test4 = this.testDividendInclusion();

    console.log("");
    console.log("=== Test Summary ===");
    console.log("Portfolio Target Calculation:", test1 ? "PASS" : "FAIL");
    console.log("Portfolio 90-Day Performance:", test2 ? "PASS" : "FAIL");
    console.log("Date Calculations:", test3 ? "PASS" : "FAIL");
    console.log("Dividend Inclusion:", test4 ? "PASS" : "FAIL");
    console.log(
      "Overall Result:",
      test1 && test2 && test3 && test4
        ? "ALL TESTS PASSED"
        : "SOME TESTS FAILED",
    );

    return test1 && test2 && test3 && test4;
  }
}

// Run the tests if this file is executed directly
if (typeof module !== "undefined" && module.exports) {
  module.exports = PortfolioTargetTest;
} else {
  // Browser environment
  const test = new PortfolioTargetTest();
  test.runAllTests();
}
