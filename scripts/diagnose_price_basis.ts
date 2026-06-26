// Diagnostic for issue #552 (milestone #544): quantify the Target/Actual bias
// that comes purely from the price BASIS mismatch between training and the
// dashboard.
//
//   - The GRQ model is trained on the intraday LOW of the trading day 90 days
//     ahead (GRQ/src/LearnUtil.ts -> market.lowPrice(symbol, targetDate)).
//   - The dashboard measures Actual at the MIDPOINT (high + low) / 2 of the last
//     point on or before the 90-day horizon (docs/projection.js).
//
// Because mid >= low on every row, reading Actual at the mid LIFTS the measured
// Actual %, which NARROWS (masks) any Target-over-Actual gap. This script
// quantifies that offset over the matured historical score set so we know how
// much of the residual gap genuine model optimism still has to explain.
//
// It reuses the SHIPPED kernels — GRQProjection.getBuyPrice,
// priceAtNinetyDayHorizon, lowPriceAtNinetyDayHorizon, priceBasisOffsetPercent
// and isStockIncluded, plus the GRQTrendPredictions CSV/TSV parsers — so the
// numbers it reports are computed on exactly the same basis the dashboard uses.
//
// Run: deno run --allow-read scripts/diagnose_price_basis.ts [docsPath]
// (default docsPath = "docs"). Read-only; prints a Markdown-friendly report.

import { computePriceBasisDiagnostic } from "./price_basis_diagnostic.ts";

const docsPath = Deno.args[0] ?? "docs";
// "Today" governs which score dates have a complete 90-day window. Default to
// the real clock; allow an override (second arg, YYYY-MM-DD) for reproducible
// reports pinned to a specific as-of date.
const asOf = Deno.args[1] ? new Date(Deno.args[1]) : new Date();

const report = await computePriceBasisDiagnostic(docsPath, asOf);

const pp = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(3)} pp`;

console.log(`# Price-basis (mid vs low) diagnostic — issue #552\n`);
console.log(`As-of date:            ${asOf.toISOString().slice(0, 10)}`);
console.log(`Matured score dates:   ${report.maturedDates}`);
console.log(`Included stock-rows:   ${report.rowCount}`);
console.log("");
console.log(`## Per-row basis offset (mid - low) / buyPrice`);
console.log(`Mean:                  ${pp(report.meanOffsetPp)}`);
console.log(`Median:                ${pp(report.medianOffsetPp)}`);
console.log(`Min:                   ${pp(report.minOffsetPp)}`);
console.log(`Max:                   ${pp(report.maxOffsetPp)}`);
console.log(`Std dev:               ${report.stdDevPp.toFixed(3)} pp`);
console.log("");
console.log(`## Per-date portfolio aggregates (mean over matured dates)`);
console.log(`Mean Target %:         ${report.meanTargetPct.toFixed(3)} %`);
console.log(`Mean Actual % (mid):   ${report.meanActualMidPct.toFixed(3)} %`);
console.log(`Mean Actual % (low):   ${report.meanActualLowPct.toFixed(3)} %`);
console.log(`Observed gap (T-A,mid):${pp(report.observedGapPp)}`);
console.log(`Gap on low basis:      ${pp(report.gapOnLowBasisPp)}`);
console.log(`Basis contribution:    ${pp(report.basisContributionPp)}`);
console.log("");
console.log(report.verdict);
