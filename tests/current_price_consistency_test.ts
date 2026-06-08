// Current-price consistency tests (issue #100).
//
// The "current price" maths — the midpoint of the latest market-data point —
// used to be reimplemented inside a `MockGRQValidator`. It now comes from the
// REAL shared kernel `GRQProjection.currentPriceFromLatest` in docs/projection.js
// (the same function the dashboard's GRQValidator.getCurrentPrice delegates to),
// so the current-price figure and its "working" explanation can no longer drift
// from production. The filename parsing and the working-string layout remain
// local test glue (they are dashboard UI plumbing, not projection maths).
import { assert, assertEquals } from "@std/assert";
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
    currentPriceFromLatest: (marketData: MarketDataPoint[]) => number | null;
    setDateToMidnight: (date: Date) => Date;
  };
};
const GRQProjection = g.GRQProjection;

const MARKET: Record<string, MarketDataPoint[]> = {
  "NYSE:SCHW": [
    {
      date: new Date(2025, 3, 15),
      high: 78.12,
      low: 77.03,
      open: 77.55,
      close: 77.19,
      splitCoefficient: 1.0,
    },
    {
      date: new Date(2025, 6, 1),
      high: 91.6772,
      low: 90.14,
      open: 90.92,
      close: 91.17,
      splitCoefficient: 1.0,
    },
  ],
};

// Real kernel drives the figure; only the "$x.xx" formatting is local.
function getCurrentPrice(stockSymbol: string): string {
  const price = GRQProjection.currentPriceFromLatest(MARKET[stockSymbol]);
  return price === null ? "N/A" : "$" + price.toFixed(2);
}

function getCurrentPriceForTable(stockSymbol: string): string | null {
  const currentPrice = getCurrentPrice(stockSymbol);
  return currentPrice === "N/A" ? null : currentPrice;
}

function getScoreDate(scoreFile: string): Date {
  const [year, month, dayPart] = scoreFile.split("/");
  const day = dayPart.split(".")[0];
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

function getWorking(field: string, stockSymbol: string): string {
  if (field !== "current-price") return "Not a current-price field";

  const scoreDate = getScoreDate("2025/April/15.tsv");
  const header = `Stock: ${stockSymbol} | Field: ${field} | Score Date: ${
    scoreDate.toISOString().split("T")[0]
  }\n\n`;

  const marketData = MARKET[stockSymbol];
  const price = GRQProjection.currentPriceFromLatest(marketData);
  if (price === null) {
    return header + "Current Price working:\nNo market data available";
  }
  const lastData = marketData[marketData.length - 1];
  return (
    header +
    `Current Price working:\n= (High + Low) / 2 from latest market data\n= ($${
      lastData.high.toFixed(2)
    } + $${lastData.low.toFixed(2)}) / 2\n= $${price.toFixed(2)}`
  );
}

Deno.test("Current Price Consistency Tests", async (t) => {
  await t.step("current price and working logic match for SCHW", () => {
    const currentPrice = getCurrentPrice("NYSE:SCHW");
    const working = getWorking("current-price", "NYSE:SCHW");
    const tableValue = getCurrentPriceForTable("NYSE:SCHW");

    // Expected: (91.6772 + 90.14) / 2 = 90.91 (to 2 dp).
    const expectedPrice = "$90.91";

    assertEquals(currentPrice, expectedPrice, "Current price should be $90.91");
    assert(working.includes(expectedPrice), "Working should include $90.91");
    assertEquals(tableValue, expectedPrice, "Table value should match price");

    const workingMatch = working.match(/= \$(\d+\.\d+)$/m);
    assert(workingMatch, "Should be able to extract value from working logic");
    assertEquals("$" + workingMatch![1], currentPrice, "Working matches price");
  });

  await t.step("handles missing market data correctly", () => {
    const currentPrice = getCurrentPrice("NYSE:INVALID");
    const working = getWorking("current-price", "NYSE:INVALID");
    const tableValue = getCurrentPriceForTable("NYSE:INVALID");

    assertEquals(currentPrice, "N/A", "Should return N/A for missing stock");
    assert(
      working.includes("No market data available"),
      "Working should indicate no data",
    );
    assertEquals(tableValue, null, "Table value should be null for missing");
  });

  await t.step("calculates correct current price from latest data", () => {
    const marketData = MARKET["NYSE:SCHW"];
    const latestData = marketData[marketData.length - 1];
    const expectedPrice = "$" + ((latestData.high + latestData.low) / 2).toFixed(2);
    assertEquals(getCurrentPrice("NYSE:SCHW"), expectedPrice, "From latest data");
  });

  await t.step("working logic shows correct calculation steps", () => {
    const working = getWorking("current-price", "NYSE:SCHW");
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
    const scoreDate = getScoreDate("2025/April/15.tsv");
    const expectedDate = new Date(2025, 3, 15); // April is month 3 (0-indexed).
    assertEquals(scoreDate.getTime(), expectedDate.getTime(), "Parsed date");
  });

  await t.step("setDateToMidnight zeroes the time component", () => {
    const midnight = GRQProjection.setDateToMidnight(
      new Date("2025-04-15T13:45:30"),
    );
    assertEquals(midnight.getHours(), 0);
    assertEquals(midnight.getMinutes(), 0);
    assertEquals(midnight.getSeconds(), 0);
  });
});
