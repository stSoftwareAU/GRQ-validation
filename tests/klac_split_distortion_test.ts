// KLAC split-distortion reproduction (issue #291, parent #272).
//
// This is the investigation/spike's deterministic, regression-ready proof. It
// loads the FROZEN fixtures under tests/fixtures/ and runs the REAL shared
// kernels in docs/projection.js (getBuyPrice, getSplitAdjustment,
// currentPriceFromLatest, calculatePerformanceReturn) — the same code the
// dashboard's GRQValidator uses — to pin the root cause with exact numbers:
//
//   * getSplitAdjustment multiplies EVERY split_coefficient > 1.0 recorded after
//     the buy date with no de-duplication, no plausibility bound, and no
//     reconciliation against the observed buy/current price ratio.
//   * A split applied to the historical buy price while the latest price has NOT
//     been correspondingly split-adjusted over-divides the buy price and inflates
//     the % return (klac_split_distorted.csv -> ~+1302.5%).
//   * Once the same 10:1 split reconciles on BOTH sides the figure collapses to
//     the correct ~+74% (klac_split_reconciled.csv).
//   * A duplicate split row (the literal no-de-dup defect) compounds the factor
//     to 100 and inflates the figure even further (~+1640%).
//
// No production code changes are made in this issue; the follow-up projection.js
// helper and backend guard sub-issues of #272 consume these fixtures + the
// thresholds documented in docs/fixes/klac-split-distortion-investigation.md.
import { assertAlmostEquals, assertEquals, assertExists } from "@std/assert";
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
    ) => { price: number; dateUsed: Date } | null;
    getSplitAdjustment: (
      marketData: MarketDataPoint[] | undefined,
      historicalDate: Date,
    ) => number;
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

Deno.test("KLAC split distortion - inflated return reproduced from fixture", () => {
  const data = loadFixture("klac_split_distorted.csv");
  const r = priceReturn(data, SCORE_DATE);

  // Single 10:1 coefficient recorded after the buy date.
  assertEquals(r.factor, 10, "cumulative split factor is 10");
  // Raw buy midpoint (1495 + 1454) / 2 = 1474.50, divided by the 10:1 factor.
  assertAlmostEquals(
    r.buyPrice,
    147.45,
    1e-9,
    "buy price over-divided to 147.45",
  );
  // Latest row is still PRE-split ((2095 + 2041) / 2 = 2068.00): the defect.
  assertAlmostEquals(r.current, 2068.0, 1e-9, "current price still pre-split");
  // The over-division inflates the return to the reported ~1302.5%.
  assertAlmostEquals(r.ret, 1302.5, 0.05, "return inflated to ~+1302.5%");
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

Deno.test("Duplicate split coefficient compounds the factor (no de-dup defect)", () => {
  // Take the reconciled fixture and inject a DUPLICATE of the 2026-06-12 10:1
  // split row, modelling the same split event recorded twice. getSplitAdjustment
  // multiplies both, so the factor jumps 10 -> 100 with no de-duplication.
  const data = loadFixture("klac_split_reconciled.csv");
  const splitRow = data.find((p) => p.splitCoefficient === 10.0);
  assertExists(splitRow, "fixture should contain the 10:1 split row");
  data.push({ ...splitRow! });

  const factor = GRQProjection.getSplitAdjustment(data, SCORE_DATE);
  assertEquals(factor, 100, "duplicate split compounds the factor to 100");

  const buy = GRQProjection.getBuyPrice(data, SCORE_DATE);
  assertExists(buy);
  assertAlmostEquals(
    buy!.price,
    14.745,
    1e-9,
    "buy price over-divided to 14.745",
  );
});
