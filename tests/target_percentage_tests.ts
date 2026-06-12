import { assertAlmostEquals, assertEquals, assertExists } from "@std/assert";
import "../docs/projection.js";

// Target-percentage and split-adjustment tests (issue #109).
//
// These drive the REAL shipped helpers from docs/projection.js — the same code
// the dashboard's GRQValidator delegates to — with fixture inputs and assert on
// their RETURN VALUES against spec-derived expected numbers. A regression in the
// production target-percentage / split-adjustment logic now fails the suite.
// The former version recomputed the formula inline and asserted it against a
// hand-evaluation of the same formula, so it could never fail for any reason
// connected to production behaviour.

// Type definitions
interface MockStock {
  stock: string;
  target: number;
  buyPrice: number;
  originalBuyPrice: number;
  splitAdjustment: number;
  // Spec-required target return (%), independent of the production formula.
  expectedTargetPercentage: number;
}

interface MarketDataPoint {
  date: Date;
  high: number;
  low: number;
  splitCoefficient: number;
}

const g = globalThis as unknown as {
  GRQProjection: {
    calculateTargetPercentage: (
      buyPrice: number | null,
      adjustedTarget: number | null,
    ) => number | null;
    getSplitAdjustment: (
      marketData: MarketDataPoint[] | null,
      historicalDate: Date,
    ) => number;
    adjustHistoricalPriceToCurrent: (
      price: number,
      marketData: MarketDataPoint[] | null,
      historicalDate: Date,
    ) => number;
  };
};
const GRQProjection = g.GRQProjection;

