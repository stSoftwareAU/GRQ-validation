import { assertAlmostEquals, assertEquals, assertExists } from "@std/assert";

interface MarketDataPoint {
  date: Date;
  high: number;
  low: number;
  open: number;
  close: number;
  splitCoefficient: number;
}

interface Stock {
  stock: string;
  target: number;
}

class MockGRQValidator {
  marketData: Record<string, MarketDataPoint[]> = {};
  dividendData: Record<string, unknown[]> = {};

  setupFebruary15Data(): void {
    this.marketData = {
      "NASDAQ:XP": [
        {
          date: new Date("2025-02-18"),
          high: 15.18,
          low: 14.72,
          open: 14.72,
          close: 15.02,
          splitCoefficient: 1.0,
        },
        {
          date: new Date("2025-02-19"),
          high: 15.25,
          low: 14.85,
          open: 15.02,
          close: 15.10,
          splitCoefficient: 1.0,
        },
        {
          date: new Date("2025-02-20"),
          high: 15.30,
          low: 14.90,
          open: 15.10,
          close: 15.20,
          splitCoefficient: 1.0,
        },
      ],
    };
  }

  getHistoricalToCurrentSplitAdjustment(
    stockSymbol: string,
    historicalDate: Date,
  ): number {
    const marketData = this.marketData[stockSymbol];
    if (!marketData) return 1.0;
    let cumulativeSplit = 1.0;
    for (const point of marketData) {
      if (point.date > historicalDate && point.splitCoefficient > 1.0) {
        cumulativeSplit *= point.splitCoefficient;
      }
    }
    return cumulativeSplit;
  }

  adjustHistoricalPriceToCurrent(
    price: number,
    stockSymbol: string,
    historicalDate: Date,
  ): number {
    const splitAdjustment = this.getHistoricalToCurrentSplitAdjustment(
      stockSymbol,
      historicalDate,
    );
    return price / splitAdjustment;
  }

  getBuyPrice(
    stockSymbol: string,
    scoreDate: Date,
  ): { price: number; dateUsed: Date } | null {
    const marketData = this.marketData[stockSymbol];
    if (!marketData) return null;
    for (let offset = 0; offset <= 5; offset++) {
      const candidateDate = new Date(scoreDate.getTime());
      candidateDate.setDate(candidateDate.getDate() + offset);
      const candidateData = marketData.find((point) => {
        const pointDate = new Date(
          point.date.getFullYear(),
          point.date.getMonth(),
          point.date.getDate(),
        );
        const candidateDateOnly = new Date(
          candidateDate.getFullYear(),
          candidateDate.getMonth(),
          candidateDate.getDate(),
        );
        return pointDate.getTime() === candidateDateOnly.getTime();
      });
      if (candidateData) {
        return {
          price: this.adjustHistoricalPriceToCurrent(
            (candidateData.high + candidateData.low) / 2,
            stockSymbol,
            scoreDate,
          ),
          dateUsed: candidateDate,
        };
      }
    }
    return null;
  }

  calculateTargetPercentage(stock: Stock, scoreDate: Date): number | null {
    const buyPrice = this.getBuyPrice(stock.stock, scoreDate);
    const adjustedTarget = this.adjustHistoricalPriceToCurrent(
      stock.target,
      stock.stock,
      scoreDate,
    );
    if (buyPrice !== null && adjustedTarget !== null) {
      return ((adjustedTarget - buyPrice.price) / buyPrice.price) * 100;
    }
    return null;
  }

  calculateStockPerformanceWithDilution(
    stock: Stock,
    scoreDate: Date,
  ): number | null {
    const marketData = this.marketData[stock.stock];
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
    const buyPriceObj = this.getBuyPrice(stock.stock, scoreDate);
    if (buyPriceObj === null) return null;
    const priceReturn =
      ((currentPrice - buyPriceObj.price) / buyPriceObj.price) * 100;
    const dividendReturn = 0; // No dividends in test data
    return priceReturn + dividendReturn;
  }
}

Deno.test("Buy Price Logic - February 15, 2025 Case", async (t) => {
  const validator = new MockGRQValidator();
  validator.setupFebruary15Data();
  const scoreDate = new Date("2025-02-14");
  const stock: Stock = { stock: "NASDAQ:XP", target: 18.5 };

  await t.step(
    "should find buy price on next available trading day (Feb 18)",
    () => {
      const buyPrice = validator.getBuyPrice("NASDAQ:XP", scoreDate);
      assertExists(buyPrice, "Buy price should not be null");
      assertEquals(
        buyPrice!.price,
        14.95,
        "Buy price should be (15.18 + 14.72) / 2 = 14.95",
      );
      assertEquals(
        buyPrice!.dateUsed.toISOString().split("T")[0],
        "2025-02-18",
        "Should use February 18, 2025",
      );
    },
  );

  await t.step("should calculate target percentage correctly", () => {
    const targetPercentage = validator.calculateTargetPercentage(
      stock,
      scoreDate,
    );
    assertExists(targetPercentage, "Target percentage should not be null");
    assertAlmostEquals(
      targetPercentage!,
      23.75,
      0.01,
      "Target percentage should be 23.75%",
    );
  });

  await t.step("should calculate performance correctly", () => {
    const performance = validator.calculateStockPerformanceWithDilution(
      stock,
      scoreDate,
    );
    assertAlmostEquals(performance!, 1.0, 0.01, "Performance should be 1.00%");
  });
});

