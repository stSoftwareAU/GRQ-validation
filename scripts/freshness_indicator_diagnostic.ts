// Core computation for the issue #587 fair-value freshness-indicator diagnostic.
//
// DIAGNOSE-ONLY: this module reproduces the SHIPPED dashboard logic and
// quantifies why the ⚠️ freshness indicator (issue #547,
// `getFreshnessIndicator()` in docs/app.js) fires. It deliberately does NOT
// change the dashboard's behaviour — the fix is a separate, later issue.
//
// The question (worked example DD / 2025-12-28):
//   - `getFreshnessIndicator()` returns '⚠️' when `signedDaysFromScore < 0`
//     (docs/app.js ~line 933).
//   - `signedDaysFromScore = floor(analysisDate − scoreDate)` in whole days
//     (docs/app.js ~line 731) — so it is negative when the analysis row is
//     dated *earlier* than the score date.
//   - The inline comments (docs/app.js ~lines 727-729, 921-922) instead say
//     negative means the analysis is dated *after* the score date, "an
//     invariant the pipeline must never violate".
//
// The comment and the arithmetic disagree on the SIGN. This module settles the
// direction and quantifies the blast radius across every score date.
//
// Root cause (see docs/fixes/freshness-indicator-sign-investigation.md): a
// fair-value analysis is, in the normal case, dated *before* the score date —
// the analyst's fair value pre-exists the score that consumes it. So
// `analysisDate − scoreDate` is normally NEGATIVE for healthy data, which trips
// the `< 0` ⚠️ guard for essentially every rated stock. The intended "analysis
// age" the emoji scale (0-1 🌹 … 14+ 🕸) measures is the OPPOSITE sign,
// `scoreDate − analysisDate` (how many whole days old the analysis is at score
// time). The arithmetic has the sign inverted relative to the documented
// invariant, so DD/2025-12-28's ⚠️ is a FALSE POSITIVE, not a mis-dated row.

const ONE_DAY_MS = 1000 * 60 * 60 * 24;
const WINDOW_DAYS = 30; // app.js keeps analyses within 30 days of the score date

/** Faithful port of the CSV splitter in docs/app.js (`parseCSVLine`). */
export function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Faithful port of `parseAnalysisDate` in docs/app.js for the "23 Dec 2025"
 * format. Returns a local-midnight Date, or null when unparseable.
 */
export function parseAnalysisDate(dateStr: string): Date | null {
  const months: Record<string, number> = {
    Jan: 0,
    Feb: 1,
    Mar: 2,
    Apr: 3,
    May: 4,
    Jun: 5,
    Jul: 6,
    Aug: 7,
    Sep: 8,
    Oct: 9,
    Nov: 10,
    Dec: 11,
  };
  const match = dateStr.match(/(\d{1,2})\s+(\w{3})\s+(\d{4})/);
  if (match) {
    const day = parseInt(match[1], 10);
    const month = months[match[2]];
    const year = parseInt(match[3], 10);
    if (month !== undefined) {
      return new Date(year, month, day);
    }
  }
  return null;
}

/**
 * The dashboard's signed analysis age, exactly as shipped (docs/app.js):
 *   floor((analysisDate − scoreDate) / oneDay).
 * Negative when the analysis is dated EARLIER than the score date.
 */
export function signedDaysFromScore(
  analysisDate: Date,
  scoreDate: Date,
): number {
  return Math.floor(
    (analysisDate.getTime() - scoreDate.getTime()) / ONE_DAY_MS,
  );
}

/**
 * The INTENDED analysis age the emoji scale and the documented invariant
 * assume: how many whole days OLD the analysis is at score time:
 *   floor((scoreDate − analysisDate) / oneDay).
 * Non-negative for the normal case (analysis published on/before the score
 * date); negative only when an analysis is dated AFTER the score date — the
 * genuine "impossible" anomaly the ⚠️ was meant to surface.
 */
export function intendedAnalysisAgeDays(
  analysisDate: Date,
  scoreDate: Date,
): number {
  return Math.floor(
    (scoreDate.getTime() - analysisDate.getTime()) / ONE_DAY_MS,
  );
}

/** Whether the shipped indicator would render ⚠️ for this signed age. */
export function shippedShowsWarning(signed: number): boolean {
  return signed < 0;
}

/**
 * Port of the dashboard's average-star computation (docs/app.js
 * `loadAnalysisData`): MS column (valid 1-5) averaged with Tips Stars (valid
 * 1-10, normalised /2). Returns null when neither contributes — in which case
 * `getFreshnessIndicator` shows no emoji at all (and no ⚠️).
 */
export function computeAvgStars(
  msRaw: string | undefined,
  tipsStarsRaw: string | undefined,
): number | null {
  let total = 0;
  let valid = 0;
  const ms = msRaw ? parseFloat(msRaw) : NaN;
  if (!Number.isNaN(ms) && ms >= 1 && ms <= 5) {
    total += ms;
    valid++;
  }
  const tips = tipsStarsRaw ? parseFloat(tipsStarsRaw) : NaN;
  if (!Number.isNaN(tips) && tips >= 1 && tips <= 10) {
    total += tips / 2;
    valid++;
  }
  return valid > 0 ? total / valid : null;
}

/** A single stock-date row that the shipped indicator flags with ⚠️. */
export interface WarningRow {
  scoreDate: string; // YYYY-MM-DD
  stock: string;
  analysisDate: string; // YYYY-MM-DD
  signedDaysFromScore: number; // shipped (negative ⇒ ⚠️)
  intendedAgeDays: number; // corrected sign (≥ 0 for healthy data)
  /** False positive ⇒ analysis legitimately predates the score date. */
  classification: "false-positive" | "real-anomaly";
}

