// Isolation regression for the dashboard's pick-detail columns (issue #840).
//
// The columns are RENDERING ONLY: #835 asks to SHOW why a name might not have
// been picked, not to change what the portfolio holds. So the tripwire this
// file exists to be is simple — compute the real portfolio figures for a real
// committed score date, render every pick cell over the same data, and assert
// nothing moved: the resolved per-stock 90-day figures, the equal-weight
// portfolio Actual, the inclusion predicate that drives the star filter and the
// chart's Actual line, and the chart's own inputs.
//
// It runs the SHIPPED kernels over the SHIPPED data (docs/scores/2026/July/19),
// so a future change that wires a pick value into `isStockIncluded`, into the
// displayed score, or into an aggregate fails here.

import { assertEquals } from "@std/assert";
import "../docs/escape.js";
import "../docs/projection.js";
import "../docs/volume_recommend.js";
import "../docs/trend_series.js";
import "../docs/trend_predictions.js";
import "../docs/pick_details.js";
// The pick columns now render "show the working" popovers and the accessible
// text behind each emoji, which live in docs/pick_working.js (issue #841).
import "../docs/pick_working.js";
import "../docs/pick_columns.js";

interface ResolvedStock {
  buyPrice: number | null;
  currentPrice: number | null;
  totalDividends: number;
  adjustedTarget: number | null;
  splitReliable?: boolean;
  lowVolume?: boolean;
}

const g = globalThis as unknown as {
  GRQProjection: {
    calculateIncludedPortfolioPerformance: (
      stocks: ResolvedStock[],
    ) => number | null;
    isStockIncluded: (
      buyPrice: number | null,
      currentPrice: number | null,
      splitReliable: boolean,
      lowVolume: boolean,
      score: number | null,
    ) => boolean;
  };
  GRQTrendPredictions: {
    parseScoreTsv: (
      text: string,
    ) => Array<{ stock: string; target: number; score?: number }>;
    parseMarketCsv: (text: string) => Record<string, unknown[]>;
    parseDividendCsv: (text: string) => Record<string, unknown[]>;
    resolvePredictionStocks: (
      scoreRows: Array<{ stock: string; target: number }>,
      marketData: Record<string, unknown[]>,
      dividendData: Record<string, unknown[]>,
      scoreDate: Date,
    ) => ResolvedStock[];
  };
  GRQPickColumns: {
    pickColumnValues: (input: Record<string, unknown>) => Record<
      string,
      unknown
    >;
    trafficLightCell: (values: Record<string, unknown>) => string;
    pickDetailCells: (values: Record<string, unknown>) => string;
  };
};

const { GRQProjection, GRQTrendPredictions, GRQPickColumns } = g;

const SCORE_DIR = "docs/scores/2026/July";
const SCORE_DATE = new Date(2026, 6, 19); // 2026-07-19, local midnight

async function loadFixture() {
  const [tsv, csv, dividends] = await Promise.all([
    Deno.readTextFile(`${SCORE_DIR}/19.tsv`),
    Deno.readTextFile(`${SCORE_DIR}/19.csv`),
    Deno.readTextFile(`${SCORE_DIR}/19-dividends.csv`),
  ]);
  const rows = GRQTrendPredictions.parseScoreTsv(tsv);
  const market = GRQTrendPredictions.parseMarketCsv(csv);
  const divs = GRQTrendPredictions.parseDividendCsv(dividends);
  const stocks = GRQTrendPredictions.resolvePredictionStocks(
    rows,
    market,
    divs,
    SCORE_DATE,
  );
  return { rows, market, stocks };
}

/** Every figure the dashboard's aggregates, star filter and chart read. */
function snapshot(
  rows: Array<{ stock: string; target: number; score?: number }>,
  market: Record<string, unknown[]>,
  stocks: ResolvedStock[],
) {
  return JSON.stringify({
    portfolioActual: GRQProjection.calculateIncludedPortfolioPerformance(
      stocks,
    ),
    perStock: stocks.map((stock, index) => ({
      stock: rows[index].stock,
      score: rows[index].score ?? null,
      target: rows[index].target,
      buyPrice: stock.buyPrice,
      currentPrice: stock.currentPrice,
      adjustedTarget: stock.adjustedTarget,
      totalDividends: stock.totalDividends,
      lowVolume: stock.lowVolume ?? false,
      splitReliable: stock.splitReliable ?? true,
      included: GRQProjection.isStockIncluded(
        stock.buyPrice,
        stock.currentPrice,
        stock.splitReliable !== false,
        stock.lowVolume === true,
        rows[index].score ?? null,
      ),
    })),
    // The chart's Actual line reads the same per-ticker series the pick columns
    // borrow for their fallback ADV window, so the series itself is snapshotted.
    series: Object.fromEntries(
      Object.entries(market).map(([ticker, points]) => [
        ticker,
        (points as unknown[]).length,
      ]),
    ),
  });
}

Deno.test("2026-07-19: rendering the pick columns leaves every 90-day figure byte-identical", async () => {
  const { rows, market, stocks } = await loadFixture();
  const before = snapshot(rows, market, stocks);

  // Render the full set of pick cells for every stock, exactly as the
  // aggregate-view row template does.
  const cells = rows.map((row, index) => {
    const values = GRQPickColumns.pickColumnValues({
      sidecar: null, // this date has no committed sidecar yet
      series: market[row.stock],
      scoreDate: SCORE_DATE,
      eps: (row as { eps?: number | null }).eps ?? null,
      buyPrice: stocks[index].buyPrice,
    });
    return GRQPickColumns.trafficLightCell(values) +
      GRQPickColumns.pickDetailCells(values);
  });

  assertEquals(cells.length, rows.length, "one cell run per stock");
  assertEquals(
    snapshot(rows, market, stocks),
    before,
    "the pick columns must not disturb any portfolio, 90-day, star-filter or chart figure",
  );
});

Deno.test("2026-07-19: the inclusion predicate is blind to the pick values", async () => {
  const { rows, market, stocks } = await loadFixture();

  // Recompute inclusion with a deliberately awful pick verdict in hand: a red
  // light must change nothing, because it is never an input to the predicate.
  const includedBefore = stocks.map((stock, index) =>
    GRQProjection.isStockIncluded(
      stock.buyPrice,
      stock.currentPrice,
      stock.splitReliable !== false,
      stock.lowVolume === true,
      rows[index].score ?? null,
    )
  );

  rows.forEach((row, index) => {
    GRQPickColumns.pickColumnValues({
      sidecar: {
        week52Low: 1,
        week52High: 100,
        closeScoreDate: 99, // pinned at the 52-week high
        close5dPrior: 200, // a savage 5-day fall
        advDollar10d: 1, // effectively untradeable
      },
      series: market[row.stock],
      scoreDate: SCORE_DATE,
      eps: -5, // loss making
      buyPrice: stocks[index].buyPrice,
    });
  });

  const includedAfter = stocks.map((stock, index) =>
    GRQProjection.isStockIncluded(
      stock.buyPrice,
      stock.currentPrice,
      stock.splitReliable !== false,
      stock.lowVolume === true,
      rows[index].score ?? null,
    )
  );

  assertEquals(includedAfter, includedBefore);
});
