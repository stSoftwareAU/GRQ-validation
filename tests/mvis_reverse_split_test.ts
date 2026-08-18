// MVIS 1-for-15 reverse-split regression (issue #831).
//
// The NASDAQ:MVIS chart for prediction date 2026-02-19 jumped from about -60%
// to about +400% in early August: MVIS had a genuine 1-for-15 reverse split on
// 2026-08-03 (`split_coefficient = 0.0667`), but its magnitude (15) exceeded the
// 10:1 `MAX_PLAUSIBLE_COEFFICIENT` cap, so the series was flagged unreliable, no
// factor was applied, and raw ~$3.85 post-split prices were plotted against the
// raw ~$0.78 buy price.
//
// This locks in BOTH sides of the #831 behaviour against a frozen extract of the
// real market data (tests/fixtures/mvis_reverse_split_feb19.csv), running the
// REAL shared kernels in docs/projection.js:
//   - a large split CONFIRMED by the observed pre/post price move is trusted, so
//     the buy price is restated onto the post-split basis and the real ~-81.6%
//     loss is shown instead of a ~+400% artefact;
//   - a large split that CANNOT be reconciled still fails, and the chart's
//     actuals stop at that split with a visible flag rather than silently
//     plotting raw unadjusted prices.
// Thresholds: README _Split-reconciliation thresholds_.
import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertExists,
} from "@std/assert";
import { fromFileUrl } from "@std/path";
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
    ) => { price: number; dateUsed: Date; reliable: boolean } | null;
    getSplitAdjustment: (
      marketData: MarketDataPoint[] | undefined,
      historicalDate: Date,
    ) => number;
    computeSplitAdjustment: (
      marketData: MarketDataPoint[] | undefined,
      historicalDate: Date,
    ) => { factor: number; reliable: boolean; unreconciledDate: Date | null };
    currentPriceFromLatest: (
      marketData: MarketDataPoint[] | undefined,
    ) => number | null;
    calculatePerformanceReturn: (
      buyPrice: number,
      currentPrice: number,
      totalDividends?: number,
    ) => number | null;
    isStockIncluded: (
      buyPrice: number | null,
      currentPrice: number | null,
      splitReliable?: boolean,
      lowVolume?: boolean,
      score?: number | null,
    ) => boolean;
    truncateActualsAtUnreconciledSplit: (
      points: { x: Date; y: number }[] | undefined,
      unreconciledDate: Date | null,
    ) => {
      points: { x: Date; y: number }[];
      marker: { x: Date; y: number } | null;
    };
  };
};
const GRQProjection = g.GRQProjection;

// Parse a frozen market-data CSV exactly as docs/app.js does: split on commas,
// build a local-midnight Date, and carry the split_coefficient through.
function loadFixture(name: string): MarketDataPoint[] {
  const path = fromFileUrl(new URL(`./fixtures/${name}`, import.meta.url));
  const text = Deno.readTextFileSync(path);
  return text
    .trim()
    .split("\n")
    .slice(1) // drop header
    .map((line) => {
      const v = line.split(",");
      const [y, m, d] = v[0].split("-").map(Number);
      return {
        date: new Date(y, m - 1, d),
        high: parseFloat(v[2]),
        low: parseFloat(v[3]),
        open: parseFloat(v[4]),
        close: parseFloat(v[5]),
        splitCoefficient: parseFloat(v[6]),
      };
    });
}

const SCORE_DATE = new Date(2026, 1, 19); // 2026-02-19, local midnight
const ONE_FOR_FIFTEEN = 0.06666666666666667; // as recorded in the score CSV

Deno.test("MVIS 2026-02-19 - 1-for-15 reverse split confirmed by the price move is trusted", () => {
  const data = loadFixture("mvis_reverse_split_feb19.csv");

  const split = GRQProjection.computeSplitAdjustment(data, SCORE_DATE);
  assertAlmostEquals(
    split.factor,
    ONE_FOR_FIFTEEN,
    1e-12,
    "one 1-for-15 reverse split after the score date",
  );
  // Magnitude 15 is ABOVE the 10:1 single-event cap, but the observed price
  // move corroborates it: 0.25 pre-split midpoint / 3.92575 split-day midpoint
  // = 0.0637 against the 0.0667 coefficient, ~4.5% apart and well inside the
  // +/-15% tolerance.
  assertEquals(
    split.reliable,
    true,
    "a large split confirmed by the price move is genuine market data",
  );
  assertEquals(split.unreconciledDate, null, "nothing to stop the chart at");
  assertAlmostEquals(
    GRQProjection.getSplitAdjustment(data, SCORE_DATE),
    ONE_FOR_FIFTEEN,
    1e-12,
    "the confirmed factor is applied, not suppressed to 1.0",
  );
});

