// Tests for the issue #554 buy-price denominator (midpoint vs close) diagnostic.
//
// These exercise the REAL shipped kernels (docs/projection.js) and the real
// aggregation in scripts/buy_price_denominator_diagnostic.ts with synthetic
// market data, asserting on computed results — not source text.

import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import "../docs/projection.js";
import "../docs/trend_predictions.js";
import {
  aggregateDate,
  buildReport,
  type DateAggregate,
  summariseOffsets,
} from "../scripts/buy_price_denominator_diagnostic.ts";

// deno-lint-ignore no-explicit-any
const P = (globalThis as any).GRQProjection;

function midnight(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

Deno.test("buyPriceCloseBasis returns the split-adjusted close of the first usable point", () => {
  const scoreDate = midnight("2026-01-01");
  const market = [
    {
      date: midnight("2026-01-02"),
      high: 12,
      low: 8,
      open: 9,
      close: 11,
      splitCoefficient: 1,
    },
  ];
  const obj = P.buyPriceCloseBasis(market, scoreDate);
  // No split -> adjusted close == raw close 11.
  assertEquals(obj.price, 11);
  assertEquals(obj.reliable, true);
});

Deno.test("buyPriceCloseBasis picks the SAME first point as getBuyPrice (close vs midpoint)", () => {
  const scoreDate = midnight("2026-01-01");
  const market = [
    {
      date: midnight("2026-01-03"), // 2 days forward — both must use this row
      high: 20,
      low: 10,
      open: 12,
      close: 18,
      splitCoefficient: 1,
    },
  ];
  const close = P.buyPriceCloseBasis(market, scoreDate);
  const buy = P.getBuyPrice(market, scoreDate);
  assertEquals(close.price, 18); // close
  assertEquals(buy.price, (20 + 10) / 2); // midpoint = 15
  assertEquals(close.dateUsed.getTime(), buy.dateUsed.getTime());
});

Deno.test("buyPriceCloseBasis returns null with no usable data", () => {
  assertEquals(P.buyPriceCloseBasis([], midnight("2026-01-01")), null);
  assertEquals(P.buyPriceCloseBasis(null, midnight("2026-01-01")), null);
});

Deno.test("denominatorBasisOffsetPercent computes (buyPrice - close) / buyPrice * 100", () => {
  // buyPrice 100, close 95 -> +5 pp (midpoint above close)
  assertAlmostEquals(P.denominatorBasisOffsetPercent(100, 95), 5);
  // close above midpoint -> negative offset
  assertAlmostEquals(P.denominatorBasisOffsetPercent(100, 105), -5);
  // equal -> zero
  assertEquals(P.denominatorBasisOffsetPercent(100, 100), 0);
});

Deno.test("denominatorBasisOffsetPercent guards bad inputs", () => {
  assertEquals(P.denominatorBasisOffsetPercent(0, 9), null);
  assertEquals(P.denominatorBasisOffsetPercent(-5, 9), null);
  assertEquals(P.denominatorBasisOffsetPercent(100, 0), null);
  assertEquals(P.denominatorBasisOffsetPercent(100, NaN), null);
  assertEquals(P.denominatorBasisOffsetPercent(null, 9), null);
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

Deno.test("aggregateDate measures the per-row midpoint-vs-close denominator offset", () => {
  const scoreDate = midnight("2026-01-01");
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
        high: 110, // midpoint = 100
        low: 90,
        open: 95,
        close: 95, // trained close basis
        splitCoefficient: 1,
      },
      {
        date: midnight("2026-03-30"),
        high: 120,
        low: 100, // midpoint = 110 -> Actual numerator
        open: 110,
        close: 115,
        splitCoefficient: 1,
      },
    ],
  };
  const agg = aggregateDate("2026-01-01", scoreRows, marketData, {}, scoreDate);
  // buyPrice = mid of first day = 100; close = 95.
  // offset = (100 - 95) / 100 * 100 = 5 pp.
  assertEquals(agg.rowOffsetsPp.length, 1);
  assertAlmostEquals(agg.rowOffsetsPp[0], 5, 1e-9);
  // Actual numerator = horizon mid 110. On mid basis: (110-100)/100 = +10%.
  // On close basis: (110-95)/95 = +15.789%.
  assert(agg.actualMidPct !== null && agg.actualClosePct !== null);
  assertAlmostEquals(agg.actualMidPct as number, 10, 1e-9);
  assertAlmostEquals(
    agg.actualClosePct as number,
    ((110 - 95) / 95) * 100,
    1e-9,
  );
  // Target adjustedTarget = 130. mid: (130-100)/100 = 30%; close: (130-95)/95.
  assertAlmostEquals(agg.targetMidPct as number, 30, 1e-9);
  assertAlmostEquals(
    agg.targetClosePct as number,
    ((130 - 95) / 95) * 100,
    1e-9,
  );
});

