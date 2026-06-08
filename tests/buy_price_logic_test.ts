// Buy-price / split-adjustment / target-percentage tests (issue #100).
//
// These used to drive a `MockGRQValidator` that copied getBuyPrice,
// getHistoricalToCurrentSplitAdjustment, adjustHistoricalPriceToCurrent,
// calculateTargetPercentage and the dilution performance maths. They now call
// the REAL shared kernels in docs/projection.js (getBuyPrice, getSplitAdjustment,
// adjustHistoricalPriceToCurrent, calculateTargetPercentage,
// calculatePerformanceReturn) — the same code the dashboard's GRQValidator uses.
//
// Dates are built with local-midnight constructors so they match the kernel's
// local-midnight date comparison regardless of the runner's timezone, and date
// assertions use local getters (not toISOString, which would shift across the
// date line in +/- UTC offsets).
import { assertAlmostEquals, assertEquals, assertExists } from "@std/assert";
import "../docs/projection.js";

interface MarketDataPoint {
  date: Date;
  high: number;
  low: number;
  open: number;
  close: number;
  splitCoefficient: number;
}

const g = globalThis as unknown as {
  GRQProjection: {
    getBuyPrice: (
      marketData: MarketDataPoint[] | undefined,
      scoreDate: Date,
    ) => { price: number; dateUsed: Date } | null;
    adjustHistoricalPriceToCurrent: (
      price: number,
      marketData: MarketDataPoint[] | undefined,
      historicalDate: Date,
    ) => number;
    calculateTargetPercentage: (
      buyPrice: number | null,
      adjustedTarget: number | null,
    ) => number | null;
    calculatePerformanceReturn: (
      buyPrice: number,
      currentPrice: number,
      totalDividends?: number,
    ) => number | null;
  };
};
const GRQProjection = g.GRQProjection;

function targetPercentage(
  marketData: MarketDataPoint[] | undefined,
  scoreDate: Date,
  target: number,
): number | null {
  const buyPrice = GRQProjection.getBuyPrice(marketData, scoreDate);
  const adjustedTarget = GRQProjection.adjustHistoricalPriceToCurrent(
    target,
    marketData,
    scoreDate,
  );
  return GRQProjection.calculateTargetPercentage(
    buyPrice !== null ? buyPrice.price : null,
    adjustedTarget,
  );
}

// Mirror GRQValidator.calculateStockPerformanceWithDilution: last price within
// 90 days vs the split-adjusted buy price (test data carries no dividends).
function performanceWithDilution(
  marketData: MarketDataPoint[] | undefined,
  scoreDate: Date,
): number | null {
  if (!marketData || marketData.length === 0) return null;
  const ninetyDayDate = new Date(
    scoreDate.getTime() + 90 * 24 * 60 * 60 * 1000,
  );
  const within90Days = marketData.filter((point) =>
    point.date <= ninetyDayDate
  );
  if (within90Days.length === 0) return null;
  const lastData = within90Days[within90Days.length - 1];
  const currentPrice = (lastData.high + lastData.low) / 2;
  const buyPriceObj = GRQProjection.getBuyPrice(marketData, scoreDate);
  if (buyPriceObj === null) return null;
  return GRQProjection.calculatePerformanceReturn(
    buyPriceObj.price,
    currentPrice,
    0,
  );
}

function februaryData(): MarketDataPoint[] {
  return [
    {
      date: new Date(2025, 1, 18),
      high: 15.18,
      low: 14.72,
      open: 14.72,
      close: 15.02,
      splitCoefficient: 1.0,
    },
    {
      date: new Date(2025, 1, 19),
      high: 15.25,
      low: 14.85,
      open: 15.02,
      close: 15.10,
      splitCoefficient: 1.0,
    },
    {
      date: new Date(2025, 1, 20),
      high: 15.30,
      low: 14.90,
      open: 15.10,
      close: 15.20,
      splitCoefficient: 1.0,
    },
  ];
}

