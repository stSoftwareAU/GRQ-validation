// Verification for issue #580 — confirm the low-volume guard (#576/#577/#578)
// does NOT materially change the 2025-12-28 "Actual" line.
//
// Prior investigation (#563) found the ~180% Actual for the 2025-12-28 view is
// the equal-weight average of a 20-stock semiconductor basket where the
// high-flyers (MXL, AEHR, UCTT, MRVL, ...) are real, LIQUID semis — not penny
// stocks. The low-volume guard is therefore expected to be PROSPECTIVE: the
// 2025-12-28 market-data CSV predates the trailing volume column (#575), so
// volume is "unknown" for every constituent and — by the documented
// "insufficient data ⇒ not flagged" rule — NO name is flagged or excluded.
//
// This test pins that conclusion against the REAL shipped data and kernels:
//   - docs/scores/2025/December/28.{tsv,csv,-dividends.csv} (the actual basket);
//   - the shipped resolver (docs/trend_predictions.js) that wires the #576
//     volume window into a per-stock `lowVolume` flag;
//   - the shipped equal-weight Actual kernel (docs/projection.js).
// It asserts zero names are flagged and that the before/after Actual delta is
// exactly zero, so a future regression (a units bug in the helper, or the
// volume column being back-filled with bad data) would fail this test.
import { assert, assertEquals } from "@std/assert";
import "../docs/projection.js";
import "../docs/volume_recommend.js";
import "../docs/trend_series.js";
import "../docs/trend_predictions.js";

const GRQVolume = (globalThis as unknown as {
  GRQVolume: {
    averageDollarVolume: (window: unknown) => number | null;
    buildTrailingVolumeWindow: (series: unknown, asOf: unknown) => unknown[];
  };
}).GRQVolume;

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
  };
  GRQTrendPredictions: {
    parseScoreTsv: (text: string) => Array<{ stock: string; target: number }>;
    parseMarketCsv: (text: string) => Record<string, unknown[]>;
    parseDividendCsv: (text: string) => Record<string, unknown[]>;
    resolvePredictionStocks: (
      scoreRows: Array<{ stock: string; target: number }>,
      marketData: Record<string, unknown[]>,
      dividendData: Record<string, unknown[]>,
      scoreDate: Date,
    ) => ResolvedStock[];
  };
};

const GRQProjection = g.GRQProjection;
const GRQTrendPredictions = g.GRQTrendPredictions;

const SCORE_DIR = "docs/scores/2025/December";
const SCORE_DATE = new Date(2025, 11, 28); // 2025-12-28, local midnight

async function resolve2025_12_28(): Promise<{
  rows: Array<{ stock: string; target: number }>;
  stocks: ResolvedStock[];
}> {
  const [tsv, csv, dividends] = await Promise.all([
    Deno.readTextFile(`${SCORE_DIR}/28.tsv`),
    Deno.readTextFile(`${SCORE_DIR}/28.csv`),
    Deno.readTextFile(`${SCORE_DIR}/28-dividends.csv`),
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
  return { rows, stocks };
}

Deno.test("2025-12-28: the basket is the expected 20-name semiconductor set", async () => {
  const { rows } = await resolve2025_12_28();
  assertEquals(rows.length, 20);
  // Spot-check the high-flyers named in #563 are present (and therefore would
  // each have to be illiquid to move the Actual if they were flagged).
  const tickers = new Set(rows.map((r) => r.stock));
  for (const t of ["NASDAQ:MXL", "NASDAQ:AEHR", "NASDAQ:UCTT", "NASDAQ:MRVL"]) {
    assert(tickers.has(t), `expected high-flyer ${t} in the basket`);
  }
});

Deno.test("2025-12-28: NO constituent is flagged low-volume (volume column absent ⇒ unknown ⇒ not flagged)", async () => {
  const { rows, stocks } = await resolve2025_12_28();
  const flagged = stocks
    .map((s, i) => ({ stock: rows[i].stock, lowVolume: s.lowVolume }))
    .filter((s) => s.lowVolume === true)
    .map((s) => s.stock);
  // The whole point of the verification: zero names flagged on this date.
  assertEquals(
    flagged,
    [],
    `expected no low-volume flags for 2025-12-28, got: ${flagged.join(", ")}`,
  );
});

Deno.test("2025-12-28: every constituent's trailing volume is UNKNOWN (root cause — horizon-independent)", async () => {
  // The flagging decision is computed from the trailing volume window BEFORE
  // the score date, so it is independent of whether the Actual reads the 90-day
  // or the 180-day horizon. Proving the average dollar volume is null for every
  // name shows the guard cannot fire on this date under ANY view.
  const csv = await Deno.readTextFile(`${SCORE_DIR}/28.csv`);
  const market = GRQTrendPredictions.parseMarketCsv(csv) as Record<
    string,
    unknown[]
  >;
  const tickers = Object.keys(market);
  assertEquals(tickers.length, 20);
  for (const ticker of tickers) {
    const window = GRQVolume.buildTrailingVolumeWindow(
      market[ticker],
      SCORE_DATE,
    );
    assertEquals(
      GRQVolume.averageDollarVolume(window),
      null,
      `${ticker} should have unknown (null) trailing dollar volume on 2025-12-28`,
    );
  }
});

Deno.test("2025-12-28: the guard leaves the Actual unchanged (before == after, delta 0)", async () => {
  const { stocks } = await resolve2025_12_28();
  // After: the guard is live — stocks carry their resolved `lowVolume` flags.
  const after = GRQProjection.calculateIncludedPortfolioPerformance(stocks);
  // Before: simulate the pre-guard world by clearing every low-volume flag.
  const before = GRQProjection.calculateIncludedPortfolioPerformance(
    stocks.map((s) => ({ ...s, lowVolume: false })),
  );
  assert(before !== null, "expected a non-null Actual for 2025-12-28");
  assert(after !== null, "expected a non-null Actual for 2025-12-28");
  // The guard excludes nothing, so the Actual is identical to the bit.
  assertEquals(after, before);
});
