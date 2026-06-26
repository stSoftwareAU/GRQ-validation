// Tests for the issue #587 fair-value freshness ⚠️ diagnostic.
//
// These exercise the REAL diagnostic functions (no source grepping): they feed
// known analysis CSV text and assert on the classification and blast-radius
// counts, pinning the root-cause finding that the shipped `signedDaysFromScore`
// sign is inverted relative to the documented invariant.

import { assert, assertEquals } from "@std/assert";
import {
  analyseDataset,
  computeAvgStars,
  intendedAnalysisAgeDays,
  parseAnalysisDate,
  parseCSVLine,
  signedDaysFromScore,
} from "../scripts/freshness_indicator_diagnostic.ts";

const d = (iso: string) => {
  const [y, m, day] = iso.split("-").map((n) => parseInt(n, 10));
  return new Date(y, m - 1, day);
};

Deno.test("signedDaysFromScore is negative when analysis predates the score", () => {
  // DD worked example: analysis 23 Dec, score 28 Dec → 5 days BEFORE.
  assertEquals(signedDaysFromScore(d("2025-12-23"), d("2025-12-28")), -5);
});

Deno.test("intendedAnalysisAgeDays is the opposite sign (age at score time)", () => {
  // The intended freshness age the emoji scale assumes: +5 days old.
  assertEquals(intendedAnalysisAgeDays(d("2025-12-23"), d("2025-12-28")), 5);
});

Deno.test("intended age is negative only when analysis is dated AFTER the score", () => {
  // The genuine anomaly the ⚠️ was meant to surface.
  assertEquals(intendedAnalysisAgeDays(d("2025-12-30"), d("2025-12-28")), -2);
  assertEquals(signedDaysFromScore(d("2025-12-30"), d("2025-12-28")), 2);
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

Deno.test("analyseDataset flags DD/2025-12-28 as a false positive", () => {
  const csv = [
    HEADER,
    "NYSE:DD,23 Dec 2025,$48.24,5,$47.45,7,4.5,$41.26",
  ].join("\n");
  const report = analyseDataset([
    { scoreDateISO: "2025-12-28", analysisCsv: csv },
  ]);
  assertEquals(report.warningRows.length, 1);
  const row = report.warningRows[0];
  assertEquals(row.stock, "NYSE:DD");
  assertEquals(row.signedDaysFromScore, -5);
  assertEquals(row.intendedAgeDays, 5);
  assertEquals(row.classification, "false-positive");
  assertEquals(report.falsePositives, 1);
  assertEquals(report.realAnomalies, 0);
});

Deno.test("analyseDataset: a genuine after-score anomaly is MISSED, not flagged", () => {
  // Analysis dated AFTER the score date is the real invariant violation, yet
  // the inverted-sign guard gives it a positive signed age → emoji, not ⚠️.
  const csv = [
    HEADER,
    "NYSE:XYZ,30 Dec 2025,$10.00,4,$11.00,8,4,$9.00",
  ].join("\n");
  const report = analyseDataset([
    { scoreDateISO: "2025-12-28", analysisCsv: csv },
  ]);
  assertEquals(report.warningRows.length, 0); // no ⚠️ rendered
  assertEquals(report.missedAnomalyRows.length, 1);
  assertEquals(report.missedAnomalyRows[0].intendedAgeDays, -2);
  assertEquals(report.realAnomalies, 0);
});

Deno.test("analyseDataset: same-day analysis shows NO warning", () => {
  const csv = [
    HEADER,
    "NYSE:SAME,28 Dec 2025,$10.00,4,$11.00,8,4,$9.00",
  ].join("\n");
  const report = analyseDataset([
    { scoreDateISO: "2025-12-28", analysisCsv: csv },
  ]);
  assertEquals(report.warningRows.length, 0);
  assertEquals(report.ratedRowsInWindow, 1);
});

Deno.test("analyseDataset: unrated row (no stars) is ignored entirely", () => {
  const csv = [
    HEADER,
    "NYSE:NOSTAR,23 Dec 2025,$48.24,,$47.45,,4.5,$41.26",
  ].join("\n");
  const report = analyseDataset([
    { scoreDateISO: "2025-12-28", analysisCsv: csv },
  ]);
  assertEquals(report.warningRows.length, 0);
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
  assertEquals(report.warningRows.length, 0);
  assertEquals(report.ratedRowsInWindow, 0);
});

Deno.test("analyseDataset: missing analysis CSV is skipped without error", () => {
  const report = analyseDataset([
    { scoreDateISO: "2025-12-28", analysisCsv: null },
  ]);
  assertEquals(report.scoreDatesScanned, 0);
  assertEquals(report.warningRows.length, 0);
});

Deno.test("analyseDataset: the false-positive case dominates a realistic batch", () => {
  // Three rated stocks all dated days BEFORE the score date (the normal case).
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
  assertEquals(report.warningRows.length, 3);
  assertEquals(report.falsePositives, 3);
  assertEquals(report.realAnomalies, 0);
});