/** Aggregate blast-radius report. */
export interface FreshnessReport {
  scoreDatesScanned: number;
  ratedRowsInWindow: number; // rows with avgStars≠null inside the 30-day window
  warningRows: WarningRow[]; // every stock-date the shipped ⚠️ fires on
  falsePositives: number; // analysis dated before the score date
  realAnomalies: number; // ⚠️ rows that are genuine (always 0 — see below)
  /**
   * The DUAL failure mode: rated, in-window rows whose analysis is dated AFTER
   * the score date — the genuine invariant violation the ⚠️ was meant to
   * surface — which the inverted-sign guard renders as a freshness EMOJI
   * instead of ⚠️. The shipped indicator is silent on exactly the case it was
   * built to catch.
   */
  missedAnomalyRows: WarningRow[];
}

interface ScoreIndexEntry {
  file: string; // e.g. "2025/December/28.tsv"
  date: string; // e.g. "2025-12-28"
}

function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Classify every analysis row across the dataset and collect the blast radius.
 * Pure: callers inject the per-score-date analysis CSV text so this is fully
 * unit-testable without disk access. `scoreDate` is parsed from the index entry
 * date string (local midnight) to mirror the dashboard's `getScoreDate`.
 */
export function analyseDataset(
  entries: ReadonlyArray<{ scoreDateISO: string; analysisCsv: string | null }>,
): FreshnessReport {
  const warningRows: WarningRow[] = [];
  const missedAnomalyRows: WarningRow[] = [];
  let ratedRowsInWindow = 0;
  let scoreDatesScanned = 0;

  for (const entry of entries) {
    if (!entry.analysisCsv || !entry.analysisCsv.trim()) continue;
    scoreDatesScanned++;
    const [y, m, d] = entry.scoreDateISO.split("-").map((n) => parseInt(n, 10));
    const scoreDate = new Date(y, m - 1, d); // local midnight, like getScoreDate

    const lines = entry.analysisCsv.trim().split("\n");
    if (lines.length < 2) continue;
    const headers = lines[0].split(",").map((h) => h.trim().replace(/"/g, ""));
    const stockIndex = headers.indexOf("Stock");
    const dateIndex = headers.indexOf("Date");
    const msIndex = headers.indexOf("MS");
    const tipsStarsIndex = headers.indexOf("Tips Stars");
    if (stockIndex === -1 || dateIndex === -1) continue;

    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]);
      const stock = values[stockIndex]?.trim();
      const dateStr = values[dateIndex]?.trim();
      if (!stock || !dateStr) continue;
      const analysisDate = parseAnalysisDate(dateStr);
      if (!analysisDate) continue;

      const daysDiff = Math.abs(
        (analysisDate.getTime() - scoreDate.getTime()) / ONE_DAY_MS,
      );
      if (daysDiff > WINDOW_DAYS) continue; // dashboard's 30-day window filter

      const avgStars = computeAvgStars(
        msIndex !== -1 ? values[msIndex] : undefined,
        tipsStarsIndex !== -1 ? values[tipsStarsIndex] : undefined,
      );
      if (avgStars === null) continue; // no stars ⇒ getFreshnessIndicator() = ''
      ratedRowsInWindow++;

      const signed = signedDaysFromScore(analysisDate, scoreDate);
      const intended = intendedAnalysisAgeDays(analysisDate, scoreDate);
      const row: WarningRow = {
        scoreDate: entry.scoreDateISO,
        stock,
        analysisDate: toISO(analysisDate),
        signedDaysFromScore: signed,
        intendedAgeDays: intended,
        // Intended age ≥ 0 ⇒ analysis predates the score ⇒ healthy ⇒ false ⚠️.
        classification: intended >= 0 ? "false-positive" : "real-anomaly",
      };

      if (shippedShowsWarning(signed)) {
        warningRows.push(row); // shipped renders ⚠️ here
      } else if (intended < 0) {
        // Genuine anomaly (analysis after the score) the indicator MISSES.
        missedAnomalyRows.push(row);
      }
    }
  }

  return {
    scoreDatesScanned,
    ratedRowsInWindow,
    warningRows,
    missedAnomalyRows,
    falsePositives:
      warningRows.filter((r) => r.classification === "false-positive").length,
    realAnomalies:
      warningRows.filter((r) => r.classification === "real-anomaly").length,
  };
}

/**
 * Disk-backed sweep: read docs/scores/index.json and every per-date analysis
 * CSV, then delegate to `analyseDataset`. Read-only.
 */
export async function computeFreshnessDiagnostic(
  docsPath = "docs",
): Promise<FreshnessReport> {
  const indexText = await Deno.readTextFile(`${docsPath}/scores/index.json`);
  const index = JSON.parse(indexText) as { scores: ScoreIndexEntry[] };

  const entries: { scoreDateISO: string; analysisCsv: string | null }[] = [];
  for (const entry of index.scores) {
    const base = `${docsPath}/scores/${entry.file.replace(/\.tsv$/, "")}`;
    const analysisCsv = await readOptional(`${base}-analysis.csv`);
    entries.push({ scoreDateISO: entry.date, analysisCsv });
  }
  return analyseDataset(entries);
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await Deno.readTextFile(path);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null;
    throw err;
  }
}
