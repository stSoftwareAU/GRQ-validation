// Diagnostic for issue #554 (milestone #544): quantify the Target/Actual bias
// that comes purely from the buy-price DENOMINATOR mismatch between training and
// the dashboard.
//
//   - The GRQ model is trained on a 90-day return divided by `monthsAgoPrice`,
//     which is the CLOSE on the score date (GRQ/src/CoreFeatures.ts builds
//     `monthsAgoPrice = closePrices[0]`; GRQ/src/LearnUtil.ts divides by it).
//   - The dashboard divides BOTH Target and Actual by `buyPrice`, the
//     split-adjusted MIDPOINT (high + low) / 2 of the first usable point
//     (docs/projection.js -> getBuyPrice).
//
// Because the dashboard uses the SAME buyPrice for Target and Actual, the
// denominator choice cannot desynchronise them — it only rescales any existing
// gap by buyPrice/close. This script quantifies that offset and the gap it
// contributes when both series are restated onto the trained close basis.
//
// It reuses the SHIPPED kernels — GRQProjection.getBuyPrice,
// buyPriceCloseBasis, denominatorBasisOffsetPercent, isStockIncluded,
// calculatePortfolioTargetPercentage and calculateIncludedPortfolioPerformance,
// plus the GRQTrendPredictions CSV/TSV parsers — so the numbers it reports are
// computed on exactly the same basis the dashboard uses.
//
// Run: deno run --allow-read scripts/diagnose_buy_price_denominator.ts [docsPath] [asOf]
// (default docsPath = "docs"). Read-only; prints a Markdown-friendly report.

import { computeDenominatorDiagnostic } from "./buy_price_denominator_diagnostic.ts";

const docsPath = Deno.args[0] ?? "docs";
// "Today" governs which score dates have a complete 90-day window. Default to
// the real clock; allow an override (second arg, YYYY-MM-DD) for reproducible
// reports pinned to a specific as-of date.
const asOf = Deno.args[1] ? new Date(Deno.args[1]) : new Date();

const report = await computeDenominatorDiagnostic(docsPath, asOf);

const pp = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(3)} pp`;

console.log(
  `# Buy-price denominator (midpoint vs close) diagnostic — issue #554\n`,
);
console.log(`As-of date:            ${asOf.toISOString().slice(0, 10)}`);
console.log(`Matured score dates:   ${report.maturedDates}`);
console.log(`Included stock-rows:   ${report.rowCount}`);
console.log("");
console.log(`## Per-row denominator offset (buyPrice - close) / buyPrice`);
console.log(`Mean:                  ${pp(report.meanOffsetPp)}`);
console.log(`Median:                ${pp(report.medianOffsetPp)}`);
console.log(`Min:                   ${pp(report.minOffsetPp)}`);
console.log(`Max:                   ${pp(report.maxOffsetPp)}`);
console.log(`Std dev:               ${report.stdDevPp.toFixed(3)} pp`);
console.log("");
console.log(`## Per-date portfolio aggregates (mean over matured dates)`);
console.log(`Mean Target % (mid):   ${report.meanTargetMidPct.toFixed(3)} %`);
console.log(`Mean Actual % (mid):   ${report.meanActualMidPct.toFixed(3)} %`);
console.log(`Mean Target % (close): ${report.meanTargetClosePct.toFixed(3)} %`);
console.log(`Mean Actual % (close): ${report.meanActualClosePct.toFixed(3)} %`);
console.log(`Observed gap (mid):    ${pp(report.observedGapPp)}`);
console.log(`Gap on close basis:    ${pp(report.gapOnCloseBasisPp)}`);
console.log(`Basis contribution:    ${pp(report.basisContributionPp)}`);
console.log("");
console.log(report.verdict);