Deno.test("MVIS 2026-02-19 - the ~+400% chart jump becomes the real ~-81.6% loss", () => {
  const data = loadFixture("mvis_reverse_split_feb19.csv");

  const buy = GRQProjection.getBuyPrice(data, SCORE_DATE);
  assertExists(buy, "buy price resolves from the score-date row");
  assertEquals(buy!.reliable, true, "buy price carries the reliable flag");
  // Raw midpoint (0.81 + 0.7551) / 2 = 0.78255, restated onto the post-split
  // basis by dividing by 1/15 -> 11.73825.
  assertAlmostEquals(
    buy!.price,
    11.73825,
    1e-6,
    "buy price restated onto the post-split basis",
  );

  const current = GRQProjection.currentPriceFromLatest(data);
  assertExists(current, "current price resolves from the latest row");
  // Latest row 2026-08-14: (2.37 + 1.96) / 2 = 2.165, already post-split.
  assertAlmostEquals(current!, 2.165, 1e-9, "current price is post-split");

  const ret = GRQProjection.calculatePerformanceReturn(buy!.price, current!, 0);
  assertExists(ret, "return is computable");
  assertAlmostEquals(
    ret!,
    -81.556,
    0.01,
    "both sides sit on the same post-split basis — a loss, not a +400% jump",
  );
  assert(ret! < 0, "the split-adjusted return is negative, not a ~+400% spike");

  assertEquals(
    GRQProjection.isStockIncluded(buy!.price, current!, buy!.reliable),
    true,
    "a reconciled series is counted normally in the stats",
  );
});

Deno.test("MVIS - an UNCONFIRMED 1-for-15 split stops the actuals line and flags it", () => {
  // Same series, but with the split-day prices left on the PRE-split basis, as
  // if the feed recorded the coefficient without adjusting the quotes. Nothing
  // corroborates the 15:1 move, so the series stays untrusted.
  const data = loadFixture("mvis_reverse_split_feb19.csv").map((point) =>
    point.splitCoefficient !== 1.0
      ? { ...point, high: 0.27, low: 0.24, open: 0.25, close: 0.26 }
      : point
  );

  const split = GRQProjection.computeSplitAdjustment(data, SCORE_DATE);
  assertEquals(
    split.reliable,
    false,
    "an above-cap split the price move contradicts cannot be trusted",
  );
  assertExists(split.unreconciledDate, "the offending split date is surfaced");
  assertEquals(
    split.unreconciledDate!.getTime(),
    new Date(2026, 7, 3).getTime(),
    "the 2026-08-03 split is where the series stops being trustworthy",
  );
  assertEquals(
    GRQProjection.getSplitAdjustment(data, SCORE_DATE),
    1.0,
    "no factor is applied to an unreconciled series",
  );

  // The chart must stop at the split instead of plotting raw post-split prices.
  const plotted = data.map((point) => ({
    x: point.date,
    y: GRQProjection.calculatePerformanceReturn(
      0.78255,
      (point.high + point.low) / 2,
      0,
    )!,
  }));
  const cut = GRQProjection.truncateActualsAtUnreconciledSplit(
    plotted,
    split.unreconciledDate,
  );
  assert(cut.points.length > 0, "the reconciled part of the line is kept");
  assert(
    cut.points.length < plotted.length,
    "the unreconciled tail is dropped",
  );
  assert(
    cut.points.every((p) => p.x < split.unreconciledDate!),
    "no point on or after the unreconciled split is plotted",
  );
  assertExists(cut.marker, "the break is flagged on the chart");
  assertEquals(
    cut.marker!.x.getTime(),
    new Date(2026, 6, 31).getTime(),
    "the flag anchors on the last trustworthy trading day (2026-07-31)",
  );
});
