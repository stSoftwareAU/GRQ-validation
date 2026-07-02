// Tests for the issue #692 shared diagnostic row interfaces.
//
// These construct STRONGLY TYPED inputs (ScoreRow[], Record<string,
// MarketPoint[]>, ResolvedStock, ...) with NO `as any` casts and pass them to
// the exported diagnostic signatures, asserting on the computed results. If the
// exported signatures still used `any` the interfaces would be redundant; if
// they used an incompatible shape `deno check` would fail. Together they pin the
// module-boundary typing while exercising the real shipped kernels.

import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import "../docs/projection.js";
import "../docs/trend_predictions.js";

import type {
  DividendPoint,
  MarketPoint,
  ResolvedStock,
  ScoreRow,
} from "../scripts/diagnostic_types.ts";

import {
  aggregateDate as residualAggregate,
  hasUsableTarget,
} from "../scripts/residual_gap_reconciliation.ts";
import { aggregateDate as priceBasisAggregate } from "../scripts/price_basis_diagnostic.ts";
import { aggregateDate as buyPriceAggregate } from "../scripts/buy_price_denominator_diagnostic.ts";
import { aggregateDate as horizonAggregate } from "../scripts/horizon_split_parity_diagnostic.ts";
import { aggregateDate as dividendAggregate } from "../scripts/dividend_basis_diagnostic.ts";

function midnight(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// Build a typed one-day score set: a target-bearing winner (AAA, +20% actual,
// +50% target) and a target-less loser (BBB, -20% actual). No splits.
function typedDate(): {
  scoreDate: Date;
  scoreRows: ScoreRow[];
  marketData: Record<string, MarketPoint[]>;
  dividendData: Record<string, DividendPoint[]>;
} {
  const scoreDate = midnight("2026-01-01");
  const row = (stock: string, target: number): ScoreRow => ({
    stock,
    score: 0.5,
    target,
    exDividendDate: null,
    dividendPerShare: 0,
    notes: "",
    intrinsicValuePerShareBasic: null,
    intrinsicValuePerShareAdjusted: null,
  });
  const point = (
    date: string,
    high: number,
    low: number,
    close: number,
  ): MarketPoint => ({
    date: midnight(date),
    high,
    low,
    open: close,
    close,
    splitCoefficient: 1,
    volume: null,
  });
  const scoreRows: ScoreRow[] = [row("AAA", 150), row("BBB", NaN)];
  const marketData: Record<string, MarketPoint[]> = {
    AAA: [
      point("2026-01-02", 110, 90, 100), // mid 100 buy
      point("2026-03-30", 130, 110, 120), // mid 120 actual +20%
    ],
    BBB: [
      point("2026-01-02", 110, 90, 100),
      point("2026-03-30", 90, 70, 80), // mid 80 actual -20%
    ],
  };
  const dividendData: Record<string, DividendPoint[]> = {};
  return { scoreDate, scoreRows, marketData, dividendData };
}

// --- hasUsableTarget accepts a typed ResolvedStock ---------------------------

Deno.test("hasUsableTarget accepts a typed ResolvedStock", () => {
  const included: ResolvedStock = {
    stock: "AAA",
    buyPrice: 100,
    currentPrice: 120,
    totalDividends: 0,
    adjustedTarget: 150,
    splitReliable: true,
    lowVolume: false,
    avgStars: null,
  };
  assert(hasUsableTarget(included));
  assert(!hasUsableTarget({ ...included, adjustedTarget: null }));
  assert(!hasUsableTarget({ ...included, buyPrice: 0 }));
});

// --- each exported aggregateDate accepts the typed row shapes ----------------

Deno.test("residual aggregateDate accepts typed rows and counts included/target rows", () => {
  const { scoreDate, scoreRows, marketData, dividendData } = typedDate();
  const agg = residualAggregate(
    "2026-01-01",
    scoreRows,
    marketData,
    dividendData,
    scoreDate,
  );
  assertEquals(agg.includedRows, 2);
  assertEquals(agg.targetRows, 1);
  assertAlmostEquals(agg.actualPct as number, 0, 1e-9);
  assertAlmostEquals(agg.matchedActualPct as number, 20, 1e-9);
});

Deno.test("price-basis aggregateDate accepts typed rows", () => {
  const { scoreDate, scoreRows, marketData, dividendData } = typedDate();
  const agg = priceBasisAggregate(
    "2026-01-01",
    scoreRows,
    marketData,
    dividendData,
    scoreDate,
  );
  assertAlmostEquals(agg.actualMidPct as number, 0, 1e-9);
});

Deno.test("buy-price aggregateDate accepts typed rows", () => {
  const { scoreDate, scoreRows, marketData, dividendData } = typedDate();
  const agg = buyPriceAggregate(
    "2026-01-01",
    scoreRows,
    marketData,
    dividendData,
    scoreDate,
  );
  assertAlmostEquals(agg.actualMidPct as number, 0, 1e-9);
});

Deno.test("horizon-split aggregateDate accepts typed rows", () => {
  const { scoreDate, scoreRows, marketData, dividendData } = typedDate();
  const agg = horizonAggregate(
    "2026-01-01",
    scoreRows,
    marketData,
    dividendData,
    scoreDate,
  );
  assertAlmostEquals(agg.actualRawPct as number, 0, 1e-9);
  assertEquals(agg.includedRows, 2);
});

Deno.test("dividend-basis aggregateDate accepts typed rows and full-history map", () => {
  const { scoreDate, scoreRows, marketData, dividendData } = typedDate();
  const fullHistory: Record<string, DividendPoint[]> = {};
  const agg = dividendAggregate(
    "2026-01-01",
    scoreRows,
    marketData,
    dividendData,
    fullHistory,
    scoreDate,
  );
  assertEquals(agg.includedCount, 2);
});
