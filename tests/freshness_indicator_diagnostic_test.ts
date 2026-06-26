// Regression tests for the fair-value freshness ⚠️ sign fix (issue #600,
// diagnosed in #587).
//
// These exercise the REAL freshness functions (no source grepping): they feed
// known analysis CSV text and assert on the corrected analysis age, the emoji
// each row renders, and the blast-radius counts. They pin the fix: healthy rows
// (analysis dated on/before the score) show a freshness emoji, and only a
// genuine after-score anomaly renders ⚠️.

import { assert, assertEquals } from "@std/assert";
import {
  analyseDataset,
  analysisAgeDays,
  computeAvgStars,
  getFreshnessEmoji,
  parseAnalysisDate,
  parseCSVLine,
} from "../scripts/freshness_indicator_diagnostic.ts";

const d = (iso: string) => {
  const [y, m, day] = iso.split("-").map((n) => parseInt(n, 10));
  return new Date(y, m - 1, day);
};

Deno.test("analysisAgeDays is non-negative when analysis predates the score", () => {
  // DD worked example: analysis 23 Dec, score 28 Dec → 5 whole days old.
  assertEquals(analysisAgeDays(d("2025-12-23"), d("2025-12-28")), 5);
});

Deno.test("analysisAgeDays is negative only when analysis is dated AFTER the score", () => {
  // The genuine anomaly the ⚠️ was meant to surface.
  assertEquals(analysisAgeDays(d("2025-12-30"), d("2025-12-28")), -2);
});

Deno.test("analysisAgeDays is zero for a same-day analysis", () => {
  assertEquals(analysisAgeDays(d("2025-12-28"), d("2025-12-28")), 0);
});

Deno.test("getFreshnessEmoji maps the corrected age to the #547 scale", () => {
  assertEquals(getFreshnessEmoji(0), "🌹");
  assertEquals(getFreshnessEmoji(1), "🌹");
  assertEquals(getFreshnessEmoji(2), "🌺");
  assertEquals(getFreshnessEmoji(5), "🥀"); // DD/2025-12-28 age +5
  assertEquals(getFreshnessEmoji(9), "🍁");
  assertEquals(getFreshnessEmoji(13), "🍂");
  assertEquals(getFreshnessEmoji(14), "🕸");
  assertEquals(getFreshnessEmoji(30), "🕸");
});

Deno.test("getFreshnessEmoji renders ⚠️ for a negative (after-score) age", () => {
  assertEquals(getFreshnessEmoji(-1), "⚠️");
  assertEquals(getFreshnessEmoji(-2), "⚠️");
});

Deno.test("parseAnalysisDate parses the '23 Dec 2025' format", () => {
  const parsed = parseAnalysisDate("23 Dec 2025");
  assert(parsed !== null);
  assertEquals(parsed!.getFullYear(), 2025);
  assertEquals(parsed!.getMonth(), 11);
  assertEquals(parsed!.getDate(), 23);
});

Deno.test("parseAnalysisDate returns null on garbage", () => {
  assertEquals(parseAnalysisDate("not a date"), null);
});

Deno.test("parseCSVLine respects quoted commas", () => {
  assertEquals(parseCSVLine('a,"1,100.02",b'), ["a", "1,100.02", "b"]);
});

Deno.test("computeAvgStars averages MS and normalised Tips Stars", () => {
  // DD: MS 5, Tips Stars 7 → (5 + 7/2)/2 = 4.25.
  assertEquals(computeAvgStars("5", "7"), 4.25);
});

Deno.test("computeAvgStars returns null when neither column is valid", () => {
  assertEquals(computeAvgStars("", ""), null);
  assertEquals(computeAvgStars("0", "11"), null); // out of range
});

const HEADER =
  "Stock,Date,MS Fair Value,MS,Tips Target,Tips Stars,Stars,Current Price";

