// Diagnostic for issue #557 (milestone #544): whole-application sweep for any
// remaining same-direction Target/Actual asymmetry, plus the residual-gap
// reconciliation that nets the observed Target-over-Actual gap against the
// quantified #544-family candidates (#552–#556) and this sweep's own finding.
//
// The sweep confirms that aggregation weighting and the inclusion gate are
// SHARED between Target and Actual (both equal-weight over isStockIncluded),
// and surfaces the one aggregation-layer asymmetry the targeted sub-issues did
// not cover: the target-availability denominator skew (priceable rows with a
// missing target count in Actual but not Target).
//
// It reuses the SHIPPED kernels — GRQProjection.calculatePortfolioTargetPercentage,
// calculateIncludedPortfolioPerformance, isStockIncluded — plus the
// GRQTrendPredictions CSV/TSV parsers, so the numbers are computed on exactly
// the same basis the dashboard uses.
//
// Run: deno run --allow-read scripts/diagnose_residual_gap.ts [docsPath] [asOf]
// (default docsPath = "docs", asOf = now). Read-only; prints a Markdown report.

import { computeResidualGapReconciliation } from "./residual_gap_reconciliation.ts";

const docsPath = Deno.args[0] ?? "docs";
const asOf = Deno.args[1] ? new Date(Deno.args[1]) : new Date();

const report = await computeResidualGapReconciliation(docsPath, asOf);

const pp = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(3)} pp`;

console.log(`# Residual Target-over-Actual gap reconciliation — issue #557\n`);
console.log(`As-of date:            ${asOf.toISOString().slice(0, 10)}`);
console.log(`Matured score dates:   ${report.maturedDates}`);
console.log(`Included stock-rows:   ${report.includedRows}`);
console.log(`Target-present rows:   ${report.targetRows}`);
console.log(`Dropped-target rows:   ${report.droppedTargetRows}`);
console.log("");
console.log(`## Portfolio means (over matured dates)`);
console.log(`Mean Target %:         ${report.meanTargetPct.toFixed(3)} %`);
console.log(`Mean Actual %:         ${report.meanActualPct.toFixed(3)} %`);
console.log(
  `Mean Actual % (matched):${report.meanMatchedActualPct.toFixed(3)} %`,
);
console.log(`Observed gap (T-A):    ${pp(report.observedGapPp)}`);
console.log(`Matched-subset gap:    ${pp(report.matchedGapPp)}`);
console.log(`Target-availability:   ${pp(report.targetAvailabilityPp)}`);
console.log("");
console.log(`## Reconciliation against the #544 candidates`);
console.log(
  `(sign convention: + inflates the apparent gap, - masks it)\n`,
);
for (const c of report.contributions) {
  console.log(`#${c.issue} ${c.key.padEnd(22)} ${pp(c.contributionPp)}`);
}
console.log("");
console.log(`Net measurement:       ${pp(report.netMeasurementPp)}`);
console.log(`Observed gap:          ${pp(report.observedGapPp)}`);
console.log(`Residual (optimism):   ${pp(report.residualOptimismPp)}`);
console.log("");
console.log(report.verdict);
