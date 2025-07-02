import { assert, assertEquals } from "@std/assert";

interface MarketDataPoint {
  date: Date;
  high: number;
  low: number;
  open: number;
  close: number;
  splitCoefficient: number;
}

interface StockData {
  stock: string;
  score: number;
  target: number;
  exDividendDate: string | null;
  dividendPerShare: number;
  notes: string;
  intrinsicValuePerShareBasic: number | null;
  intrinsicValuePerShareAdjusted: number | null;
}

class MockGRQValidator {
  marketData: Record<string, MarketDataPoint[]> = {};
  scoreData: StockData[] = [];
  selectedFile = "2025/April/15.tsv";

  constructor() {
    this.setupTestData();
  }

  setupTestData(): void {
    this.scoreData = [
      {
        stock: "NYSE:SCHW",
        score: 0.977,
        target: 78.12,
        exDividendDate: null,
        dividendPerShare: 0.0,
        notes: "",
        intrinsicValuePerShareBasic: null,
        intrinsicValuePerShareAdjusted: null,
      },
    ];

    // Real SCHW data from the CSV file
    this.marketData["NYSE:SCHW"] = [
      {
        date: new Date("2025-04-15"),
        high: 78.12,
        low: 77.03,
        open: 77.55,
        close: 77.19,
        splitCoefficient: 1.0,
      },
      {
        date: new Date("2025-07-01"),
        high: 91.6772,
        low: 90.14,
        open: 90.92,
        close: 91.17,
        splitCoefficient: 1.0,
      },
    ];
  }

  setDateToMidnight(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  getScoreDate(scoreFile: string): Date {
    const parts = scoreFile.split("/");
    const month = parts[1];
    const day = parts[2].split(".")[0];
    const year = parts[0];

    const monthMap: Record<string, number> = {
      January: 0,
      February: 1,
      March: 2,
      April: 3,
      May: 4,
      June: 5,
      July: 6,
      August: 7,
      September: 8,
      October: 9,
      November: 10,
      December: 11,
    };

    return new Date(parseInt(year), monthMap[month], parseInt(day));
  }

  getCurrentPrice(stockSymbol: string): string {
    const marketData = this.marketData[stockSymbol];
    if (!marketData || marketData.length === 0) {
      return "N/A";
    }

    // Use the latest market data (same as getWorking method)
    const lastData = marketData[marketData.length - 1];
    const currentPrice = (lastData.high + lastData.low) / 2; // Already post-split
    return "$" + currentPrice.toFixed(2);
  }

  getWorking(
    field: string,
    stockSymbol: string,
    _scoreData: StockData[],
  ): string {
    if (field !== "current-price") {
      return "Not a current-price field";
    }

    const scoreDate = this.getScoreDate(this.selectedFile);
    const header = `Stock: ${stockSymbol} | Field: ${field} | Score Date: ${
      scoreDate.toISOString().split("T")[0]
    }\n\n`;

    const marketData = this.marketData[stockSymbol];
    if (!marketData || marketData.length === 0) {
      return header + "Current Price working:\nNo market data available";
    }
    const lastData = marketData[marketData.length - 1];
    const currentPrice = (lastData.high + lastData.low) / 2; // Already post-split
    return (
      header +
      `Current Price working:\n= (High + Low) / 2 from latest market data\n= ($${
        lastData.high.toFixed(2)
      } + $${lastData.low.toFixed(2)}) / 2\n= $${currentPrice.toFixed(2)}`
    );
  }

  // Mock method for table display
  getCurrentPriceForTable(stockSymbol: string): string | null {
    const currentPrice = this.getCurrentPrice(stockSymbol);
    return currentPrice === "N/A" ? null : currentPrice;
  }
}

Deno.test("Current Price Consistency Tests", async (t) => {
  const validator = new MockGRQValidator();

  await t.step("current price and working logic match for SCHW", () => {
    const currentPrice = validator.getCurrentPrice("NYSE:SCHW");
    const working = validator.getWorking(
      "current-price",
      "NYSE:SCHW",
      validator.scoreData,
    );
    const tableValue = validator.getCurrentPriceForTable("NYSE:SCHW");

    // Expected: (91.6772 + 90.14) / 2 = 90.91
    const expectedPrice = "$90.91";

    assertEquals(currentPrice, expectedPrice, "Current price should be $90.91");
    assert(
      working.includes(expectedPrice),
      "Working logic should include $90.91",
    );
    assertEquals(
      tableValue,
      expectedPrice,
      "Table value should match current price",
    );

    // Extract the calculated value from working logic
    const workingMatch = working.match(/= \$(\d+\.\d+)$/m);
    assert(workingMatch, "Should be able to extract value from working logic");
    const workingValue = "$" + workingMatch[1];
    assertEquals(
      workingValue,
      expectedPrice,
      "Working logic value should match expected",
    );
    assertEquals(
      currentPrice,
      workingValue,
      "Current price and working logic should match",
    );
  });

  await t.step("handles missing market data correctly", () => {
    const currentPrice = validator.getCurrentPrice("NYSE:INVALID");
    const working = validator.getWorking(
      "current-price",
      "NYSE:INVALID",
      validator.scoreData,
    );
    const tableValue = validator.getCurrentPriceForTable("NYSE:INVALID");

    assertEquals(currentPrice, "N/A", "Should return N/A for missing stock");
    assert(
      working.includes("No market data available"),
      "Working should indicate no data",
    );
    assertEquals(
      tableValue,
      null,
      "Table value should be null for missing stock",
    );
  });

  await t.step("calculates correct current price from latest data", () => {
    const marketData = validator.marketData["NYSE:SCHW"];
    assert(
      marketData && marketData.length > 0,
      "Should have market data for SCHW",
    );

    const latestData = marketData[marketData.length - 1];
    const expectedCalculation = (latestData.high + latestData.low) / 2;
    const expectedPrice = "$" + expectedCalculation.toFixed(2);

    const currentPrice = validator.getCurrentPrice("NYSE:SCHW");
    assertEquals(
      currentPrice,
      expectedPrice,
      "Should calculate from latest data",
    );
  });

  await t.step("working logic shows correct calculation steps", () => {
    const working = validator.getWorking(
      "current-price",
      "NYSE:SCHW",
      validator.scoreData,
    );

    // Should show the calculation steps
    assert(
      working.includes("= (High + Low) / 2 from latest market data"),
      "Should show formula",
    );
    assert(
      working.includes("= ($91.68 + $90.14) / 2"),
      "Should show calculation with values",
    );
    assert(working.includes("= $90.91"), "Should show final result");
  });

  await t.step("score date is correctly parsed", () => {
    const scoreDate = validator.getScoreDate("2025/April/15.tsv");
    const expectedDate = new Date(2025, 3, 15); // April is month 3 (0-indexed)
    assertEquals(
      scoreDate.getTime(),
      expectedDate.getTime(),
      "Score date should be parsed correctly",
    );
  });
});
