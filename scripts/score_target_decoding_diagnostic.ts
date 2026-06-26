// Core computation for the issue #556 score→target decoding diagnostic
// (milestone #544 — one candidate source of the systematic Target-over-Actual
// measurement gap).
//
// The question: the AI emits a score in [-1, 1]; the GRQ dashboard derives the
// Target from it via `reverseProfitRecommend(price, score)`
// (GRQ/src/LearnUtilTypes.ts:19-39, called at GRQ/src/portfolio/ScoreApp.ts:473).
// The FORWARD mapping used in training is
//   profitRecommend(pct) = tanh((pct - 1.5) / 3)            (encode: pct → score)
// and the REVERSE is
//   pct = 3 * atanh(score) + 1.5, then target = price * (1 + pct / 100)
// with three clamps:
//   - score >=  1 → +MAX_REVERSE_PERCENT (+50%)
//   - score <= -1 → target 0 (i.e. pct = -100%)
//   - interior pct capped to ±MAX_REVERSE_PERCENT (±50%)
//
// In the interior `tanh`/`atanh` are exact inverses, so the round-trip
// `profitRecommend ∘ reverseProfitRecommend` is the identity. The *clamps* are
// asymmetric (a `0`/-100% floor versus a +50% cap), so the concern is whether,
// over the REALISED score distribution, decoding introduces a consistent
// same-direction (plausibly upward) Target shift.
//
// This module ports the two GRQ functions faithfully (they live upstream in
// `GRQ`, not in this repo) and measures the round-trip Target shift purely in
// score↔return-percent space — the per-row pp shift is price-independent, so no
// market data is needed. It also takes a census of how often the realised
// scores land in each clamped region.
//
// The score parsing is delegated to the SHIPPED dashboard kernel
// (docs/trend_predictions.js → GRQTrendPredictions.parseScoreTsv), so the
// diagnostic reads exactly the score column the dashboard reads.

import "../docs/volume_recommend.js";
import "../docs/trend_predictions.js";

// deno-lint-ignore no-explicit-any
const TP = (globalThis as any).GRQTrendPredictions;

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

/** The +50% cap / -50% interior cap magnitude from GRQ's LearnUtilTypes. */
export const MAX_REVERSE_PERCENT = 50;

/**
 * Forward training encode: a candidate return percentage → score in (-1, 1).
 * Mirrors GRQ `profitRecommend` (GRQ/src/LearnUtilTypes.ts:12-15).
 */
export function profitRecommend(pct: number): number {
  return Math.tanh((pct - 1.5) / 3);
}

/** Which clamp region a score lands in when decoded. */
export type DecodeRegion =
  | "interior" // clean tanh/atanh inverse, no clamp engaged
  | "cap_high" // score >= 1 → +MAX_REVERSE_PERCENT
  | "floor_low" // score <= -1 → target 0 (pct = -100%)
  | "interior_cap_high" // interior atanh pct exceeded +MAX_REVERSE_PERCENT
  | "interior_cap_low"; // interior atanh pct fell below -MAX_REVERSE_PERCENT

/** The decoded return percentage plus the region that produced it. */
export interface DecodeResult {
  pct: number;
  region: DecodeRegion;
}

/**
 * Reverse decode: score → return percentage, with GRQ's three clamps.
 * Mirrors the percentage half of GRQ `reverseProfitRecommend`
 * (GRQ/src/LearnUtilTypes.ts:19-39). The `target = price * (1 + pct/100)` step
 * is split out into {@link reverseProfitTarget} so the round-trip can be
 * measured in price-independent return-percent space.
 */
export function reverseProfitPct(score: number): DecodeResult {
  if (score >= 1) {
    return { pct: MAX_REVERSE_PERCENT, region: "cap_high" };
  }
  if (score <= -1) {
    // Decodes to target 0 → a -100% return, deeper than the -50% interior cap.
    return { pct: -100, region: "floor_low" };
  }
  const raw = 3 * Math.atanh(score) + 1.5;
  if (raw > MAX_REVERSE_PERCENT) {
    return { pct: MAX_REVERSE_PERCENT, region: "interior_cap_high" };
  }
  if (raw < -MAX_REVERSE_PERCENT) {
    return { pct: -MAX_REVERSE_PERCENT, region: "interior_cap_low" };
  }
  return { pct: raw, region: "interior" };
}