Deno.test("Buy Price Logic - Edge Cases", async (t) => {
  const validator = new MockGRQValidator();

  await t.step("should return null for non-existent stock", () => {
    const buyPrice = validator.getBuyPrice(
      "NONEXISTENT",
      new Date("2025-02-14"),
    );
    assertEquals(buyPrice, null, "Should return null for non-existent stock");
  });

  await t.step("should return null when no market data", () => {
    validator.marketData = {};
    const buyPrice = validator.getBuyPrice("NASDAQ:XP", new Date("2025-02-14"));
    assertEquals(buyPrice, null, "Should return null when no market data");
  });

  await t.step("should handle exact date match", () => {
    validator.setupFebruary15Data();
    const buyPrice = validator.getBuyPrice("NASDAQ:XP", new Date("2025-02-18"));
    assertExists(buyPrice, "Buy price should not be null");
    assertEquals(
      buyPrice!.dateUsed.toISOString().split("T")[0],
      "2025-02-18",
      "Should use exact date when available",
    );
  });
});

Deno.test("Buy Price Logic - Split Adjustments", async (t) => {
  const validator = new MockGRQValidator();
  validator.marketData = {
    "NASDAQ:XP": [
      {
        date: new Date("2025-02-18"),
        high: 30.36,
        low: 29.44,
        open: 29.44,
        close: 30.04,
        splitCoefficient: 1.0,
      },
      {
        date: new Date("2025-02-20"),
        high: 15.18,
        low: 14.72,
        open: 14.72,
        close: 15.02,
        splitCoefficient: 2.0,
      },
    ],
  };

  await t.step("should adjust buy price for splits", () => {
    const buyPrice = validator.getBuyPrice("NASDAQ:XP", new Date("2025-02-18"));
    assertExists(buyPrice, "Buy price should not be null");
    assertEquals(
      buyPrice!.price,
      14.95,
      "Buy price should be adjusted for split",
    );
  });
});

Deno.test("Buy Price Logic - 5 Day Forward Search", async (t) => {
  const validator = new MockGRQValidator();
  validator.marketData = {
    "NASDAQ:XP": [
      {
        date: new Date("2025-02-14"),
        high: 15.18,
        low: 14.72,
        open: 14.72,
        close: 15.02,
        splitCoefficient: 1.0,
      },
      {
        date: new Date("2025-02-19"),
        high: 15.25,
        low: 14.85,
        open: 15.02,
        close: 15.10,
        splitCoefficient: 1.0,
      },
    ],
  };

  await t.step("should find price within 5 days", () => {
    const buyPrice = validator.getBuyPrice("NASDAQ:XP", new Date("2025-02-14"));
    assertExists(buyPrice, "Buy price should not be null");
    assertEquals(
      buyPrice!.dateUsed.toISOString().split("T")[0],
      "2025-02-14",
      "Should find exact date when available",
    );
  });

  await t.step("should return null if no price found within 5 days", () => {
    validator.marketData = {
      "NASDAQ:XP": [
        {
          date: new Date("2025-02-25"),
          high: 15.18,
          low: 14.72,
          open: 14.72,
          close: 15.02,
          splitCoefficient: 1.0,
        },
      ],
    };
    const buyPrice = validator.getBuyPrice("NASDAQ:XP", new Date("2025-02-14"));
    assertEquals(
      buyPrice,
      null,
      "Should return null when no price found within 5 days",
    );
  });
});

Deno.test("Buy Price Logic - Null Safety", async (t) => {
  const validator = new MockGRQValidator();

  await t.step(
    "should handle null buy price in target percentage calculation",
    () => {
      const targetPercentage = validator.calculateTargetPercentage(
        { stock: "NONEXISTENT", target: 18.5 },
        new Date("2025-02-14"),
      );
      assertEquals(
        targetPercentage,
        null,
        "Should return null when buy price is null",
      );
    },
  );

  await t.step(
    "should handle null buy price in performance calculation",
    () => {
      const performance = validator.calculateStockPerformanceWithDilution(
        { stock: "NONEXISTENT", target: 18.5 },
        new Date("2025-02-14"),
      );
      assertEquals(
        performance,
        null,
        "Should return null when buy price is null",
      );
    },
  );
});
