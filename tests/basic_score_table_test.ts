// Basic score-table rendering tests (issue #100).
//
// Currency formatting used to be reimplemented inside a `MockGRQValidator`. It
// now comes from the REAL shared kernel `GRQProjection.formatCurrency` in
// docs/projection.js (the same function the dashboard's GRQValidator.formatCurrency
// delegates to), so the table's monetary cells can no longer drift from
// production. The HTML row layout stays local test glue (dashboard UI, not
// projection maths) but builds its currency cells with the real kernel.
import { assertEquals } from "@std/assert";
import "../docs/projection.js";

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

const g = globalThis as unknown as {
  GRQProjection: {
    formatCurrency: (value: number | null | undefined) => string;
  };
};
const formatCurrency = g.GRQProjection.formatCurrency;

function setupBasicScoreData(): ScoreData[] {
  return [
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
}

// Build the table HTML, formatting every monetary cell with the real kernel.
function updateBasicStockTable(scoreData: ScoreData[]): string {
  let tableHTML = `
    <th>Stock</th><th>Score</th><th>90-Day Target</th>
    <th>Ex-Dividend Date</th><th>Dividend Per Share</th>
    <th>Intrinsic Value (Basic)</th><th>Intrinsic Value (Adjusted)</th><th>Notes</th>
  `;

  scoreData.forEach((stock) => {
    tableHTML += `
      <td>${stock.stock}</td>
      <td>${stock.score.toFixed(3)}</td>
      <td>${formatCurrency(stock.target)}</td>
      <td>${stock.exDividendDate || "N/A"}</td>
      <td>${
      stock.dividendPerShare ? formatCurrency(stock.dividendPerShare) : "N/A"
    }</td>
      <td>${
      stock.intrinsicValuePerShareBasic
        ? formatCurrency(stock.intrinsicValuePerShareBasic)
        : "N/A"
    }</td>
      <td>${
      stock.intrinsicValuePerShareAdjusted
        ? formatCurrency(stock.intrinsicValuePerShareAdjusted)
        : "N/A"
    }</td>
      <td>${stock.notes || ""}</td>
    `;
  });

  const scoreDate = new Date("2025-02-14");
  const daysElapsed = 5;
  tableHTML += `
    <td>Score Date: ${
    scoreDate.toISOString().split("T")[0]
  } (${daysElapsed} days ago)</td>
    <td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td>
  `;

  return tableHTML;
}

Deno.test("Basic Score Table - No Market Data", async (t) => {
  const scoreData = setupBasicScoreData();

  await t.step("should generate basic score table with all score data", () => {
    const tableHTML = updateBasicStockTable(scoreData);

    assertEquals(tableHTML.includes("TEST1"), true, "Should include TEST1");
    assertEquals(tableHTML.includes("TEST2"), true, "Should include TEST2");
    assertEquals(
      tableHTML.includes("0.850"),
      true,
      "Should include TEST1 score",
    );
    assertEquals(
      tableHTML.includes("0.720"),
      true,
      "Should include TEST2 score",
    );
    assertEquals(tableHTML.includes("$18.50"), true, "Format TEST1 target");
    assertEquals(tableHTML.includes("$15.00"), true, "Format TEST2 target");
    assertEquals(tableHTML.includes("2025-03-15"), true, "Ex-dividend date");
    assertEquals(tableHTML.includes("$0.25"), true, "Format dividend");
    assertEquals(tableHTML.includes("N/A"), true, "N/A for missing dividend");
    assertEquals(tableHTML.includes("$20.00"), true, "Format basic intrinsic");
    assertEquals(
      tableHTML.includes("$19.50"),
      true,
      "Format adjusted intrinsic",
    );
    assertEquals(tableHTML.includes("Strong fundamentals"), true, "Notes");
    assertEquals(
      tableHTML.includes("Score Date: 2025-02-14 (5 days ago)"),
      true,
      "Should include summary row",
    );
  });

  await t.step("should handle null/undefined values gracefully", () => {
    const withNulls = setupBasicScoreData();
    withNulls.push({
      stock: "TEST3",
      score: 0.5,
      target: 10.0,
      exDividendDate: null,
      dividendPerShare: 0,
      notes: "",
      intrinsicValuePerShareBasic: null,
      intrinsicValuePerShareAdjusted: null,
    });

    const tableHTML = updateBasicStockTable(withNulls);
    assertEquals(tableHTML.includes("TEST3"), true, "Should include TEST3");
    assertEquals(tableHTML.includes("N/A"), true, "N/A for null values");
    assertEquals(tableHTML.includes("0.500"), true, "Format score correctly");
  });
});