Deno.test("Target Percentage Calculation Tests", async (t) => {
  const scoreDate = new Date(2024, 10, 15); // November 15, 2024
  const ninetyDayDate = new Date(
    scoreDate.getTime() + (90 * 24 * 60 * 60 * 1000),
  );

  // Mock stock data with different scenarios. Buy prices are split-adjusted;
  // expectedTargetPercentage is the spec answer the shipped helper must return.
  const mockStocks: MockStock[] = [
    {
      stock: "NYSE:WFG",
      target: 98.90,
      buyPrice: 82.42, // Split-adjusted buy price
      originalBuyPrice: 82.42, // Original price before any splits
      splitAdjustment: 1.0, // No splits
      expectedTargetPercentage: 20.0,
    },
    {
      stock: "NYSE:CX",
      target: 5.85,
      buyPrice: 4.88, // Split-adjusted buy price
      originalBuyPrice: 4.88, // Original price before any splits
      splitAdjustment: 1.0, // No splits
      expectedTargetPercentage: 19.9,
    },
    {
      stock: "NASDAQ:KLAC",
      target: 695.01,
      buyPrice: 579.18, // Split-adjusted buy price
      originalBuyPrice: 579.18, // Original price before any splits
      splitAdjustment: 1.0, // No splits
      expectedTargetPercentage: 20.0,
    },
    {
      stock: "NASDAQ:TSLA",
      target: 250.00,
      buyPrice: 125.00, // Split-adjusted buy price (after 2:1 split)
      originalBuyPrice: 250.00, // Original price before 2:1 split
      splitAdjustment: 2.0, // 2:1 split occurred
      expectedTargetPercentage: 100.0,
    },
    {
      stock: "NASDAQ:AAPL",
      target: 150.00,
      buyPrice: 50.00, // Split-adjusted buy price (after 3:1 split)
      originalBuyPrice: 150.00, // Original price before 3:1 split
      splitAdjustment: 3.0, // 3:1 split occurred
      expectedTargetPercentage: 200.0,
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
      const splitDate = new Date(
        scoreDate.getTime() + (30 * 24 * 60 * 60 * 1000),
      ); // 30 days after score
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
    const targetPercentage = GRQProjection.calculateTargetPercentage(
      testStock.buyPrice,
      testStock.target,
    );

    assertAlmostEquals(
      targetPercentage as number,
      testStock.expectedTargetPercentage,
      0.1,
      `Target percentage for ${testStock.stock} should be ${testStock.expectedTargetPercentage}%`,
    );
  });

  await t.step(
    "single stock target percentage calculation - with 2:1 split",
    () => {
      const testStock = mockStocks[3]; // NASDAQ:TSLA

      // Both target and buy price are split-adjusted by the same factor, so the
      // shipped helper should still return 100%: (250 - 125) / 125 * 100.
      const targetPercentage = GRQProjection.calculateTargetPercentage(
        testStock.buyPrice,
        testStock.target,
      );

      assertAlmostEquals(
        targetPercentage as number,
        testStock.expectedTargetPercentage,
        0.1,
        `Target percentage for ${testStock.stock} with 2:1 split should be ${testStock.expectedTargetPercentage}%`,
      );
    },
  );

  await t.step(
    "single stock target percentage calculation - with 3:1 split",
    () => {
      const testStock = mockStocks[4]; // NASDAQ:AAPL

      // Split-adjusted on both sides, so the shipped helper returns 200%:
      // (150 - 50) / 50 * 100.
      const targetPercentage = GRQProjection.calculateTargetPercentage(
        testStock.buyPrice,
        testStock.target,
      );

      assertAlmostEquals(
        targetPercentage as number,
        testStock.expectedTargetPercentage,
        0.1,
        `Target percentage for ${testStock.stock} with 3:1 split should be ${testStock.expectedTargetPercentage}%`,
      );
    },
  );

  await t.step("portfolio target percentage calculation", () => {
    // Drive each stock through the shipped helper, then average.
    const targetPercentages = mockStocks.map((stock) =>
      GRQProjection.calculateTargetPercentage(
        stock.buyPrice,
        stock.target,
      ) as number
    );

    // Calculate portfolio target (average of individual targets)
    const portfolioTarget = targetPercentages.reduce((sum, target) =>
      sum + target, 0) / targetPercentages.length;
    const expectedPortfolioTarget = 72.0; // Average of all spec target percentages

    assertAlmostEquals(
      portfolioTarget,
      expectedPortfolioTarget,
      0.1,
      "Portfolio target should be the average of individual stock targets",
    );
  });

  await t.step("split adjustment calculation", () => {
    const testStock = mockStocks[3]; // NASDAQ:TSLA with 2:1 split
    const marketData = createMockMarketData(testStock);

    // The shipped helper walks the market data and multiplies post-score splits.
    const splitAdjustment = GRQProjection.getSplitAdjustment(
      marketData,
      scoreDate,
    );
    assertEquals(
      splitAdjustment,
      2.0,
      "Split adjustment should be 2.0 for 2:1 split",
    );

    // Restating the original price in current terms should yield the
    // split-adjusted buy price.
    const adjustedPrice = GRQProjection.adjustHistoricalPriceToCurrent(
      testStock.originalBuyPrice,
      marketData,
      scoreDate,
    );
    assertAlmostEquals(
      adjustedPrice,
      testStock.buyPrice,
      0.001,
      "Split-adjusted price should match expected buy price",
    );
  });

  await t.step("market data split coefficient handling", () => {
    const testStock = mockStocks[3]; // NASDAQ:TSLA
    const marketData = createMockMarketData(testStock);

    // The shipped split helper should recover the fixture's split factor.
    const splitAdjustment = GRQProjection.getSplitAdjustment(
      marketData,
      scoreDate,
    );
    assertEquals(
      splitAdjustment,
      testStock.splitAdjustment,
      "Cumulative split adjustment should match expected split adjustment",
    );

    // No splits before the score date.
    assertEquals(
      GRQProjection.getSplitAdjustment(marketData, ninetyDayDate),
      1.0,
      "No splits should be counted after the latest split date",
    );
  });

  await t.step("target percentage edge cases", () => {
    // Buy price equals target -> 0%.
    const zeroTargetPercentage = GRQProjection.calculateTargetPercentage(
      100.00,
      100.00,
    );
    assertEquals(
      zeroTargetPercentage,
      0.0,
      "Target percentage should be 0% when buy price equals target",
    );

    // Target lower than buy price -> negative.
    const negativeTargetPercentage = GRQProjection.calculateTargetPercentage(
      100.00,
      80.00,
    );
    assertEquals(
      negativeTargetPercentage,
      -20.0,
      "Target percentage should be negative when target is lower than buy price",
    );

    // Missing inputs are guarded and return null.
    assertEquals(
      GRQProjection.calculateTargetPercentage(null, 100.00),
      null,
      "Target percentage should be null when buy price is missing",
    );
  });

  await t.step("multiple splits handling", () => {
    // Stock with multiple splits, already split-adjusted on both sides.
    const target = 300.00;
    const buyPrice = 50.00; // After 2:1 and 3:1 splits = 6:1 total
    const expectedTargetPercentage = 500.0; // (300 - 50) / 50 * 100

    const targetPercentage = GRQProjection.calculateTargetPercentage(
      buyPrice,
      target,
    );

    assertAlmostEquals(
      targetPercentage as number,
      expectedTargetPercentage,
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
