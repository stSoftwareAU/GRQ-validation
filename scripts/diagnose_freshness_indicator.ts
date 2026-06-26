// Diagnostic CLI for issue #587: explain why the ⚠️ fair-value freshness
// indicator (issue #547) fires, settle the comment-vs-arithmetic sign
// discrepancy, and quantify the blast radius across every score date.
//
// DIAGNOSE-ONLY — read-only, prints a Markdown-friendly report. The fix is a
// separate, later issue.
//
// Run: deno run --allow-read scripts/diagnose_freshness_indicator.ts [docsPath]
//   docsPath default "docs".

import {
  computeFreshnessDiagnostic,
  type WarningRow,
} from "./freshness_indicator_diagnostic.ts";

const docsPath = Deno.args[0] ?? "docs";
const report = await computeFreshnessDiagnostic(docsPath);

console.log(`# Fair-value freshness ⚠️ diagnostic — issue #587\n`);
console.log(`Score dates scanned:        ${report.scoreDatesScanned}`);
console.log(`Rated rows in 30-day window: ${report.ratedRowsInWindow}`);
console.log(`Rows showing ⚠️ (total):     ${report.warningRows.length}`);
console.log(`  · false positives:         ${report.falsePositives}`);
console.log(`  · real anomalies:          ${report.realAnomalies}`);
console.log(
  `Genuine anomalies MISSED:    ${report.missedAnomalyRows.length}\n`,
);

const pctWarned = report.ratedRowsInWindow > 0
  ? (100 * report.warningRows.length / report.ratedRowsInWindow).toFixed(1)
  : "0.0";
console.log(
  `So ${pctWarned}% of rated, in-window rows render ⚠️ — confirming the ` +
    `indicator is systemically wrong, not a one-off mis-dated row.\n`,
);

const dd = report.warningRows.find(
  (r) => r.stock === "NYSE:DD" && r.scoreDate === "2025-12-28",
);
console.log(`## Worked example — DD / 2025-12-28`);
if (dd) {
  console.log(
    `  analysis dated ${dd.analysisDate}; signedDaysFromScore=` +
      `${dd.signedDaysFromScore} (shipped ⇒ ⚠️); intended age=` +
      `${dd.intendedAgeDays} days ⇒ ${dd.classification}.\n`,
  );
} else {
  console.log(`  (no ⚠️ row found for DD/2025-12-28 in this dataset)\n`);
}

console.log(`## Blast radius — every stock-date showing ⚠️`);
console.log(
  `scoreDate   stock              analysisDate  signed  intended  class`,
);
for (const r of sortRows(report.warningRows)) {
  console.log(
    `${r.scoreDate}  ${r.stock.padEnd(18)} ${r.analysisDate}    ` +
      `${pad(r.signedDaysFromScore, 6)}  ${pad(r.intendedAgeDays, 8)}  ` +
      `${r.classification}`,
  );
}

function sortRows(rows: WarningRow[]): WarningRow[] {
  return [...rows].sort((a, b) =>
    a.scoreDate === b.scoreDate
      ? a.stock.localeCompare(b.stock)
      : a.scoreDate.localeCompare(b.scoreDate)
  );
}

function pad(n: number, w: number): string {
  return String(n).padStart(w, " ");
}
