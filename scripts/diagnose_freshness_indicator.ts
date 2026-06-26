// Reporting CLI for the fair-value freshness indicator (issue #547), updated
// for the issue #600 sign fix. Read-only: it prints, for every rated stock-date
// inside the 30-day window, the corrected analysis age and the freshness emoji
// it renders, and flags any genuine after-score anomaly with ⚠️.
//
// Run: deno run --allow-read scripts/diagnose_freshness_indicator.ts [docsPath]
//   docsPath default "docs".

import {
  computeFreshnessReport,
  type FreshnessRow,
} from "./freshness_indicator_diagnostic.ts";

const docsPath = Deno.args[0] ?? "docs";
const report = await computeFreshnessReport(docsPath);

console.log(`# Fair-value freshness indicator report — issue #600\n`);
console.log(`Score dates scanned:         ${report.scoreDatesScanned}`);
console.log(`Rated rows in 30-day window: ${report.ratedRowsInWindow}`);
console.log(`  · healthy (freshness emoji): ${report.healthyRows.length}`);
console.log(`  · after-score anomalies ⚠️:  ${report.warningRows.length}\n`);

const dd = report.rows.find(
  (r) => r.stock === "NYSE:DD" && r.scoreDate === "2025-12-28",
);
console.log(`## Worked example — DD / 2025-12-28`);
if (dd) {
  console.log(
    `  analysis dated ${dd.analysisDate}; age=${dd.ageDays} days ⇒ ` +
      `${dd.emoji}${dd.isAnomaly ? " (after-score anomaly)" : " (healthy)"}.\n`,
  );
} else {
  console.log(`  (no rated DD/2025-12-28 row found in this dataset)\n`);
}

console.log(`## After-score anomalies — every stock-date rendering ⚠️`);
if (report.warningRows.length === 0) {
  console.log(`  (none — every rated analysis is dated on/before its score)\n`);
} else {
  console.log(`scoreDate   stock              analysisDate  age`);
  for (const r of sortRows(report.warningRows)) {
    console.log(
      `${r.scoreDate}  ${r.stock.padEnd(18)} ${r.analysisDate}    ` +
        `${pad(r.ageDays, 4)}`,
    );
  }
}

function sortRows(rows: FreshnessRow[]): FreshnessRow[] {
  return [...rows].sort((a, b) =>
    a.scoreDate === b.scoreDate
      ? a.stock.localeCompare(b.stock)
      : a.scoreDate.localeCompare(b.scoreDate)
  );
}

function pad(n: number, w: number): string {
  return String(n).padStart(w, " ");
}
