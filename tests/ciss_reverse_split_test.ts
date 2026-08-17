// CISS reverse-split regression (issue #828).
//
// NASDAQ:CISS (C3is Inc) showed a ~-99% return on the 2026-02-18 score page and
// the reported loss was questioned as a possible reverse-split artefact.
// Verification against the committed market data showed the loss is GENUINE:
// the single 1-for-7 reverse split on 2026-04-27 is applied correctly, and the
// post-split price still collapsed to ~$0.079 by 2026-08-14.
//
// This locks BOTH sides of the designed #292/#293 behaviour in against frozen
// extracts of the real market data (tests/fixtures/ciss_reverse_split_*.csv),
// running the REAL shared kernels in docs/projection.js:
//   - 2026-02-18: one 1-for-7 reverse split passes every plausibility check, so
//     the series is reliable, the buy price is restated onto the post-split
//     basis, and CISS is counted normally with its real ~-99.3% loss.
//   - 2026-01-23: an additional 1-for-20 reverse split (2026-01-26) exceeds the
//     10:1 single-event cap and drives the cumulative factor below the 1/50
//     floor, so the series is flagged unreliable, no factor is applied, and CISS
//     is excluded from the stats (struck through).
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
    ) => { factor: number; reliable: boolean };
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

const ONE_FOR_SEVEN = 1 / 7; // 2026-04-27 reverse split coefficient

Deno.test("CISS 2026-02-18 - single 1-for-7 reverse split is reliable and applied", () => {
  const data = loadFixture("ciss_reverse_split_feb18.csv");
  const scoreDate = new Date(2026, 1, 18); // 2026-02-18, local midnight

  const split = GRQProjection.computeSplitAdjustment(data, scoreDate);
  assertAlmostEquals(
    split.factor,
    ONE_FOR_SEVEN,
    1e-9,
    "one 1-for-7 reverse split after the score date",
  );
  assertEquals(
    split.reliable,
    true,
    "magnitude 7 is within the 10:1 cap, the price ratio reconciles, and 0.1429 clears the 1/50 floor",
  );
  assertAlmostEquals(
    GRQProjection.getSplitAdjustment(data, scoreDate),
    ONE_FOR_SEVEN,
    1e-9,
    "reliable factor is applied, not suppressed to 1.0",
  );
});

Deno.test("CISS 2026-02-18 - reported ~-99% loss is genuine, not a split artefact", () => {
  const data = loadFixture("ciss_reverse_split_feb18.csv");
  const scoreDate = new Date(2026, 1, 18);

  const buy = GRQProjection.getBuyPrice(data, scoreDate);
  assertExists(buy, "buy price resolves from the score-date row");
  assertEquals(buy!.reliable, true, "buy price carries the reliable flag");
  // Raw midpoint (1.7199 + 1.46) / 2 = 1.58995, restated onto the post-split
  // basis by dividing by 1/7 -> 11.12965.
  assertAlmostEquals(
    buy!.price,
    11.12965,
    1e-6,
    "buy price restated onto the post-split basis",
  );

  const current = GRQProjection.currentPriceFromLatest(data);
  assertExists(current, "current price resolves from the latest row");
  // Latest row 2026-08-14: (0.0795 + 0.0746) / 2 = 0.07705, already post-split.
  assertAlmostEquals(current!, 0.07705, 1e-9, "current price is post-split");

  const ret = GRQProjection.calculatePerformanceReturn(buy!.price, current!, 0);
  assertExists(ret, "return is computable");
  assertAlmostEquals(
    ret!,
    -99.31,
    0.01,
    "the ~-99.3% loss is real: both sides are on the same post-split basis",
  );

  // Counted normally in every aggregate — the loss is genuine, so CISS is NOT
  // struck through on this score date.
  assertEquals(
    GRQProjection.isStockIncluded(buy!.price, current!, buy!.reliable),
    true,
    "reliable series is included in the stats",
  );
});

Deno.test("CISS 2026-01-23 - implausible 1-for-20 split flags the series unreliable", () => {
  const data = loadFixture("ciss_reverse_split_jan23.csv");
  const scoreDate = new Date(2026, 0, 23); // 2026-01-23, local midnight

  const split = GRQProjection.computeSplitAdjustment(data, scoreDate);
  // Two reverse splits fall after this score date: 1-for-20 (2026-01-26) and
  // 1-for-7 (2026-04-27) -> cumulative 0.05 * 1/7 = 0.007142...
  assertAlmostEquals(
    split.factor,
    0.05 * ONE_FOR_SEVEN,
    1e-9,
    "diagnostic cumulative factor is still surfaced",
  );
  assert(
    split.factor < 1 / 50,
    "cumulative factor breaches the 1/50 reverse-split floor",
  );
  assertEquals(
    split.reliable,
    false,
    "magnitude 20 exceeds the 10:1 cap, so the series cannot be trusted",
  );
  assertEquals(
    GRQProjection.getSplitAdjustment(data, scoreDate),
    1.0,
    "unreliable factor suppressed to 1.0 — no over-division",
  );
});

Deno.test("CISS 2026-01-23 - unreliable series is excluded from the stats", () => {
  const data = loadFixture("ciss_reverse_split_jan23.csv");
  const scoreDate = new Date(2026, 0, 23);

  const buy = GRQProjection.getBuyPrice(data, scoreDate);
  assertExists(buy, "buy price resolves from the score-date row");
  assertEquals(buy!.reliable, false, "buy price carries the unreliable flag");
  // Raw midpoint (0.0935 + 0.0822) / 2 = 0.08785 — unadjusted, because the
  // suspect factor is not applied.
  assertAlmostEquals(
    buy!.price,
    0.08785,
    1e-9,
    "buy price is the raw midpoint, not divided by the suspect factor",
  );

  const current = GRQProjection.currentPriceFromLatest(data);
  assertExists(current, "current price resolves from the latest row");

  assertEquals(
    GRQProjection.isStockIncluded(buy!.price, current!, buy!.reliable),
    false,
    "unreliable series is struck through and excluded from every aggregate",
  );
});