Deno.test("Buy Price Logic - February 15, 2025 Case", async (t) => {
  const marketData = februaryData();
  const scoreDate = new Date(2025, 1, 14);

  await t.step(
    "should find buy price on next available trading day (Feb 18)",
    () => {
      const buyPrice = GRQProjection.getBuyPrice(marketData, scoreDate);
      assertExists(buyPrice, "Buy price should not be null");
      assertEquals(
        buyPrice!.price,
        14.95,
        "Buy price should be (15.18 + 14.72) / 2 = 14.95",
      );
      assertEquals(buyPrice!.dateUsed.getFullYear(), 2025);
      assertEquals(buyPrice!.dateUsed.getMonth(), 1, "February");
      assertEquals(buyPrice!.dateUsed.getDate(), 18, "Should use February 18");
    },
  );

  await t.step("should calculate target percentage correctly", () => {
    const pct = targetPercentage(marketData, scoreDate, 18.5);
    assertExists(pct, "Target percentage should not be null");
    assertAlmostEquals(pct!, 23.75, 0.01, "Target percentage should be 23.75%");
  });

  await t.step("should calculate performance correctly", () => {
    const performance = performanceWithDilution(marketData, scoreDate);
    assertAlmostEquals(performance!, 1.0, 0.01, "Performance should be 1.00%");
  });
});

Deno.test("Buy Price Logic - Edge Cases", async (t) => {
  await t.step("should return null for non-existent stock", () => {
    const buyPrice = GRQProjection.getBuyPrice(
      undefined,
      new Date(2025, 1, 14),
    );
    assertEquals(buyPrice, null, "Should return null for non-existent stock");
  });

  await t.step("should return null when no market data", () => {
    const buyPrice = GRQProjection.getBuyPrice(
      undefined,
      new Date(2025, 1, 14),
    );
    assertEquals(buyPrice, null, "Should return null when no market data");
  });

  await t.step("should handle exact date match", () => {
    const buyPrice = GRQProjection.getBuyPrice(
      februaryData(),
      new Date(2025, 1, 18),
    );
    assertExists(buyPrice, "Buy price should not be null");
    assertEquals(buyPrice!.dateUsed.getDate(), 18, "Should use exact date");
  });
});

Deno.test("Buy Price Logic - Split Adjustments", async (t) => {
  const marketData: MarketDataPoint[] = [
    {
      date: new Date(2025, 1, 18),
      high: 30.36,
      low: 29.44,
      open: 29.44,
      close: 30.04,
      splitCoefficient: 1.0,
    },
    {
      date: new Date(2025, 1, 20),
      high: 15.18,
      low: 14.72,
      open: 14.72,
      close: 15.02,
      splitCoefficient: 2.0,
    },
  ];

  await t.step("should adjust buy price for splits", () => {
    const buyPrice = GRQProjection.getBuyPrice(
      marketData,
      new Date(2025, 1, 18),
    );
    assertExists(buyPrice, "Buy price should not be null");
    // (30.36 + 29.44) / 2 = 29.90, divided by the 2:1 split = 14.95.
    assertEquals(buyPrice!.price, 14.95, "Buy price should be split-adjusted");
  });
});

Deno.test("Buy Price Logic - 5 Day Forward Search", async (t) => {
  await t.step("should find price within 5 days", () => {
    const marketData: MarketDataPoint[] = [
      {
        date: new Date(2025, 1, 14),
        high: 15.18,
        low: 14.72,
        open: 14.72,
        close: 15.02,
        splitCoefficient: 1.0,
      },
      {
        date: new Date(2025, 1, 19),
        high: 15.25,
        low: 14.85,
        open: 15.02,
        close: 15.10,
        splitCoefficient: 1.0,
      },
    ];
    const buyPrice = GRQProjection.getBuyPrice(
      marketData,
      new Date(2025, 1, 14),
    );
    assertExists(buyPrice, "Buy price should not be null");
    assertEquals(buyPrice!.dateUsed.getDate(), 14, "Should find exact date");
  });

  await t.step("should return null if no price found within 5 days", () => {
    const marketData: MarketDataPoint[] = [
      {
        date: new Date(2025, 1, 25),
        high: 15.18,
        low: 14.72,
        open: 14.72,
        close: 15.02,
        splitCoefficient: 1.0,
      },
    ];
    const buyPrice = GRQProjection.getBuyPrice(
      marketData,
      new Date(2025, 1, 14),
    );
    assertEquals(buyPrice, null, "Should return null beyond the 5-day window");
  });
});

Deno.test("Buy Price Logic - Null Safety", async (t) => {
  await t.step(
    "should handle null buy price in target percentage calculation",
    () => {
      const pct = targetPercentage(undefined, new Date(2025, 1, 14), 18.5);
      assertEquals(pct, null, "Should return null when buy price is null");
    },
  );

  await t.step(
    "should handle null buy price in performance calculation",
    () => {
      const performance = performanceWithDilution(
        undefined,
        new Date(2025, 1, 14),
      );
      assertEquals(
        performance,
        null,
        "Should return null when buy price is null",
      );
    },
  );
});