Deno.test("aggregateDate: a smaller denominator inflates BOTH Target and Actual together", () => {
  // When close < buyPrice, dividing by the smaller close lifts both the Target
  // and the Actual percentages — confirming the denominator does NOT
  // desynchronise the two (it rescales both).
  const scoreDate = midnight("2026-01-01");
  const scoreRows = [{
    stock: "Y",
    target: 150,
    score: 0.5,
    dividendPerShare: 0,
  }];
  const marketData = {
    Y: [
      {
        date: midnight("2026-01-02"),
        high: 110,
        low: 90, // mid = 100
        open: 95,
        close: 80, // close well below midpoint
        splitCoefficient: 1,
      },
      {
        date: midnight("2026-03-30"),
        high: 130,
        low: 110, // mid = 120
        open: 120,
        close: 125,
        splitCoefficient: 1,
      },
    ],
  };
  const agg = aggregateDate("2026-01-01", scoreRows, marketData, {}, scoreDate);
  assert((agg.targetClosePct as number) > (agg.targetMidPct as number));
  assert((agg.actualClosePct as number) > (agg.actualMidPct as number));
});

Deno.test("buildReport: rescales the gap and verdict states no desync", () => {
  const aggregates: DateAggregate[] = [
    {
      date: "2026-01-01",
      targetMidPct: 25,
      actualMidPct: 10,
      targetClosePct: 27,
      actualClosePct: 11,
      rowOffsetsPp: [3, 5],
    },
    {
      date: "2026-02-01",
      targetMidPct: 15,
      actualMidPct: 8,
      targetClosePct: 16,
      actualClosePct: 8.5,
      rowOffsetsPp: [1, 3],
    },
  ];
  const r = buildReport(aggregates);
  assertEquals(r.maturedDates, 2);
  assertEquals(r.rowCount, 4);
  assertAlmostEquals(r.meanOffsetPp, 3); // (3+5+1+3)/4
  // mean Target(mid) 20, Actual(mid) 9 -> observed gap 11.
  assertAlmostEquals(r.observedGapPp, 11);
  // mean Target(close) 21.5, Actual(close) 9.75 -> gap 11.75.
  assertAlmostEquals(r.gapOnCloseBasisPp, 11.75);
  assertAlmostEquals(r.basisContributionPp, 0.75); // 11.75 - 11
  assert(
    r.verdict.includes("does NOT desynchronise"),
    "verdict states Target/Actual share the denominator",
  );
});

Deno.test("buildReport: negative mean offset reported with sign", () => {
  const aggregates: DateAggregate[] = [
    {
      date: "2026-01-01",
      targetMidPct: 20,
      actualMidPct: 10,
      targetClosePct: 18,
      actualClosePct: 9,
      rowOffsetsPp: [-2, -4],
    },
  ];
  const r = buildReport(aggregates);
  assert(r.meanOffsetPp < 0);
  assert(r.verdict.includes("-"), "negative mean sign rendered");
});
