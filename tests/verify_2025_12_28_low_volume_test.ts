// Verification: the 2025-12-28 ~180% Actual with the low-volume guard applied
// (issue #580, closing verification of #563).
//
// The low-volume guard (#576 helper, #577 exclusion, #578 valuation) is
// PROSPECTIVE: it only flags a name when the trailing market-data window
// carries usable volume. The 2025-12-28 score date predates the trailing
// volume column (#575) in its market-data CSV, so every constituent resolves
// to "unknown volume ⇒ not flagged" and NOTHING is excluded. The before/after
// "Actual" delta must therefore be exactly zero, and the figure stays the
// broad-based equal-weight average of a liquid 20-stock semiconductor basket.
//
// These assertions exercise the REAL shipped kernels over the REAL committed
// fixture (docs/scores/2025/December/28.*): the Trend-view resolver in
// docs/trend_predictions.js (which wires the #576 volume window into a
// `lowVolume` flag) and the equal-weight aggregate in docs/projection.js. The
// per-prediction dashboard (app.js) routes the same flag through the same
// predicate, so this pins the shipped behaviour for the verified date.
//
// Scope guard: split-rendering correctness on the Actual line is owned by #569
// (a post-horizon split can roughly double a displayed Actual); measurement
// correctness by #557 / #556. This test asserts only the low-volume guard's
// (non-)effect on 2025-12-28 — it does not re-verify those.
import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import "../docs/projection.js";
import "../docs/volume_recommend.js";
import "../docs/trend_series.js";
import "../docs/trend_predictions.js";

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
    getBuyPrice: (
      points: unknown[],
      scoreDate: Date,
    ) => { price: number; reliable?: boolean } | null;
    postHorizonSplitFactor: (points: unknown[], scoreDate: Date) => number;
    calculateIncludedPortfolioPerformance: (
      stocks: ResolvedStock[],
    ) => number | null;
  };
  GRQTrendPredictions: {
    parseScoreTsv: (
      text: string,
    ) => Array<{ stock: string; target: number }>;
    parseMarketCsv: (
      text: string,
    ) => Record<string, Array<{ date: Date; high: number; low: number }>>;
    parseScoreDateString: (value: string) => Date;
    buildPrediction: (
      date: string,
      tsv: string,
      csv: string,
      dividendCsv: string,
    ) => { date: string; stocks: ResolvedStock[] };
  };
};

const GRQProjection = g.GRQProjection;
const GRQTrendPredictions = g.GRQTrendPredictions;

const DIR = "docs/scores/2025/December/";
const SCORE_DATE_STR = "2025-12-28";

async function loadVerifiedPrediction() {
  const [tsv, csv, dividends] = await Promise.all([
    Deno.readTextFile(`${DIR}28.tsv`),
    Deno.readTextFile(`${DIR}28.csv`),
    Deno.readTextFile(`${DIR}28-dividends.csv`),
  ]);
  return {
    prediction: GRQTrendPredictions.buildPrediction(
      SCORE_DATE_STR,
      tsv,
      csv,
      dividends,
    ),
    tsv,
    csv,
  };
}

Deno.test("2025-12-28 market-data CSV predates the trailing volume column", async () => {
  // Root cause of the prospective behaviour: the fixture is a 7-column
  // (pre-#575) shape, so there is no volume cell for the helper to read.
  const csv = await Deno.readTextFile(`${DIR}28.csv`);
  const header = csv.split("\n")[0].trim();
  assertEquals(header, "date,ticker,high,low,open,close,split_coefficient");
  // No data row carries an 8th (volume) column.
  const widestRow = csv
    .split("\n")
    .slice(1)
    .filter((line) => line.trim())
    .reduce((max, line) => Math.max(max, line.split(",").length), 0);
  assertEquals(widestRow, 7);
});

Deno.test("2025-12-28 guard flags NO constituent (volume unknown ⇒ not flagged)", async () => {
  const { prediction } = await loadVerifiedPrediction();
  // The verified semiconductor basket is 20 names.
  assertEquals(prediction.stocks.length, 20);
  const flagged = prediction.stocks.filter((s) => s.lowVolume === true);
  assertEquals(flagged.length, 0);
});

Deno.test("2025-12-28 Actual is unchanged by the guard (before/after delta = 0)", async () => {
  const { prediction } = await loadVerifiedPrediction();
  // After the guard: honour each resolved `lowVolume` flag (all false here).
  const after = GRQProjection.calculateIncludedPortfolioPerformance(
    prediction.stocks,
  );
  // Before the guard: force `lowVolume` false everywhere (no exclusion at all).
  const before = GRQProjection.calculateIncludedPortfolioPerformance(
    prediction.stocks.map((s) => ({ ...s, lowVolume: false })),
  );
  assert(after !== null, "expected a portfolio Actual for the verified date");
  assert(before !== null);
  // Negligible-change expectation from the issue: the delta is EXACTLY zero
  // because nothing is excluded.
  assertAlmostEquals(after as number, before as number, 1e-9);
});

Deno.test("2025-12-28 Actual stays broad-based across liquid semis", async () => {
  const { prediction, tsv, csv } = await loadVerifiedPrediction();
  const rows = GRQTrendPredictions.parseScoreTsv(tsv);
  const market = GRQTrendPredictions.parseMarketCsv(csv);
  const scoreDate = GRQTrendPredictions.parseScoreDateString(SCORE_DATE_STR);

  // The ~180% figure is the 180-day "Actual (After 90 Days)" tail: the
  // equal-weight average of the basket measured at the 180-day horizon, on the
  // same split basis getBuyPrice uses (issue #569 owns the display rendering).
  const HORIZON_DAYS = 180;
  const windowEnd = new Date(
    scoreDate.getTime() + HORIZON_DAYS * 24 * 60 * 60 * 1000,
  );

  let over100 = 0;
  let counted = 0;
  rows.forEach((row, i) => {
    // Only liquid (non-flagged) names contribute — confirms breadth is not an
    // artefact of an illiquid name slipping through the guard.
    if (prediction.stocks[i].lowVolume === true) {
      return;
    }
    const points = market[row.stock];
    const buyObj = GRQProjection.getBuyPrice(points, scoreDate);
    if (!buyObj) {
      return;
    }
    let last: { high: number; low: number; date: Date } | null = null;
    for (const point of points) {
      if (point.date <= windowEnd) {
        last = point as { high: number; low: number; date: Date };
      }
    }
    if (!last) {
      return;
    }
    const current = ((last.high + last.low) / 2) /
      GRQProjection.postHorizonSplitFactor(points, scoreDate);
    const ret = ((current - buyObj.price) / buyObj.price) * 100;
    counted += 1;
    if (ret > 100) {
      over100 += 1;
    }
  });

  // Broad-based: a clear majority of the liquid basket more than doubled over
  // the 180-day horizon (prior investigation found 13/20; the guard removes
  // none of them).
  assertEquals(counted, 20);
  assert(
    over100 >= 13,
    `expected >=13 names over +100% over 180 days, got ${over100}`,
  );
});