Deno.test("analyseDataset: DD/2025-12-28 is healthy — age +5 → 🥀, no ⚠️", () => {
  const csv = [
    HEADER,
    "NYSE:DD,23 Dec 2025,$48.24,5,$47.45,7,4.5,$41.26",
  ].join("\n");
  const report = analyseDataset([
    { scoreDateISO: "2025-12-28", analysisCsv: csv },
  ]);
  assertEquals(report.warningRows.length, 0); // no false-positive ⚠️
  assertEquals(report.healthyRows.length, 1);
  const row = report.rows[0];
  assertEquals(row.stock, "NYSE:DD");
  assertEquals(row.ageDays, 5);
  assertEquals(row.emoji, "🥀");
  assertEquals(row.isAnomaly, false);
});

Deno.test("analyseDataset: a genuine after-score anomaly renders ⚠️", () => {
  // Analysis dated AFTER the score date is the real invariant violation — now
  // correctly surfaced as ⚠️ rather than silently shown as a freshness emoji.
  const csv = [
    HEADER,
    "NYSE:XYZ,30 Dec 2025,$10.00,4,$11.00,8,4,$9.00",
  ].join("\n");
  const report = analyseDataset([
    { scoreDateISO: "2025-12-28", analysisCsv: csv },
  ]);
  assertEquals(report.warningRows.length, 1);
  assertEquals(report.warningRows[0].ageDays, -2);
  assertEquals(report.warningRows[0].emoji, "⚠️");
  assertEquals(report.warningRows[0].isAnomaly, true);
});

Deno.test("analyseDataset: same-day analysis shows 🌹, no ⚠️", () => {
  const csv = [
    HEADER,
    "NYSE:SAME,28 Dec 2025,$10.00,4,$11.00,8,4,$9.00",
  ].join("\n");
  const report = analyseDataset([
    { scoreDateISO: "2025-12-28", analysisCsv: csv },
  ]);
  assertEquals(report.warningRows.length, 0);
  assertEquals(report.ratedRowsInWindow, 1);
  assertEquals(report.rows[0].emoji, "🌹");
});

Deno.test("analyseDataset: unrated row (no stars) is ignored entirely", () => {
  const csv = [
    HEADER,
    "NYSE:NOSTAR,23 Dec 2025,$48.24,,$47.45,,4.5,$41.26",
  ].join("\n");
  const report = analyseDataset([
    { scoreDateISO: "2025-12-28", analysisCsv: csv },
  ]);
  assertEquals(report.rows.length, 0);
  assertEquals(report.ratedRowsInWindow, 0);
});

Deno.test("analyseDataset: rows beyond the 30-day window are excluded", () => {
  const csv = [
    HEADER,
    "NYSE:OLD,18 Aug 2025,$48.24,5,$47.45,7,4.5,$41.26", // >30 days before
  ].join("\n");
  const report = analyseDataset([
    { scoreDateISO: "2025-12-28", analysisCsv: csv },
  ]);
  assertEquals(report.rows.length, 0);
  assertEquals(report.ratedRowsInWindow, 0);
});

Deno.test("analyseDataset: missing analysis CSV is skipped without error", () => {
  const report = analyseDataset([
    { scoreDateISO: "2025-12-28", analysisCsv: null },
  ]);
  assertEquals(report.scoreDatesScanned, 0);
  assertEquals(report.rows.length, 0);
});

Deno.test("analyseDataset: a realistic batch of pre-dated rows is all healthy", () => {
  // Three rated stocks all dated days BEFORE the score date (the normal case)
  // — none should render ⚠️ after the sign fix.
  const csv = [
    HEADER,
    "NYSE:DD,23 Dec 2025,$48.24,5,$47.45,7,4.5,$41.26",
    "NASDAQ:MIDD,23 Dec 2025,$166.66,5,$163.60,9,3.75,$151.11",
    "NASDAQ:PODD,11 Dec 2025,$276.82,2,$381.12,9,3,$288.63",
  ].join("\n");
  const report = analyseDataset([
    { scoreDateISO: "2025-12-28", analysisCsv: csv },
  ]);
  assertEquals(report.ratedRowsInWindow, 3);
  assertEquals(report.warningRows.length, 0);
  assertEquals(report.healthyRows.length, 3);
});
