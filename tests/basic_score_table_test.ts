import { assertEquals } from "@std/assert";

interface ScoreData {
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
  scoreData: ScoreData[] = [];
  marketData: Record<string, unknown[]> = {};
  selectedFile = "test.tsv";

  setupBasicScoreData(): void {
    this.scoreData = [
      {
        stock: "TEST1",
        score: 0.85,
        target: 18.5,
        exDividendDate: "2025-03-15",
        dividendPerShare: 0.25,
        notes: "Strong fundamentals",
        intrinsicValuePerShareBasic: 20.0,
        intrinsicValuePerShareAdjusted: 19.5,
      },
      {
        stock: "TEST2",
        score: 0.72,
        target: 15.0,
        exDividendDate: null,
        dividendPerShare: 0,
        notes: "",
        intrinsicValuePerShareBasic: null,
        intrinsicValuePerShareAdjusted: null,
      },
    ];
    // No market data
    this.marketData = {};
  }

  getScoreDate(): Date {
    return new Date("2025-02-14");
  }

  getDaysElapsed(): number {
    return 5; // 5 days ago
  }

  formatCurrency(value: number | null | undefined): string {
    if (value === null || value === undefined || isNaN(value)) {
      return "N/A";
    }
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  }

  updateBasicStockTable(): string {
    // Simulate the table generation
    let tableHTML = "";
    
    // Table headers
    tableHTML += `
      <th>Stock</th>
      <th>Score</th>
      <th>90-Day Target</th>
      <th>Ex-Dividend Date</th>
      <th>Dividend Per Share</th>
      <th>Intrinsic Value (Basic)</th>
      <th>Intrinsic Value (Adjusted)</th>
      <th>Notes</th>
    `;

    // Stock rows
    this.scoreData.forEach((stock) => {
      tableHTML += `
        <td>${stock.stock}</td>
        <td>${stock.score.toFixed(3)}</td>
        <td>${this.formatCurrency(stock.target)}</td>
        <td>${stock.exDividendDate || "N/A"}</td>
        <td>${stock.dividendPerShare ? this.formatCurrency(stock.dividendPerShare) : "N/A"}</td>
        <td>${stock.intrinsicValuePerShareBasic ? this.formatCurrency(stock.intrinsicValuePerShareBasic) : "N/A"}</td>
        <td>${stock.intrinsicValuePerShareAdjusted ? this.formatCurrency(stock.intrinsicValuePerShareAdjusted) : "N/A"}</td>
        <td>${stock.notes || ""}</td>
      `;
    });

    // Summary row
    const scoreDate = this.getScoreDate();
    const daysElapsed = this.getDaysElapsed();
    tableHTML += `
      <td>Score Date: ${scoreDate.toISOString().split('T')[0]} (${daysElapsed} days ago)</td>
      <td>-</td>
      <td>-</td>
      <td>-</td>
      <td>-</td>
      <td>-</td>
      <td>-</td>
      <td>-</td>
    `;

    return tableHTML;
  }
}

Deno.test("Basic Score Table - No Market Data", async (t) => {
  const validator = new MockGRQValidator();
  validator.setupBasicScoreData();

  await t.step("should generate basic score table with all score data", () => {
    const tableHTML = validator.updateBasicStockTable();
    
    // Check that all stocks are included
    assertEquals(tableHTML.includes("TEST1"), true, "Should include TEST1 stock");
    assertEquals(tableHTML.includes("TEST2"), true, "Should include TEST2 stock");
    
    // Check that score data is formatted correctly
    assertEquals(tableHTML.includes("0.850"), true, "Should include TEST1 score");
    assertEquals(tableHTML.includes("0.720"), true, "Should include TEST2 score");
    
    // Check that target prices are formatted as currency
    assertEquals(tableHTML.includes("$18.50"), true, "Should format TEST1 target as currency");
    assertEquals(tableHTML.includes("$15.00"), true, "Should format TEST2 target as currency");
    
    // Check that dividend data is handled correctly
    assertEquals(tableHTML.includes("2025-03-15"), true, "Should include ex-dividend date");
    assertEquals(tableHTML.includes("$0.25"), true, "Should format dividend as currency");
    assertEquals(tableHTML.includes("N/A"), true, "Should show N/A for missing dividend data");
    
    // Check that intrinsic values are handled correctly
    assertEquals(tableHTML.includes("$20.00"), true, "Should format basic intrinsic value");
    assertEquals(tableHTML.includes("$19.50"), true, "Should format adjusted intrinsic value");
    
    // Check that notes are included
    assertEquals(tableHTML.includes("Strong fundamentals"), true, "Should include notes");
    
    // Check that summary row is included
    assertEquals(tableHTML.includes("Score Date: 2025-02-14 (5 days ago)"), true, "Should include summary row");
  });

  await t.step("should handle null/undefined values gracefully", () => {
    // Add a stock with null values
    validator.scoreData.push({
      stock: "TEST3",
      score: 0.5,
      target: 10.0,
      exDividendDate: null,
      dividendPerShare: 0,
      notes: "",
      intrinsicValuePerShareBasic: null,
      intrinsicValuePerShareAdjusted: null,
    });

    const tableHTML = validator.updateBasicStockTable();
    
    // Check that null values are handled
    assertEquals(tableHTML.includes("TEST3"), true, "Should include TEST3 stock");
    assertEquals(tableHTML.includes("N/A"), true, "Should show N/A for null values");
    assertEquals(tableHTML.includes("0.500"), true, "Should format score correctly");
  });
}); 