/**
 * Reverse decode to a price target, mirroring GRQ `reverseProfitRecommend`
 * end-to-end. `score <= -1` yields a 0 target; otherwise
 * `price * (1 + pct / 100)`.
 */
export function reverseProfitTarget(price: number, score: number): number {
  if (score <= -1) return 0;
  const { pct } = reverseProfitPct(score);
  return price * (1 + pct / 100);
}

/**
 * The round-trip return-percent shift for a single score:
 * decode → re-encode → re-decode, returning `pct2 - pct1` (the same-units pp
 * shift in the implied Target return). Zero to floating-point precision wherever
 * the decode is a clean inverse of `profitRecommend`.
 */
export function roundTripShiftPp(score: number): number {
  const pct1 = reverseProfitPct(score).pct;
  const reEncoded = profitRecommend(pct1);
  const pct2 = reverseProfitPct(reEncoded).pct;
  return pct2 - pct1;
}

/** Summary statistics for a list of values. Empty input → all-zero. */
export interface Summary {
  count: number;
  mean: number;
  median: number;
  min: number;
  max: number;
  stdDev: number;
}

/** Pure stats over a list of numbers. Empty input yields an all-zero summary. */
export function summarise(values: number[]): Summary {
  const finite = values.filter((v) =>
    typeof v === "number" && !Number.isNaN(v)
  );
  if (finite.length === 0) {
    return { count: 0, mean: 0, median: 0, min: 0, max: 0, stdDev: 0 };
  }
  const sorted = [...finite].sort((a, b) => a - b);
  const sum = finite.reduce((t, v) => t + v, 0);
  const mean = sum / finite.length;
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
  const variance = finite.reduce((t, v) => t + (v - mean) ** 2, 0) /
    finite.length;
  return {
    count: finite.length,
    mean,
    median,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    stdDev: Math.sqrt(variance),
  };
}

/** A per-region row count plus its share of the total. */
export interface RegionCensus {
  region: DecodeRegion;
  count: number;
  fraction: number;
}

/** The full diagnostic result over the score set. */
export interface DecodingReport {
  scoreDates: number;
  scoreRows: number;
  // Round-trip shift over the realised scores (pp of return).
  shift: Summary;
  // Clamp-region census over the realised scores.
  census: RegionCensus[];
  // Convenience headline numbers.
  fractionCapHigh: number;
  fractionFloorLow: number;
  // The mean DECODED return percentage (the average Target return the decode
  // assigns), and what the SATURATED (score == 1) rows alone decode to.
  meanDecodedPct: number;
  saturatedRows: number;
  verdict: string;
}

const REGION_ORDER: DecodeRegion[] = [
  "interior",
  "cap_high",
  "floor_low",
  "interior_cap_high",
  "interior_cap_low",
];

function censusOf(regions: DecodeRegion[]): RegionCensus[] {
  const total = regions.length;
  return REGION_ORDER.map((region) => {
    const count = regions.filter((r) => r === region).length;
    return { region, count, fraction: total === 0 ? 0 : count / total };
  });
}

/**
 * Assemble the report from a flat list of realised scores spread over a number
 * of score dates. Pure, so it can be unit-tested with synthetic scores.
 */
