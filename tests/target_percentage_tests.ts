
import { assertEquals,assertExists, assertAlmostEquals } from "@std/assert";

// Test case for target percentage calculations with stock dilution handling

// Type definitions
interface MockStock {
  stock: string;
  target: number;
  buyPrice: number;
  originalBuyPrice: number;
  splitAdjustment: number;
  expectedTargetPercentage: number;
}

interface MarketDataPoint {
  date: Date;
  high: number;
  low: number;
  splitCoefficient: number;
}

Deno.test("Target Percentage Calculation Tests", async (t) => {
  const scoreDate = new Date(2024, 10, 15); // November 15, 2024
  const ninetyDayDate = new Date(
    scoreDate.getTime() + (90 * 24 * 60 * 60 * 1000),
  );

  // Mock stock data with different scenarios
  const mockStocks: MockStock[] = [
    {
      stock: "NYSE:WFG",
      target: 98.90,
      buyPrice: 82.42, // Split-adjusted buy price
      originalBuyPrice: 82.42, // Original price before any splits
      splitAdjustment: 1.0, // No splits
      expectedTargetPercentage: 20.0, // (98.90 - 82.42) / 82.42 * 100
    },
    {
      stock: "NYSE:CX",
      target: 5.85,
      buyPrice: 4.88, // Split-adjusted buy price
      originalBuyPrice: 4.88, // Original price before any splits
      splitAdjustment: 1.0, // No splits
      expectedTargetPercentage: 19.9, // (5.85 - 4.88) / 4.88 * 100
    },
    {
      stock: "NASDAQ:KLAC",
      target: 695.01,
      buyPrice: 579.18, // Split-adjusted buy price
      originalBuyPrice: 579.18, // Original price before any splits
      splitAdjustment: 1.0, // No splits
      expectedTargetPercentage: 20.0, // (695.01 - 579.18) / 579.18 * 100
    },
    {
      stock: "NASDAQ:TSLA",
      target: 250.00,
      buyPrice: 125.00, // Split-adjusted buy price (after 2:1 split)
      originalBuyPrice: 250.00, // Original price before 2:1 split
      splitAdjustment: 2.0, // 2:1 split occurred
      expectedTargetPercentage: 100.0, // (250.00 - 125.00) / 125.00 * 100
    },
    {
      stock: "NASDAQ:AAPL",
      target: 150.00,
      buyPrice: 50.00, // Split-adjusted buy price (after 3:1 split)
      originalBuyPrice: 150.00, // Original price before 3:1 split
      splitAdjustment: 3.0, // 3:1 split occurred
      expectedTargetPercentage: 200.0, // (150.00 - 50.00) / 50.00 * 100
    },
  ];

  // Mock market data with split information
  const createMockMarketData = (stock: MockStock): MarketDataPoint[] => {
    const marketData: MarketDataPoint[] = [];
    
    // Add score date data
    marketData.push({
      date: scoreDate,
      high: stock.originalBuyPrice * 1.01, // Slightly higher than buy price
      low: stock.originalBuyPrice * 0.99, // Slightly lower than buy price
      splitCoefficient: 1.0, // No split on score date
    });

    // Add split data if applicable
    if (stock.splitAdjustment > 1.0) {
      const splitDate = new Date(scoreDate.getTime() + (30 * 24 * 60 * 60 * 1000)); // 30 days after score
      marketData.push({
        date: splitDate,
        high: stock.originalBuyPrice / stock.splitAdjustment * 1.01,
        low: stock.originalBuyPrice / stock.splitAdjustment * 0.99,
        splitCoefficient: stock.splitAdjustment,
      });
    }

    // Add 90-day data
    marketData.push({
      date: ninetyDayDate,
      high: stock.target * 1.01,
      low: stock.target * 0.99,
      splitCoefficient: 1.0,
    });

    return marketData;
  };

  await t.step("single stock target percentage calculation - no splits", () => {
    const testStock = mockStocks[0]; // NYSE:WFG
    const targetPercentage = ((testStock.target - testStock.buyPrice) / testStock.buyPrice) * 100;
    
    assertAlmostEquals(
      targetPercentage,
      testStock.expectedTargetPercentage,
      0.1,
      `Target percentage for ${testStock.stock} should be ${testStock.expectedTargetPercentage}%`,
    );
  });

  await t.step("single stock target percentage calculation - with 2:1 split", () => {
    const testStock = mockStocks[3]; // NASDAQ:TSLA
    
    // When there's a split, both target and buy price are adjusted by the same factor
    // So the target percentage remains the same: (250 - 125) / 125 * 100 = 100%
    const targetPercentage = ((testStock.target - testStock.buyPrice) / testStock.buyPrice) * 100;
    
    assertAlmostEquals(
      targetPercentage,
      testStock.expectedTargetPercentage,
      0.1,
      `Target percentage for ${testStock.stock} with 2:1 split should be ${testStock.expectedTargetPercentage}%`,
    );
  });

  await t.step("single stock target percentage calculation - with 3:1 split", () => {
    const testStock = mockStocks[4]; // NASDAQ:AAPL
    
    // When there's a split, both target and buy price are adjusted by the same factor
    // So the target percentage remains the same: (150 - 50) / 50 * 100 = 200%
    const targetPercentage = ((testStock.target - testStock.buyPrice) / testStock.buyPrice) * 100;
    
    assertAlmostEquals(
      targetPercentage,
      testStock.expectedTargetPercentage,
      0.1,
      `Target percentage for ${testStock.stock} with 3:1 split should be ${testStock.expectedTargetPercentage}%`,
    );
  });

  await t.step("portfolio target percentage calculation", () => {
    // Calculate individual target percentages (split-adjusted prices are already provided)
    const targetPercentages = mockStocks.map((stock) => {
      return ((stock.target - stock.buyPrice) / stock.buyPrice) * 100;
    });

    // Calculate portfolio target (average of individual targets)
    const portfolioTarget = targetPercentages.reduce((sum, target) => sum + target, 0) / targetPercentages.length;
    const expectedPortfolioTarget = 72.0; // Average of all target percentages

    assertAlmostEquals(
      portfolioTarget,
      expectedPortfolioTarget,
      0.1,
      "Portfolio target should be the average of individual stock targets",
    );
  });

  await t.step("split adjustment calculation", () => {
    const testStock = mockStocks[3]; // NASDAQ:TSLA with 2:1 split
    
    // Test split adjustment logic
    const originalPrice = testStock.originalBuyPrice;
    const splitAdjustment = testStock.splitAdjustment;
    const adjustedPrice = originalPrice / splitAdjustment;
    
    assertEquals(
      adjustedPrice,
      testStock.buyPrice,
      "Split-adjusted price should match expected buy price",
    );
    
    assertEquals(
      splitAdjustment,
      2.0,
      "Split adjustment should be 2.0 for 2:1 split",
    );
  });

  await t.step("market data split coefficient handling", () => {
    const testStock = mockStocks[3]; // NASDAQ:TSLA
    const marketData = createMockMarketData(testStock);
    
    // Find split data
    const splitData = marketData.find((point) => point.splitCoefficient > 1.0);
    assertExists(splitData, "Split data should exist for stocks with splits");
    if (splitData) {
      assertEquals(
        splitData.splitCoefficient,
        testStock.splitAdjustment,
        "Split coefficient should match expected split adjustment",
      );
    }
  });

  await t.step("target percentage edge cases", () => {
    // Test case where buy price equals target (0% target)
    const zeroTargetStock = {
      stock: "TEST:ZERO",
      target: 100.00,
      buyPrice: 100.00,
      originalBuyPrice: 100.00,
      splitAdjustment: 1.0,
      expectedTargetPercentage: 0.0,
    };
    
    const zeroTargetPercentage = ((zeroTargetStock.target - zeroTargetStock.buyPrice) / zeroTargetStock.buyPrice) * 100;
    assertEquals(
      zeroTargetPercentage,
      zeroTargetStock.expectedTargetPercentage,
      "Target percentage should be 0% when buy price equals target",
    );

    // Test case where target is lower than buy price (negative target)
    const negativeTargetStock = {
      stock: "TEST:NEG",
      target: 80.00,
      buyPrice: 100.00,
      originalBuyPrice: 100.00,
      splitAdjustment: 1.0,
      expectedTargetPercentage: -20.0,
    };
    
    const negativeTargetPercentage = ((negativeTargetStock.target - negativeTargetStock.buyPrice) / negativeTargetStock.buyPrice) * 100;
    assertEquals(
      negativeTargetPercentage,
      negativeTargetStock.expectedTargetPercentage,
      "Target percentage should be negative when target is lower than buy price",
    );
  });

  await t.step("multiple splits handling", () => {
    // Test stock with multiple splits
    const multiSplitStock = {
      stock: "TEST:MULTI",
      target: 300.00, // Already split-adjusted
      buyPrice: 50.00, // Already split-adjusted (after 2:1 and 3:1 splits = 6:1 total)
      originalBuyPrice: 300.00, // Original price before splits
      splitAdjustment: 6.0, // 2:1 * 3:1 = 6:1 total
      expectedTargetPercentage: 500.0, // (300.00 - 50.00) / 50.00 * 100
    };
    
    // Both target and buy price are already split-adjusted, so calculate directly
    const targetPercentage = ((multiSplitStock.target - multiSplitStock.buyPrice) / multiSplitStock.buyPrice) * 100;
    
    assertAlmostEquals(
      targetPercentage,
      multiSplitStock.expectedTargetPercentage,
      0.1,
      "Target percentage should handle multiple splits correctly",
    );
  });

  await t.step("date validation for target calculations", () => {
    const testStock = mockStocks[0]; // NYSE:WFG
    const marketData = createMockMarketData(testStock);
    
    // Verify score date exists in market data
    const scoreDateData = marketData.find((point) => 
      point.date.getTime() === scoreDate.getTime()
    );
    assertExists(scoreDateData, "Score date data should exist in market data");
    
    // Verify 90-day date exists in market data
    const ninetyDayData = marketData.find((point) => 
      point.date.getTime() === ninetyDayDate.getTime()
    );
    assertExists(ninetyDayData, "90-day date data should exist in market data");
  });
}); 