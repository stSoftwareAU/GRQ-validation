// Tests for the issue #552 price-basis (mid vs low) diagnostic.
//
// These exercise the REAL shipped kernels (docs/projection.js) and the real
// aggregation in scripts/price_basis_diagnostic.ts with synthetic market data,
// asserting on computed results — not source text.

import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import "../docs/projection.js";
import "../docs/trend_predictions.js";
import {
  aggregateDate,
  buildReport,
  type DateAggregate,
  summariseOffsets,
} from "../scripts/price_basis_diagnostic.ts";

// deno-lint-ignore no-explicit-any
const P = (globalThis as any).GRQProjection;

function midnight(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

Deno.test("lowPriceAtNinetyDayHorizon returns the low of the last in-window point", () => {
  const scoreDate = midnight("2026-01-01");
  const market = [
    { date: midnight("2026-01-02"), high: 10, low: 9 },
    { date: midnight("2026-03-30"), high: 12, low: 11 }, // within 90 days
    { date: midnight("2026-05-30"), high: 20, low: 19 }, // beyond horizon
  ];
  assertEquals(P.lowPriceAtNinetyDayHorizon(market, scoreDate), 11);
});

Deno.test("lowPriceAtNinetyDayHorizon picks the SAME row as priceAtNinetyDayHorizon", () => {
  const scoreDate = midnight("2026-01-01");
  const market = [
    { date: midnight("2026-02-01"), high: 12, low: 8 },
    { date: midnight("2026-03-15"), high: 16, low: 10 },
  ];
  const low = P.lowPriceAtNinetyDayHorizon(market, scoreDate);
  const mid = P.priceAtNinetyDayHorizon(market, scoreDate);
  assertEquals(low, 10);
  assertEquals(mid, (16 + 10) / 2);
});

Deno.test("lowPriceAtNinetyDayHorizon returns null with no usable data", () => {
  assertEquals(P.lowPriceAtNinetyDayHorizon([], midnight("2026-01-01")), null);
  assertEquals(
    P.lowPriceAtNinetyDayHorizon(null, midnight("2026-01-01")),
    null,
  );
});

Deno.test("priceBasisOffsetPercent computes (mid - low) / buyPrice * 100", () => {
  // buyPrice 100, mid 110, low 105 -> 5%
  assertAlmostEquals(P.priceBasisOffsetPercent(100, 110, 105), 5);
  // mid == low -> zero offset (the only-in-aggregate, same-direction case)
  assertEquals(P.priceBasisOffsetPercent(100, 110, 110), 0);
});

Deno.test("priceBasisOffsetPercent is always >= 0 when mid >= low", () => {
  for (
    const [buy, mid, low] of [[50, 60, 55], [10, 10.1, 9.9], [200, 200, 200]]
  ) {
    const offset = P.priceBasisOffsetPercent(buy, mid, low);
    assert(offset !== null && offset >= 0, `offset ${offset} should be >= 0`);
  }
});

Deno.test("priceBasisOffsetPercent guards bad inputs", () => {
  assertEquals(P.priceBasisOffsetPercent(0, 10, 9), null);
  assertEquals(P.priceBasisOffsetPercent(-5, 10, 9), null);
  assertEquals(P.priceBasisOffsetPercent(100, null, 9), null);
  assertEquals(P.priceBasisOffsetPercent(100, 10, NaN), null);
});

Deno.test("summariseOffsets computes mean/median/min/max/stdDev", () => {
  const s = summariseOffsets([1, 2, 3, 4]);
  assertEquals(s.count, 4);
  assertAlmostEquals(s.mean, 2.5);
  assertAlmostEquals(s.median, 2.5);
  assertEquals(s.min, 1);
  assertEquals(s.max, 4);
  assertAlmostEquals(s.stdDev, Math.sqrt(1.25));
});

Deno.test("summariseOffsets handles empty input", () => {
  const s = summariseOffsets([]);
  assertEquals(s, { count: 0, mean: 0, median: 0, min: 0, max: 0, stdDev: 0 });
});

Deno.test("aggregateDate measures the per-row mid-vs-low offset over included stocks", () => {
  const scoreDate = midnight("2026-01-01");
  // One stock: buy near 100 (mid of first day), horizon mid 110, low 100.
  const scoreRows = [{
    stock: "X",
    target: 130,
    score: 0.5,
    dividendPerShare: 0,
  }];
  const marketData = {
    X: [
      {
        date: midnight("2026-01-02"),
        high: 101,
        low: 99,
        open: 100,
        close: 100,
        splitCoefficient: 1,
      },
      {
        date: midnight("2026-03-30"),
        high: 120,
        low: 100,
        open: 110,
        close: 115,
        splitCoefficient: 1,
      },
    ],
  };
  const agg = aggregateDate("2026-01-01", scoreRows, marketData, {}, scoreDate);
  // buyPrice = mid of 2026-01-02 = 100; horizon mid = 110, low = 100.
  // offset = (110 - 100) / 100 * 100 = 10 pp.
  assertEquals(agg.rowOffsetsPp.length, 1);
  assertAlmostEquals(agg.rowOffsetsPp[0], 10, 1e-9);
  // Actual(mid) uses 110 -> +10%; Actual(low) uses 100 -> 0%. Difference 10 pp.
  assert(agg.actualMidPct !== null && agg.actualLowPct !== null);
  assertAlmostEquals(
    (agg.actualMidPct as number) - (agg.actualLowPct as number),
    10,
    1e-9,
  );
});

Deno.test("buildReport: basis contribution widens the gap and verdict states the sign", () => {
  const aggregates: DateAggregate[] = [
    {
      date: "2026-01-01",
      targetPct: 25,
      actualMidPct: 10,
      actualLowPct: 6,
      rowOffsetsPp: [3, 5],
    },
    {
      date: "2026-02-01",
      targetPct: 15,
      actualMidPct: 8,
      actualLowPct: 6,
      rowOffsetsPp: [1, 3],
    },
  ];
  const r = buildReport(aggregates);
  assertEquals(r.maturedDates, 2);
  assertEquals(r.rowCount, 4);
  assertAlmostEquals(r.meanOffsetPp, 3); // (3+5+1+3)/4
  // mean Target 20, mean Actual(mid) 9 -> observed gap 11; Actual(low) 6 -> 14.
  assertAlmostEquals(r.observedGapPp, 11);
  assertAlmostEquals(r.gapOnLowBasisPp, 14);
  assertAlmostEquals(r.basisContributionPp, 3); // 14 - 11
  assert(r.basisContributionPp > 0, "low basis should WIDEN the gap");
  assert(
    r.verdict.includes("NARROWS") && r.verdict.includes("WIDEN"),
    "verdict states the masking sign",
  );
});

Deno.test("buildReport: all offsets non-negative implies a non-negative mean", () => {
  const aggregates: DateAggregate[] = [
    {
      date: "2026-01-01",
      targetPct: 20,
      actualMidPct: 10,
      actualLowPct: 8,
      rowOffsetsPp: [0, 2, 4],
    },
  ];
  const r = buildReport(aggregates);
  assert(r.meanOffsetPp >= 0);
  assert(r.basisContributionPp >= 0);
});
