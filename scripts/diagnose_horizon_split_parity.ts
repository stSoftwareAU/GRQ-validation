// Diagnostic for issue #555 (milestone #544): audit the market-data TIMING and
// CORPORATE-ACTION parity between GRQ training and the GRQ-validation dashboard,
// and quantify the one divergence that is measurable on the dashboard's data —
// the as-of split basis of the Actual horizon price.
//
//   - Horizon ROW selection: training takes lowPrice at
//     rewindToTradingDay(asOf + 90*DAY); the dashboard takes the last point on
//     or before scoreDate + 90 days. On the stock's own daily series these
//     resolve to the SAME row, so the horizon DATE is aligned.
//   - Split-adjusted series: both sides work on split-adjusted prices. The
//     dashboard restates the buy price AND the model's target into CURRENT
//     (end-of-series) terms, but reads the Actual horizon price RAW. When a
//     reconcilable split falls between the horizon and the series end, the
//     Actual sits on a different split basis than the buy price it is divided
//     by — a forward split inflates Actual (masking the gap), a reverse split
//     deflates it (widening the gap). Target % is invariant (it divides both
//     adjustedTarget and buyPrice by the same factor).
//
// This script measures that as-of-basis offset over the matured historical
// score set, reusing the SHIPPED kernels — GRQProjection.horizonPriceCurrentBasis,
// postHorizonSplitFactor, horizonAsOfBasisOffsetPercent, getBuyPrice,
// calculatePortfolioTargetPercentage, calculateIncludedPortfolioPerformance and
// isStockIncluded, plus the GRQTrendPredictions CSV/TSV parsers — so the numbers
// it reports are computed on exactly the same basis the dashboard uses.
//
// Run: deno run --allow-read scripts/diagnose_horizon_split_parity.ts [docsPath] [asOf]
// (default docsPath = "docs", asOf = today). Read-only; prints a Markdown report.

import { computeHorizonSplitParityDiagnostic } from "./horizon_split_parity_diagnostic.ts";

const docsPath = Deno.args[0] ?? "docs";
// "Today" governs which score dates have a complete 90-day window. Default to
// the real clock; allow an override (second arg, YYYY-MM-DD) for reproducible
// reports pinned to a specific as-of date.
const asOf = Deno.args[1] ? new Date(Deno.args[1]) : new Date();

const report = await computeHorizonSplitParityDiagnostic(docsPath, asOf);

const pp = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(3)} pp`;

console.log(`# Horizon split-basis parity diagnostic — issue #555\n`);
console.log(`As-of date:               ${asOf.toISOString().slice(0, 10)}`);
console.log(`Matured score dates:      ${report.maturedDates}`);
console.log(`Included stock-rows:      ${report.rowCount}`);
console.log(`Post-horizon split rows:  ${report.splitAffectedRows}`);
console.log("");
console.log(
  `## Per-row as-of-basis offset (rawHorizon - currentBasis) / buyPrice`,
);
console.log(`Mean:                     ${pp(report.meanOffsetPp)}`);
console.log(`Median:                   ${pp(report.medianOffsetPp)}`);
console.log(`Min:                      ${pp(report.minOffsetPp)}`);
console.log(`Max:                      ${pp(report.maxOffsetPp)}`);
console.log(`Std dev:                  ${report.stdDevPp.toFixed(3)} pp`);
console.log("");
console.log(`## Per-date portfolio aggregates (mean over matured dates)`);
console.log(`Mean Target %:            ${report.meanTargetPct.toFixed(3)} %`);
console.log(
  `Mean Actual % (raw):      ${report.meanActualRawPct.toFixed(3)} %`,
);
console.log(
  `Mean Actual % (current):  ${report.meanActualCurrentBasisPct.toFixed(3)} %`,
);
console.log(`Observed gap (T-A,raw):   ${pp(report.observedGapPp)}`);
console.log(`Gap on current basis:     ${pp(report.gapOnCurrentBasisPp)}`);
console.log(`Basis contribution:       ${pp(report.basisContributionPp)}`);
console.log("");
console.log(report.verdict);