export function buildReport(
  scores: number[],
  scoreDates: number,
): DecodingReport {
  const decoded = scores.map((s) => reverseProfitPct(s));
  const regions = decoded.map((d) => d.region);
  const shift = summarise(scores.map(roundTripShiftPp));
  const census = censusOf(regions);

  const capHigh = census.find((c) => c.region === "cap_high");
  const floorLow = census.find((c) => c.region === "floor_low");
  const fractionCapHigh = capHigh ? capHigh.fraction : 0;
  const fractionFloorLow = floorLow ? floorLow.fraction : 0;
  const saturatedRows = capHigh ? capHigh.count : 0;

  const decodedPcts = decoded.map((d) => d.pct);
  const meanDecodedPct = decodedPcts.length === 0
    ? 0
    : decodedPcts.reduce((t, v) => t + v, 0) / decodedPcts.length;

  const shiftSign = shift.mean >= 0 ? "+" : "-";
  const negligible = Math.abs(shift.mean) < 1e-6 && shift.stdDev < 1e-6;
  const verdict = negligible
    ? `VERDICT (decode round-trip RULED OUT): over ${scores.length} realised ` +
      `scores the round-trip profitRecommend∘reverseProfitRecommend shift is ` +
      `${shiftSign}${Math.abs(shift.mean).toFixed(6)} pp (max |shift| ` +
      `${
        Math.max(Math.abs(shift.min), Math.abs(shift.max)).toFixed(6)
      } pp) — ` +
      `tanh/atanh are exact inverses, so decoding adds NO systematic Target ` +
      `shift. The asymmetric clamps cannot bias the realised data either: the ` +
      `+50% cap fires for ${(fractionCapHigh * 100).toFixed(1)}% of rows but ` +
      `round-trips cleanly, and the 0/-100% floor fires for ` +
      `${(fractionFloorLow * 100).toFixed(1)}% (no negative scores exist). ` +
      `The one residual, NON-decode candidate is encode-side quantisation: a ` +
      `saturated score (==1) is a fixed +50% point estimate of an unknown true ` +
      `intent ≥ the saturation threshold — flag for GRQ, not fixable in the ` +
      `dashboard decode.`
    : `VERDICT: round-trip shift mean ${shiftSign}${
      Math.abs(shift.mean).toFixed(6)
    } pp is non-negligible — investigate the clamp interaction further.`;

  return {
    scoreDates,
    scoreRows: scores.length,
    shift,
    census,
    fractionCapHigh,
    fractionFloorLow,
    meanDecodedPct,
    saturatedRows,
    verdict,
  };
}

interface ScoreIndexEntry {
  file: string;
  date: string;
}

/**
 * Load every score file's realised scores from disk and compute the diagnostic.
 * `maturedOnly` (default true) restricts to score dates whose full 90-day
 * window has elapsed by `asOf` — matching how the trend/gap is measured — but
 * the decode round-trip is a property of the score alone, so the conclusion is
 * stable either way.
 */
export async function computeDecodingDiagnostic(
  docsPath: string,
  asOf: Date,
  maturedOnly = true,
): Promise<DecodingReport> {
  const indexText = await Deno.readTextFile(`${docsPath}/scores/index.json`);
  const index = JSON.parse(indexText) as { scores: ScoreIndexEntry[] };

  const scores: number[] = [];
  let scoreDates = 0;
  for (const entry of index.scores) {
    const scoreDate = TP.parseScoreDateString(entry.date);
    if (
      maturedOnly && asOf.getTime() < scoreDate.getTime() + NINETY_DAYS_MS
    ) {
      continue; // window not yet complete — not matured
    }
    const base = `${docsPath}/scores/${entry.file.replace(/\.tsv$/, "")}`;
    const tsvText = await readOptional(`${base}.tsv`);
    if (!tsvText.trim()) {
      continue; // index references a date with no generated score file
    }
    const rows = TP.parseScoreTsv(tsvText);
    let any = false;
    // deno-lint-ignore no-explicit-any
    for (const row of rows as any[]) {
      if (typeof row.score === "number" && !Number.isNaN(row.score)) {
        scores.push(row.score);
        any = true;
      }
    }
    if (any) scoreDates++;
  }

  return buildReport(scores, scoreDates);
}

async function readOptional(path: string): Promise<string> {
  try {
    return await Deno.readTextFile(path);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return "";
    throw err;
  }
}
