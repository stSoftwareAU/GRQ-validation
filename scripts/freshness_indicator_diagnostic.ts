// Regression port of the fair-value freshness indicator (issue #547),
// pinning the sign fix from issue #600.
//
// This module is a faithful, pure port of the CORRECTED `getFreshnessIndicator`
// logic in docs/app.js: it mirrors the dashboard's analysis-age arithmetic and
// emoji scale so the sign can be regression-tested without a browser.
//
// Background (diagnosed in #587, fixed in #600): the shipped dashboard computed
// the analysis age as `floor(analysisDate − scoreDate)`, which is NEGATIVE for
// healthy data — a fair-value analysis is normally dated *before* the score that
// consumes it (e.g. DD analysis 23 Dec 2025 vs score 28 Dec 2025 → −5). That
// tripped the `< 0 → ⚠️` guard for essentially every rated stock, and silently
// MISSED the genuine anomaly (analysis dated *after* the score).
//
// The corrected age is the opposite sign, `floor(scoreDate − analysisDate)`:
// how many whole days OLD the analysis is at score time. It is ≥ 0 for healthy
// data and negative ONLY when an analysis is dated AFTER its score date — the
// real pipeline anomaly the ⚠️ was built to surface. This module models that
// corrected behaviour.

const ONE_DAY_MS = 1000 * 60 * 60 * 24;
const WINDOW_DAYS = 30; // app.js keeps analyses within 30 days of the score date

/** Ascending [threshold, emoji] pairs — pick the largest threshold ≤ age. */
const FRESHNESS_SCALE: ReadonlyArray<readonly [number, string]> = [
  [0, "🌹"],
  [2, "🌺"],
  [4, "🥀"],
  [7, "🍁"],
  [10, "🍂"],
  [14, "🕸"],
];

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
 * Corrected whole-day analysis age, matching docs/app.js `signedDaysFromScore`
 * after the issue #600 fix:
 *   floor((scoreDate − analysisDate) / oneDay).
 * ≥ 0 for healthy data (analysis dated on/before the score date); negative ONLY
 * when an analysis is dated AFTER its score date — the genuine anomaly the ⚠️
 * indicator was built to surface.
 */
export function analysisAgeDays(
  analysisDate: Date,
  scoreDate: Date,
): number {
  return Math.floor(
    (scoreDate.getTime() - analysisDate.getTime()) / ONE_DAY_MS,
  );
}

/**
 * Port of the dashboard's `getFreshnessIndicator` emoji selection: a negative
 * age (analysis dated after the score) renders ⚠️; otherwise pick the freshness
 * emoji for the largest threshold ≤ age.
 */
export function getFreshnessEmoji(ageDays: number): string {
  if (ageDays < 0) {
    return "⚠️";
  }
  let emoji = FRESHNESS_SCALE[0][1];
  for (const [threshold, candidate] of FRESHNESS_SCALE) {
    if (ageDays >= threshold) {
      emoji = candidate;
    } else {
      break;
    }
  }
  return emoji;
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

/** A single rated stock-date row and the freshness indicator it renders. */
export interface FreshnessRow {
  scoreDate: string; // YYYY-MM-DD
  stock: string;
  analysisDate: string; // YYYY-MM-DD
  ageDays: number; // corrected age: ≥ 0 healthy, < 0 only when after score
  emoji: string; // freshness emoji, or ⚠️ for a genuine anomaly
  /** True when the analysis is dated AFTER its score date (renders ⚠️). */
  isAnomaly: boolean;
}

/** Aggregate freshness report under the corrected sign. */
export interface FreshnessReport {
  scoreDatesScanned: number;
  ratedRowsInWindow: number; // rows with avgStars≠null inside the 30-day window
  rows: FreshnessRow[]; // every rated, in-window row with its indicator
  warningRows: FreshnessRow[]; // rows rendering ⚠️ — genuine after-score anomalies
  healthyRows: FreshnessRow[]; // rows rendering a freshness emoji (no ⚠️)
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
 * Classify every rated analysis row across the dataset under the corrected
 * sign. Pure: callers inject the per-score-date analysis CSV text so this is
 * fully unit-testable without disk access. `scoreDate` is parsed from the index
 * entry date string (local midnight) to mirror the dashboard's `getScoreDate`.
 */
export function analyseDataset(
  entries: ReadonlyArray<{ scoreDateISO: string; analysisCsv: string | null }>,
): FreshnessReport {
  const rows: FreshnessRow[] = [];
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

      const ageDays = analysisAgeDays(analysisDate, scoreDate);
      rows.push({
        scoreDate: entry.scoreDateISO,
        stock,
        analysisDate: toISO(analysisDate),
        ageDays,
        emoji: getFreshnessEmoji(ageDays),
        isAnomaly: ageDays < 0,
      });
    }
  }

  return {
    scoreDatesScanned,
    ratedRowsInWindow,
    rows,
    warningRows: rows.filter((r) => r.isAnomaly),
    healthyRows: rows.filter((r) => !r.isAnomaly),
  };
}

/**
 * Disk-backed sweep: read docs/scores/index.json and every per-date analysis
 * CSV, then delegate to `analyseDataset`. Read-only.
 */
export async function computeFreshnessReport(
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
