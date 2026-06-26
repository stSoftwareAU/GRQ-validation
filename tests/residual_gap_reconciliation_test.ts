// Tests for the issue #557 whole-application sweep + residual-gap reconciliation.
//
// These exercise the REAL shipped kernels (docs/projection.js,
// docs/trend_predictions.js) and the real aggregation/reconciliation in
// scripts/residual_gap_reconciliation.ts with synthetic data, asserting on
// computed results — not source text.

import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import "../docs/projection.js";
import "../docs/trend_predictions.js";
import {
  aggregateDate,
  buildReconciliation,
  computeResidualGapReconciliation,
  type DateAggregate,
  FAMILY_CONTRIBUTIONS,
  type GapContribution,
  hasUsableTarget,
} from "../scripts/residual_gap_reconciliation.ts";

function midnight(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// --- hasUsableTarget ---------------------------------------------------------

Deno.test("hasUsableTarget true only for included rows with a usable target", () => {
  assert(
    hasUsableTarget({
      buyPrice: 100,
      currentPrice: 120,
      splitReliable: true,
      adjustedTarget: 150,
    }),
  );
  // Included but no target -> dropped from the Target mean.
  assert(
    !hasUsableTarget({
      buyPrice: 100,
      currentPrice: 120,
      splitReliable: true,
      adjustedTarget: null,
    }),
  );
  assert(
    !hasUsableTarget({
      buyPrice: 100,
      currentPrice: 120,
      splitReliable: true,
      adjustedTarget: NaN,
    }),
  );
  // Not priceable -> excluded from both.
  assert(
    !hasUsableTarget({
      buyPrice: 0,
      currentPrice: 120,
      splitReliable: true,
      adjustedTarget: 150,
    }),
  );
});

// --- aggregateDate -----------------------------------------------------------

// Build a one-day score set with a target-bearing winner (AAA) and a
// target-less loser (BBB). No splits (coefficient 1.0), so prices are unadjusted.
function syntheticDate() {
  const scoreDate = midnight("2026-01-01");
  // TSV: stock, score, target, exDiv, dividendPerShare, notes, ivB, ivA
  const scoreRows = [
    { stock: "AAA", score: 0.5, target: 150 }, // buy 100 -> target +50%
    { stock: "BBB", score: 0.5, target: NaN }, // loser, missing target
  ];
  const marketData: Record<string, unknown[]> = {
    AAA: [
      { date: midnight("2026-01-02"), high: 110, low: 90, close: 100 }, // mid 100 buy
      { date: midnight("2026-03-30"), high: 130, low: 110, close: 120 }, // mid 120 actual +20%
    ],
    BBB: [
      { date: midnight("2026-01-02"), high: 110, low: 90, close: 100 }, // mid 100 buy
      { date: midnight("2026-03-30"), high: 90, low: 70, close: 80 }, // mid 80 actual -20%
    ],
  };
  return { scoreDate, scoreRows, marketData };
}

Deno.test("aggregateDate counts included vs target-present rows", () => {
  const { scoreDate, scoreRows, marketData } = syntheticDate();
  const agg = aggregateDate(
    "2026-01-01",
    // deno-lint-ignore no-explicit-any
    scoreRows as any,
    // deno-lint-ignore no-explicit-any
    marketData as any,
    {},
    scoreDate,
  );
  assertEquals(agg.includedRows, 2); // AAA + BBB both priceable
  assertEquals(agg.targetRows, 1); // only AAA carries a target
});

Deno.test("aggregateDate: as-shipped Actual spans more rows than matched Actual", () => {
  const { scoreDate, scoreRows, marketData } = syntheticDate();
  const agg = aggregateDate(
    "2026-01-01",
    // deno-lint-ignore no-explicit-any
    scoreRows as any,
    // deno-lint-ignore no-explicit-any
    marketData as any,
    {},
    scoreDate,
  );
  // As-shipped Actual = mean(+20, -20) = 0; matched Actual (AAA only) = +20.
  assertAlmostEquals(agg.actualPct as number, 0, 1e-9);
  assertAlmostEquals(agg.matchedActualPct as number, 20, 1e-9);
  // Target is over the target-present subset (AAA): +50%.
  assertAlmostEquals(agg.targetPct as number, 50, 1e-9);
});

// --- buildReconciliation -----------------------------------------------------

const ZERO_FAMILY: GapContribution[] = [];

Deno.test("buildReconciliation: target-availability = observed - matched gap", () => {
  const aggregates: DateAggregate[] = [{
    date: "2026-01-01",
    targetPct: 50,
    actualPct: 0,
    matchedActualPct: 20,
    includedRows: 2,
    targetRows: 1,
  }];
  const r = buildReconciliation(aggregates, ZERO_FAMILY);
  assertAlmostEquals(r.observedGapPp, 50, 1e-9); // 50 - 0
  assertAlmostEquals(r.matchedGapPp, 30, 1e-9); // 50 - 20
  assertAlmostEquals(r.targetAvailabilityPp, 20, 1e-9); // 50 - 30
  assertEquals(r.droppedTargetRows, 1);
});

Deno.test("buildReconciliation: residual + net == observed gap (round-trip)", () => {
  const aggregates: DateAggregate[] = [{
    date: "2026-01-01",
    targetPct: 30,
    actualPct: 10,
    matchedActualPct: 10, // no target-availability skew
    includedRows: 3,
    targetRows: 3,
  }];
  const family: GapContribution[] = [
    { key: "a", issue: 1, contributionPp: 2, note: "" },
    { key: "b", issue: 2, contributionPp: -1, note: "" },
  ];
  const r = buildReconciliation(aggregates, family);
  assertAlmostEquals(r.targetAvailabilityPp, 0, 1e-9);
  // net = 2 + (-1) + 0 (target-availability) = 1
  assertAlmostEquals(r.netMeasurementPp, 1, 1e-9);
  // residual = observed(20) - net(1) = 19
  assertAlmostEquals(r.residualOptimismPp, 19, 1e-9);
  assertAlmostEquals(
    r.residualOptimismPp + r.netMeasurementPp,
    r.observedGapPp,
    1e-9,
  );
});

Deno.test("buildReconciliation appends a target_availability contribution (#557)", () => {
  const aggregates: DateAggregate[] = [{
    date: "2026-01-01",
    targetPct: 50,
    actualPct: 0,
    matchedActualPct: 20,
    includedRows: 2,
    targetRows: 1,
  }];
  const r = buildReconciliation(aggregates, ZERO_FAMILY);
  const ta = r.contributions.find((c) => c.key === "target_availability");
  assert(ta !== undefined);
  assertEquals(ta?.issue, 557);
  assertAlmostEquals(ta?.contributionPp as number, 20, 1e-9);
});

Deno.test("buildReconciliation: empty aggregates yield zeros, not NaN", () => {
  const r = buildReconciliation([], ZERO_FAMILY);
  assertEquals(r.observedGapPp, 0);
  assertEquals(r.matchedGapPp, 0);
  assertEquals(r.targetAvailabilityPp, 0);
  assertEquals(r.netMeasurementPp, 0);
  assertEquals(r.residualOptimismPp, 0);
  assertEquals(r.includedRows, 0);
});

Deno.test("FAMILY_CONTRIBUTIONS covers the quantified #544 sub-issues", () => {
  const issues = FAMILY_CONTRIBUTIONS.map((c) => c.issue).sort();
  assertEquals(issues, [552, 553, 554, 555, 556]);
  // Sign convention: price-basis and split parity mask (negative); dividend
  // inflates (positive); denominator and decoding are ruled out (zero).
  const by = (k: string) =>
    FAMILY_CONTRIBUTIONS.find((c) => c.key === k)?.contributionPp;
  assert((by("price_basis") as number) < 0);
  assert((by("dividend_basis") as number) > 0);
  assertEquals(by("buy_price_denominator"), 0);
  assert((by("horizon_split_parity") as number) < 0);
  assertEquals(by("score_target_decoding"), 0);
});

// --- computeResidualGapReconciliation (real committed data, read-only) -------

// Read-only against the committed docs tree (no --allow-write needed, matching
// quality.sh's `deno test --allow-read`). Asserts structural invariants rather
// than exact figures, which shift as the daily score history grows.

Deno.test("computeResidualGapReconciliation reconciles the committed score set", async () => {
  const report = await computeResidualGapReconciliation(
    "docs",
    midnight("2026-06-26"),
  );
  // There is a matured history with included rows behind the means.
  assert(report.maturedDates > 0);
  assert(report.includedRows > 0);
  // Target is averaged over a subset of Actual's rows (target-availability).
  assert(report.targetRows <= report.includedRows);
  assertEquals(
    report.droppedTargetRows,
    report.includedRows - report.targetRows,
  );
  // The model is optimistic in aggregate: Target sits above Actual.
  assert(report.observedGapPp > 0);
  // The reconciliation identity always holds.
  assertAlmostEquals(
    report.residualOptimismPp + report.netMeasurementPp,
    report.observedGapPp,
    1e-9,
  );
  // The target-availability term is present and small (immaterial asymmetry).
  const ta = report.contributions.find((c) => c.key === "target_availability");
  assert(ta !== undefined);
  assert(Math.abs(ta?.contributionPp as number) < 1);
});

Deno.test("computeResidualGapReconciliation honours the matured-only window", async () => {
  // An as-of date before any score date matures yields an empty, zeroed report.
  const early = await computeResidualGapReconciliation(
    "docs",
    midnight("2000-01-01"),
  );
  assertEquals(early.maturedDates, 0);
  assertEquals(early.observedGapPp, 0);
});
