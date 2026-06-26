// Tests for the issue #556 score→target decoding (reverseProfitRecommend)
// diagnostic. These exercise the ported GRQ functions and the pure aggregation
// in scripts/score_target_decoding_diagnostic.ts with synthetic scores,
// asserting on computed results — not source text.

import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import {
  buildReport,
  computeDecodingDiagnostic,
  MAX_REVERSE_PERCENT,
  profitRecommend,
  reverseProfitPct,
  reverseProfitTarget,
  roundTripShiftPp,
  summarise,
} from "../scripts/score_target_decoding_diagnostic.ts";

Deno.test("profitRecommend matches tanh((pct - 1.5) / 3)", () => {
  assertAlmostEquals(profitRecommend(1.5), 0, 1e-12); // centre maps to 0
  assertAlmostEquals(profitRecommend(4.5), Math.tanh(1), 1e-12);
  assert(profitRecommend(50) > 0.999999); // saturates near +1
});

Deno.test("reverseProfitPct is the clean inverse of profitRecommend in the interior", () => {
  for (const pct of [-10, -2, 0, 1.5, 4.10463, 12.5, 30]) {
    const score = profitRecommend(pct);
    const back = reverseProfitPct(score);
    assertEquals(back.region, "interior");
    // atanh amplifies float error near saturation; 1e-6 still confirms the
    // inverse holds to well under a thousandth of a percentage point.
    assertAlmostEquals(back.pct, pct, 1e-6);
  }
});

Deno.test("reverseProfitPct clamps score >= 1 to +MAX_REVERSE_PERCENT (cap_high)", () => {
  const r = reverseProfitPct(1);
  assertEquals(r.pct, MAX_REVERSE_PERCENT);
  assertEquals(r.region, "cap_high");
  // Strictly above 1 clamps identically.
  assertEquals(reverseProfitPct(1.5).region, "cap_high");
});

Deno.test("reverseProfitPct clamps score <= -1 to -100% (floor_low, asymmetric)", () => {
  const r = reverseProfitPct(-1);
  assertEquals(r.pct, -100); // deeper than the -50% interior cap → asymmetric
  assertEquals(r.region, "floor_low");
});

Deno.test("reverseProfitTarget mirrors price * (1 + pct/100) and the 0 floor", () => {
  // score == 1 → +50% → target = 1.5 * price (anchored to the real data:
  // NYSE:DD score 1, target 68.39, buy ~45.59 = 68.39 / 1.5).
  assertAlmostEquals(reverseProfitTarget(45.5933, 1), 68.39, 1e-3);
  // interior score reproduces the stored target (anchored row: s=0.70043,
  // price 75.66 → target ~78.77).
  assertAlmostEquals(
    reverseProfitTarget(75.66, 0.7004302144050806),
    78.77,
    1e-2,
  );
  // score <= -1 → target 0.
  assertEquals(reverseProfitTarget(100, -1), 0);
});

Deno.test("roundTripShiftPp is ~0 for interior scores (exact inverse)", () => {
  for (const pct of [-20, -5, 0, 3.5, 15, 28]) {
    const score = profitRecommend(pct);
    assertAlmostEquals(roundTripShiftPp(score), 0, 1e-6);
  }
});

Deno.test("roundTripShiftPp is ~0 even at the saturated +1 clamp", () => {
  // score 1 → +50% → re-encode tanh(16.166) ≈ 1 → re-decode +50% → shift 0.
  assertAlmostEquals(roundTripShiftPp(1), 0, 1e-6);
});

Deno.test("summarise computes mean/median/min/max/stdDev and handles empty", () => {
  const s = summarise([1, 2, 3, 4]);
  assertEquals(s.count, 4);
  assertAlmostEquals(s.mean, 2.5);
  assertAlmostEquals(s.median, 2.5);
  assertEquals(s.min, 1);
  assertEquals(s.max, 4);
  assertAlmostEquals(s.stdDev, Math.sqrt(1.25));
  assertEquals(summarise([]), {
    count: 0,
    mean: 0,
    median: 0,
    min: 0,
    max: 0,
    stdDev: 0,
  });
});

Deno.test("buildReport: realistic positive-only distribution rules out decode bias", () => {
  // Mixture mirroring the realised data: many saturated (==1) plus interior
  // positives, no negatives.
  const scores = [
    1,
    1,
    1,
    profitRecommend(4),
    profitRecommend(10),
    profitRecommend(25),
    profitRecommend(2),
  ];
  const r = buildReport(scores, 3);
  assertEquals(r.scoreRows, 7);
  assertEquals(r.scoreDates, 3);
  // Round-trip shift is negligible across the whole distribution.
  assertAlmostEquals(r.shift.mean, 0, 1e-6);
  assert(Math.abs(r.shift.min) < 1e-6 && Math.abs(r.shift.max) < 1e-6);
  // Census: 3 saturated cap_high, 4 interior, no floor_low.
  assertEquals(r.saturatedRows, 3);
  assertAlmostEquals(r.fractionCapHigh, 3 / 7, 1e-9);
  assertEquals(r.fractionFloorLow, 0);
  assert(r.verdict.includes("RULED OUT"));
});

Deno.test("buildReport: census fractions sum to 1 and cover every region", () => {
  const scores = [1, -1, profitRecommend(5), profitRecommend(20)];
  const r = buildReport(scores, 1);
  const total = r.census.reduce((t, c) => t + c.fraction, 0);
  assertAlmostEquals(total, 1, 1e-9);
  const counts = r.census.reduce((t, c) => t + c.count, 0);
  assertEquals(counts, 4);
  assertEquals(r.fractionFloorLow, 0.25); // the single -1
});

Deno.test("buildReport: empty input yields a zeroed report", () => {
  const r = buildReport([], 0);
  assertEquals(r.scoreRows, 0);
  assertEquals(r.shift.count, 0);
  assertEquals(r.meanDecodedPct, 0);
});

Deno.test("computeDecodingDiagnostic over the real score history holds the round-trip invariants", async () => {
  // Read-only against the committed docs/ tree (matches the suite's
  // --allow-read permission model). Asserts the stable invariants the verdict
  // rests on rather than brittle exact counts, so it survives data refreshes.
  const all = await computeDecodingDiagnostic(
    "docs",
    new Date("2026-06-26"),
    false,
  );
  assert(all.scoreRows > 0, "history has scores");
  assert(all.scoreDates > 0, "history has dates");
  // Round-trip shift is machine epsilon — decoding is a faithful inverse.
  assert(Math.abs(all.shift.mean) < 1e-9, "mean round-trip shift ~ 0");
  assert(
    Math.max(Math.abs(all.shift.min), Math.abs(all.shift.max)) < 1e-9,
    "max round-trip shift ~ 0",
  );
  // The asymmetric 0/-100% floor never fires in the realised data.
  assertEquals(all.fractionFloorLow, 0);
  // Census fractions are a partition of the rows.
  const total = all.census.reduce((t, c) => t + c.fraction, 0);
  assertAlmostEquals(total, 1, 1e-9);
  assert(all.verdict.includes("RULED OUT"));

  // Maturing the set never grows it.
  const matured = await computeDecodingDiagnostic(
    "docs",
    new Date("2026-06-26"),
    true,
  );
  assert(matured.scoreRows <= all.scoreRows);
  assert(matured.scoreDates <= all.scoreDates);
});
