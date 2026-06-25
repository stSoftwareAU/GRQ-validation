// Diagnostic for issue #553 (milestone #544): quantify the Target/Actual bias
// that comes purely from the DIVIDEND basis mismatch between training and the
// dashboard.
//
//   - The GRQ model bakes a FLAT quarter of the trailing annual dividend,
//     `core.yearOfDividends / 4`, into the total-return training label for EVERY
//     stock (GRQ/src/LearnUtil.ts:147-148, GRQ/src/CoreFeatures.ts).
//   - The dashboard/validation side credits only the ACTUAL ex-dividends inside
//     the 90-day window (GRQ-validation/src/utils.rs
//     `calculate_dividends_for_period`, mirrored by the shipped JS kernels
//     `filterDividendsWithin90Days` + `sumDividends`).
//
// Per matured row this script compares the two credits and aggregates the mean
// difference (in pp of buy price) and its SIGN, so we know whether the flat
// quarter is a consistent over- or under-credit relative to realised dividends,
// and whether it contributes to (or offsets) the Target-over-Actual gap.
//
// It reuses the SHIPPED kernels — GRQProjection.trailingAnnualDividends,
// dividendBasisDifferencePercent, isStockIncluded, and the
// GRQTrendPredictions resolver/parsers — so the windowed credit it reports is
// computed on exactly the same basis the dashboard uses.
//
// Run: deno run --allow-read scripts/diagnose_dividend_basis.ts \
//        [docsPath] [asOf YYYY-MM-DD] [dividendsRoot]
// (defaults: docsPath="docs", asOf=today, dividendsRoot="../GRQ-dividends").
// Read-only; prints a Markdown-friendly report.

import { computeDividendBasisDiagnostic } from "./dividend_basis_diagnostic.ts";

const docsPath = Deno.args[0] ?? "docs";
// "Today" governs which score dates have a complete 90-day window. Default to
// the real clock; allow an override (second arg, YYYY-MM-DD) for reproducible
// reports pinned to a specific as-of date.
const asOf = Deno.args[1] ? new Date(Deno.args[1]) : new Date();
const dividendsRoot = Deno.args[2] ?? "../GRQ-dividends";

const report = await computeDividendBasisDiagnostic(
  docsPath,
  asOf,
  dividendsRoot,
);

const pp = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(3)} pp`;

console.log(
  `# Dividend-basis (flat 1/4 vs windowed) diagnostic — issue #553\n`,
);
console.log(`As-of date:              ${asOf.toISOString().slice(0, 10)}`);
console.log(`Dividend history root:   ${dividendsRoot}`);
console.log(`Matured score dates:     ${report.maturedDates}`);
console.log(`Included stock-rows:     ${report.rowCount}`);
console.log("");
console.log(
  `## Per-row basis difference (flatCredit - windowedCredit) / buyPrice`,
);
console.log(`Mean (raw):              ${pp(report.meanDiffPp)}`);
console.log(`Mean (1%-trimmed):       ${pp(report.trimmedMeanDiffPp)}`);
console.log(`Median:                  ${pp(report.medianDiffPp)}`);
console.log(`Min:                     ${pp(report.minDiffPp)}`);
console.log(`Max:                     ${pp(report.maxDiffPp)}`);
console.log(`Std dev:                 ${report.stdDevPp.toFixed(3)} pp`);
console.log(
  `Within +/-1 pp:          ${report.within1ppSharePct.toFixed(1)} %`,
);
console.log("");
console.log(`## Dividend-return components (mean over included rows)`);
console.log(`Mean flat credit yield:  ${report.meanFlatYieldPct.toFixed(3)} %`);
console.log(
  `Mean windowed yield:     ${report.meanWindowedYieldPct.toFixed(3)} %`,
);
console.log(
  `Rows with 0 in-window:   ${report.windowedZeroSharePct.toFixed(1)} %`,
);
console.log(`Gap contribution:        ${pp(report.contributionPp)}`);
console.log("");
console.log(report.verdict);
