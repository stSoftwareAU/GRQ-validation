// Tests for the issue #555 market-data timing & corporate-action parity
// diagnostic.
//
// These exercise the REAL shipped kernels (docs/projection.js,
// docs/trend_predictions.js) and the real aggregation in
// scripts/horizon_split_parity_diagnostic.ts with synthetic market data,
// asserting on computed results — not source text.

import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import "../docs/projection.js";
import "../docs/trend_predictions.js";
import {
  aggregateDate,
  buildReport,
  type DateAggregate,
  summariseOffsets,
} from "../scripts/horizon_split_parity_diagnostic.ts";

// deno-lint-ignore no-explicit-any
const P = (globalThis as any).GRQProjection;

function midnight(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// A flat OHLC point with an optional split coefficient (mid = price).
function pt(date: string, price: number, splitCoefficient = 1.0) {
  return {
    date: midnight(date),
    high: price,
    low: price,
    open: price,
    close: price,
    splitCoefficient,
  };
}

// Score 2026-01-01 -> horizon 2026-04-01. A clean 2:1 forward split on 05-15
// (after the horizon): mid halves 120 -> 60, so the price-ratio cross-check
// reconciles (120 / 60 == 2).
function marketWithPostHorizonSplit() {
  return [
    pt("2026-01-02", 100), // buy point
    pt("2026-03-30", 120), // horizon point (last <= 2026-04-01)
    pt("2026-05-15", 60, 2.0), // post-horizon 2:1 forward split
  ];
}

const SCORE = midnight("2026-01-01");

Deno.test("horizonPointDate returns the DATE of the last point on/before the horizon", () => {
  const date = P.horizonPointDate(marketWithPostHorizonSplit(), SCORE);
  assertEquals(date.getTime(), midnight("2026-03-30").getTime());
});

Deno.test("horizonPointDate returns null when no point falls on/before the horizon", () => {
  assertEquals(P.horizonPointDate([], SCORE), null);
  assertEquals(P.horizonPointDate(null, SCORE), null);
  // Only points AFTER the horizon -> null.
  assertEquals(P.horizonPointDate([pt("2026-09-01", 10)], SCORE), null);
});

Deno.test("postHorizonSplitFactor is 1.0 when there is no post-horizon split", () => {
  const market = [pt("2026-01-02", 100), pt("2026-03-30", 120)];
  assertEquals(P.postHorizonSplitFactor(market, SCORE), 1.0);
});

Deno.test("postHorizonSplitFactor captures a reconcilable forward split after the horizon", () => {
  assertAlmostEquals(
    P.postHorizonSplitFactor(marketWithPostHorizonSplit(), SCORE),
    2.0,
  );
});

Deno.test("postHorizonSplitFactor ignores a split ON/BEFORE the horizon (already in the raw price)", () => {
  // Split lands on the horizon row itself -> not strictly after it.
  const market = [pt("2026-01-02", 100), pt("2026-03-30", 60, 2.0)];
  assertEquals(P.postHorizonSplitFactor(market, SCORE), 1.0);
});

Deno.test("postHorizonSplitFactor handles a reverse split (factor < 1)", () => {
  // 1:2 reverse split on 05-15: mid doubles 120 -> 240, ratio 120/240 = 0.5.
  const market = [
    pt("2026-01-02", 100),
    pt("2026-03-30", 120),
    pt("2026-05-15", 240, 0.5),
  ];
  assertAlmostEquals(P.postHorizonSplitFactor(market, SCORE), 0.5);
});

Deno.test("horizonPriceCurrentBasis = raw horizon mid / post-horizon split factor", () => {
  // raw mid 120, factor 2.0 -> 60 (the buy-price's current basis).
  assertAlmostEquals(
    P.horizonPriceCurrentBasis(marketWithPostHorizonSplit(), SCORE),
    60,
  );
});

Deno.test("horizonPriceCurrentBasis equals the raw horizon mid when no split follows", () => {
  const market = [pt("2026-01-02", 100), pt("2026-03-30", 120)];
  assertEquals(
    P.horizonPriceCurrentBasis(market, SCORE),
    P.priceAtNinetyDayHorizon(market, SCORE),
  );
});

Deno.test("horizonPriceCurrentBasis returns null with no usable horizon point", () => {
  assertEquals(P.horizonPriceCurrentBasis([], SCORE), null);
});

Deno.test("horizonAsOfBasisOffsetPercent computes (raw - currentBasis) / buyPrice * 100", () => {
  // buyPrice 50, raw 120, currentBasis 60 -> (120-60)/50*100 = 120 pp.
  assertAlmostEquals(P.horizonAsOfBasisOffsetPercent(50, 120, 60), 120);
  // No post-horizon split: raw == currentBasis -> zero offset.
  assertEquals(P.horizonAsOfBasisOffsetPercent(50, 120, 120), 0);
});

Deno.test("horizonAsOfBasisOffsetPercent is positive for forward, negative for reverse splits", () => {
  // Forward: currentBasis < raw -> positive (Actual inflated, masks the gap).
  assert(P.horizonAsOfBasisOffsetPercent(50, 120, 60) > 0);
  // Reverse: currentBasis > raw -> negative (Actual deflated, widens the gap).
  assert(P.horizonAsOfBasisOffsetPercent(100, 120, 240) < 0);
});

Deno.test("horizonAsOfBasisOffsetPercent guards bad inputs", () => {
  assertEquals(P.horizonAsOfBasisOffsetPercent(0, 120, 60), null);
  assertEquals(P.horizonAsOfBasisOffsetPercent(-5, 120, 60), null);
  assertEquals(P.horizonAsOfBasisOffsetPercent(50, null, 60), null);
  assertEquals(P.horizonAsOfBasisOffsetPercent(50, 120, NaN), null);
});

Deno.test("aggregateDate: a post-horizon split desynchronises Actual but not Target", () => {
  const scoreRows = [{ stock: "AAA", target: 130 }];
  const marketData = { AAA: marketWithPostHorizonSplit() };
  const agg = aggregateDate("2026-01-01", scoreRows, marketData, {}, SCORE);

  // One included row carrying a reconcilable post-horizon split.
  assertEquals(agg.includedRows, 1);
  assertEquals(agg.splitAffectedRows, 1);
  assertEquals(agg.rowOffsetsPp.length, 1);
  // buyPrice = 100/2 = 50; raw horizon 120; currentBasis 60 -> 120 pp.
  assertAlmostEquals(agg.rowOffsetsPp[0], 120);

  // The shipped (raw) Actual sits far above the split-consistent Actual.
  assert(
    (agg.actualRawPct as number) > (agg.actualCurrentBasisPct as number),
  );
  // Target % is invariant to the post-horizon split (same factor cancels).
  assert(agg.targetPct !== null);
});

Deno.test("aggregateDate: no post-horizon split -> the two Actual bases coincide", () => {
  const scoreRows = [{ stock: "AAA", target: 130 }];
  const marketData = {
    AAA: [pt("2026-01-02", 100), pt("2026-03-30", 120)],
  };
  const agg = aggregateDate("2026-01-01", scoreRows, marketData, {}, SCORE);
  assertEquals(agg.splitAffectedRows, 0);
  assertAlmostEquals(agg.rowOffsetsPp[0], 0);
  assertAlmostEquals(
    agg.actualRawPct as number,
    agg.actualCurrentBasisPct as number,
  );
});

Deno.test("buildReport: forward-split contribution WIDENS the gap on the consistent basis", () => {
  const aggregates: DateAggregate[] = [
    {
      date: "2026-01-01",
      targetPct: 30,
      actualRawPct: 25, // inflated by the post-horizon forward split
      actualCurrentBasisPct: 10, // split-consistent
      rowOffsetsPp: [15],
      splitAffectedRows: 1,
      includedRows: 1,
    },
  ];
  const report = buildReport(aggregates);
  assertEquals(report.splitAffectedRows, 1);
  assertAlmostEquals(report.observedGapPp, 5); // 30 - 25
  assertAlmostEquals(report.gapOnCurrentBasisPp, 20); // 30 - 10
  assertAlmostEquals(report.basisContributionPp, 15); // masking term
  assert(report.verdict.includes("ALIGNED"));
});

Deno.test("buildReport: zero affected rows -> DORMANT verdict and 0 pp contribution", () => {
  const aggregates: DateAggregate[] = [
    {
      date: "2026-01-01",
      targetPct: 30,
      actualRawPct: 12,
      actualCurrentBasisPct: 12,
      rowOffsetsPp: [0, 0],
      splitAffectedRows: 0,
      includedRows: 2,
    },
  ];
  const report = buildReport(aggregates);
  assertEquals(report.splitAffectedRows, 0);
  assertAlmostEquals(report.basisContributionPp, 0);
  assert(report.verdict.includes("DORMANT"));
});

Deno.test("summariseOffsets over a known list", () => {
  const s = summariseOffsets([0, 10, 20]);
  assertEquals(s.count, 3);
  assertAlmostEquals(s.mean, 10);
  assertAlmostEquals(s.median, 10);
  assertEquals(s.min, 0);
  assertEquals(s.max, 20);
});

Deno.test("summariseOffsets on empty input is all-zero", () => {
  assertEquals(summariseOffsets([]), {
    count: 0,
    mean: 0,
    median: 0,
    min: 0,
    max: 0,
    stdDev: 0,
  });
});
