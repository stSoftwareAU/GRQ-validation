// KLAC split-distortion regression (issues #291 + #292, parent #272).
//
// This loads the FROZEN fixtures under tests/fixtures/ and runs the REAL shared
// kernels in docs/projection.js (getBuyPrice, getSplitAdjustment,
// computeSplitAdjustment, currentPriceFromLatest, calculatePerformanceReturn) —
// the same code the dashboard's GRQValidator uses.
//
// Issue #291 (the spike) pinned the root cause from these fixtures: the old
// getSplitAdjustment multiplied EVERY split_coefficient > 1.0 with no de-dup,
// plausibility bound, or price-ratio reconciliation, inflating KLAC to
// ~+1302.5% (distorted) and ~+1640% (duplicate row).
//
// Issue #292 fixes that root cause via computeSplitAdjustment (correct-or-flag).
// Business-logic change documented here: the two tests that previously asserted
// the *defective* numbers (distorted return ~+1302.5%, duplicate factor 100)
// now assert the *corrected* behaviour — the distorted series is flagged
// `reliable: false` and no longer inflates, and the duplicate row de-duplicates
// to a factor of 10. The reconciled (+74%) and clean (+15%) controls are
// unchanged. Thresholds: README _Split-reconciliation thresholds_ (folded from
// the pruned docs/fixes/ investigation in #759).
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
    ) => { factor: number; reliable: boolean };
    currentPriceFromLatest: (
      marketData: MarketDataPoint[] | undefined,
    ) => number | null;
    calculatePerformanceReturn: (
      buyPrice: number,
      currentPrice: number,
      totalDividends?: number,
    ) => number | null;
  };
};
const GRQProjection = g.GRQProjection;

// Parse a frozen market-data CSV exactly as docs/app.js does: split on commas,
// build a local-midnight Date, and carry the split_coefficient through. The
// date is constructed from the Y-M-D parts (local midnight) so it matches the
// kernel's local-midnight date comparison regardless of the runner timezone.
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

// All three KLAC fixtures share the same score/buy date.
const SCORE_DATE = new Date(2026, 2, 11); // 2026-03-11, local midnight

function priceReturn(
  marketData: MarketDataPoint[],
  scoreDate: Date,
): { factor: number; buyPrice: number; current: number; ret: number } {
  const buy = GRQProjection.getBuyPrice(marketData, scoreDate);
  assertExists(buy, "buy price should resolve from fixture");
  const current = GRQProjection.currentPriceFromLatest(marketData);
  assertExists(current, "current price should resolve from fixture");
  const ret = GRQProjection.calculatePerformanceReturn(buy!.price, current!, 0);
  assertExists(ret, "return should be computable");
  return {
    factor: GRQProjection.getSplitAdjustment(marketData, scoreDate),
    buyPrice: buy!.price,
    current: current!,
    ret: ret!,
  };
}

Deno.test("KLAC split distortion - corrected: flagged unreliable, no inflation (#292)", () => {
  // BEFORE #292 this fixture inflated to ~+1302.5% (factor 10 applied while the
  // latest price was still pre-split). AFTER #292 computeSplitAdjustment's
  // price-ratio cross-check fails (the price never dropped 10-fold), so the
  // series is flagged unreliable and the factor is NOT applied.
  const data = loadFixture("klac_split_distorted.csv");

  const split = GRQProjection.computeSplitAdjustment(data, SCORE_DATE);
  // The suspect cumulative factor is still surfaced for diagnostics...
  assertEquals(split.factor, 10, "diagnostic cumulative factor is still 10");
  // ...but the series cannot be reconciled, so it is flagged.
  assertEquals(split.reliable, false, "distorted series flagged unreliable");

  // getSplitAdjustment refuses to apply the unreliable factor (returns 1.0).
  assertEquals(
    GRQProjection.getSplitAdjustment(data, SCORE_DATE),
    1.0,
    "unreliable factor suppressed to 1.0",
  );

  const r = priceReturn(data, SCORE_DATE);
  // getBuyPrice surfaces the same flag.
  const buy = GRQProjection.getBuyPrice(data, SCORE_DATE);
  assertExists(buy);
  assertEquals(buy!.reliable, false, "buy price carries the reliability flag");
  // Buy price is the raw midpoint (1495 + 1454) / 2 = 1474.50 — no over-division.
  assertAlmostEquals(r.buyPrice, 1474.5, 1e-9, "buy price not over-divided");
  // Crucially, the return is no longer the inflated ~+1302.5%.
  assert(
    r.ret < 300,
    `corrected return must not inflate past +300% (was ${r.ret})`,
  );
});

Deno.test("KLAC split reconciled - correct return when split applied both sides", () => {
  const data = loadFixture("klac_split_reconciled.csv");
  const r = priceReturn(data, SCORE_DATE);

  assertEquals(r.factor, 10, "cumulative split factor is 10");
  assertAlmostEquals(
    r.buyPrice,
    147.45,
    1e-9,
    "buy price split-adjusted to 147.45",
  );
  // Latest row is POST-split ((259 + 254.26) / 2 = 256.63).
  assertAlmostEquals(r.current, 256.63, 1e-9, "current price post-split");
  // With the split reconciled on both sides the figure collapses to the
  // correct ~+74% the issue anchors on.
  assertAlmostEquals(r.ret, 74.0, 0.1, "return is the correct ~+74%");
});

Deno.test("Clean control - no split, no distortion, modest return", () => {
  const data = loadFixture("control_clean_no_split.csv");
  const r = priceReturn(data, SCORE_DATE);

  assertEquals(r.factor, 1.0, "no split -> factor is exactly 1.0");
  assertAlmostEquals(r.buyPrice, 100.0, 1e-9, "buy price is the raw midpoint");
  assertAlmostEquals(
    r.current,
    115.0,
    1e-9,
    "current price is the raw midpoint",
  );
  assertAlmostEquals(r.ret, 15.0, 1e-9, "return is a plausible +15%");
});

Deno.test("Duplicate split coefficient is de-duplicated, not compounded (#292)", () => {
  // Take the reconciled fixture and inject a DUPLICATE of the 2026-06-12 10:1
  // split row, modelling the same split event recorded twice. BEFORE #292 this
  // compounded the factor to 100 (buy price over-divided to 14.745). AFTER #292
  // computeSplitAdjustment treats two split rows within five days as one event,
  // so the factor stays 10 and the buy price is the correct 147.45.
  const data = loadFixture("klac_split_reconciled.csv");
  const splitRow = data.find((p) => p.splitCoefficient === 10.0);
  assertExists(splitRow, "fixture should contain the 10:1 split row");
  data.push({ ...splitRow! });

  const split = GRQProjection.computeSplitAdjustment(data, SCORE_DATE);
  assertEquals(
    split.factor,
    10,
    "duplicate row de-duplicated to a factor of 10",
  );
  assertEquals(split.reliable, true, "de-duplicated series reconciles cleanly");

  const factor = GRQProjection.getSplitAdjustment(data, SCORE_DATE);
  assertEquals(factor, 10, "applied factor is the de-duplicated 10, not 100");

  const buy = GRQProjection.getBuyPrice(data, SCORE_DATE);
  assertExists(buy);
  assertAlmostEquals(
    buy!.price,
    147.45,
    1e-9,
    "buy price correctly split-adjusted to 147.45",
  );
});
