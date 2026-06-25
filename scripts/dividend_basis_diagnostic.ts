// Core computation for the issue #553 dividend-basis diagnostic.
//
// Quantifies the Target/Actual bias that comes from the DIVIDEND basis mismatch
// between training and the dashboard:
//
//   - Training (GRQ/src/LearnUtil.ts:147-148) bakes a FLAT quarter of the
//     trailing annual dividend, `core.yearOfDividends / 4`, into the
//     total-return label for EVERY stock, whether or not a dividend actually
//     falls in the forward window.
//   - The dashboard/validation side credits only the ACTUAL ex-dividends that
//     fall inside the 90-day window
//     (GRQ-validation/src/utils.rs `calculate_dividends_for_period`, mirrored on
//     the JS side by `filterDividendsWithin90Days` + `sumDividends`).
//
// Splits the pure aggregation (testable with synthetic rows, no disk) from the
// file IO. Every per-stock figure is delegated to the SHIPPED kernels published
// on globalThis by docs/projection.js and docs/trend_predictions.js, so the
// windowed credit measured here is exactly the dashboard's own credit rather
// than a re-implementation.

import "../docs/projection.js";
import "../docs/trend_predictions.js";

// deno-lint-ignore no-explicit-any
const P = (globalThis as any).GRQProjection;
// deno-lint-ignore no-explicit-any
const TP = (globalThis as any).GRQTrendPredictions;

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

/** Summary statistics for a list of per-row differences (percentage points). */
export interface DiffSummary {
  count: number;
  mean: number;
  median: number;
  min: number;
  max: number;
  stdDev: number;
}

/** Pure stats over a list of numbers. Empty input yields all-zero summary. */
export function summariseDiffs(values: number[]): DiffSummary {
  const finite = values.filter((v) =>
    typeof v === "number" && !Number.isNaN(v)
  );
  if (finite.length === 0) {
    return { count: 0, mean: 0, median: 0, min: 0, max: 0, stdDev: 0 };
  }
  const sorted = [...finite].sort((a, b) => a - b);
  const sum = finite.reduce((t, v) => t + v, 0);
  const mean = sum / finite.length;
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
  const variance = finite.reduce((t, v) => t + (v - mean) ** 2, 0) /
    finite.length;
  return {
    count: finite.length,
    mean,
    median,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    stdDev: Math.sqrt(variance),
  };
}

// Strip an exchange prefix and normalise dots to hyphens, mirroring the Rust
// `extract_symbol_from_ticker` so a score ticker ("NYSE:SEM", "HEI.A") maps to
// the per-ticker dividend-history filename ("SEM", "HEI-A").
export function stripSymbol(ticker: string): string {
  const idx = ticker.lastIndexOf(":");
  const sym = idx >= 0 ? ticker.slice(idx + 1) : ticker;
  return sym.replace(/\./g, "-");
}

/** One matured score date's per-row dividend-basis differences. */
export interface DateAggregate {
  date: string;
  /** Per included row: (flatCredit - windowedCredit) / buyPrice * 100. */
  rowDiffsPp: number[];
  /** Per included row: flat training credit as a % of buy price. */
  flatYieldsPct: number[];
  /** Per included row: realised in-window credit as a % of buy price. */
  windowedYieldsPct: number[];
  /** Included rows where the realised in-window dividend was exactly 0. */
  windowedZeroCount: number;
  /** Total included rows contributing to the figures above. */
  includedCount: number;
}

// Build the per-row dividend-basis differences for one score date. Pure: the
// caller supplies already-parsed score rows, the market-data map, the COMMITTED
// in-window dividend map (the dashboard's Actual source), and the FULL trailing
// dividend history keyed by stripped symbol (the training-credit source).
export function aggregateDate(
  date: string,
  // deno-lint-ignore no-explicit-any
  scoreRows: any[],
  // deno-lint-ignore no-explicit-any
  marketData: Record<string, any[]>,
  // deno-lint-ignore no-explicit-any
  windowedDividends: Record<string, any[]>,
  // deno-lint-ignore no-explicit-any
  fullHistory: Record<string, any[]>,
  scoreDate: Date,
): DateAggregate {
  // Shipped resolver: gives buyPrice, currentPrice, splitReliable and the
  // realised in-window `totalDividends` — exactly the dashboard's Actual credit.
  const stocks = TP.resolvePredictionStocks(
    scoreRows,
    marketData,
    windowedDividends,
    scoreDate,
  );

  const rowDiffsPp: number[] = [];
  const flatYieldsPct: number[] = [];
  const windowedYieldsPct: number[] = [];
  let windowedZeroCount = 0;
  let includedCount = 0;

  // deno-lint-ignore no-explicit-any
  stocks.forEach((stock: any, i: number) => {
    if (
      !P.isStockIncluded(
        stock.buyPrice,
        stock.currentPrice,
        stock.splitReliable,
      )
    ) {
      return;
    }
    includedCount += 1;

    const history = fullHistory[stripSymbol(scoreRows[i].stock)] || [];
    const flatCredit = P.trailingAnnualDividends(history, scoreDate) / 4;
    const windowedCredit = stock.totalDividends || 0;

    const diff = P.dividendBasisDifferencePercent(
      flatCredit,
      windowedCredit,
      stock.buyPrice,
    );
    if (diff === null) {
      return;
    }
    rowDiffsPp.push(diff);
    flatYieldsPct.push((flatCredit / stock.buyPrice) * 100);
    windowedYieldsPct.push((windowedCredit / stock.buyPrice) * 100);
    if (windowedCredit === 0) {
      windowedZeroCount += 1;
    }
  });

  return {
    date,
    rowDiffsPp,
    flatYieldsPct,
    windowedYieldsPct,
    windowedZeroCount,
    includedCount,
  };
}

/** The full diagnostic result over the matured historical score set. */
export interface DividendBasisReport {
  maturedDates: number;
  rowCount: number;
  meanDiffPp: number;
  medianDiffPp: number;
  minDiffPp: number;
  maxDiffPp: number;
  stdDevPp: number;
  /** Mean after dropping the most extreme `trimFraction` of each tail. */
  trimmedMeanDiffPp: number;
  /** Share of included rows whose difference sits within +/-1 pp. */
  within1ppSharePct: number;
  meanFlatYieldPct: number;
  meanWindowedYieldPct: number;
  windowedZeroSharePct: number;
  /** Equal-weight per-row mean difference == portfolio-level gap contribution. */
  contributionPp: number;
  verdict: string;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((t, v) => t + v, 0) / values.length;
}

// Mean after dropping the most extreme `trimFraction` of values at EACH tail.
// The raw per-row mean is dominated by a handful of special/liquidating
// distributions on low-priced stocks (e.g. EQC, ELME, VISN), so a trimmed mean
// reports the robust central tendency alongside the lumpy raw figure.
export function trimmedMean(values: number[], trimFraction: number): number {
  const finite = values
    .filter((v) => typeof v === "number" && !Number.isNaN(v))
    .sort((a, b) => a - b);
  if (finite.length === 0) return 0;
  const k = Math.floor(finite.length * trimFraction);
  const kept = finite.slice(k, finite.length - k);
  return mean(kept.length > 0 ? kept : finite);
}

// Assemble the report from per-date aggregates. Pure so it can be unit-tested
// with synthetic DateAggregate rows.
export function buildReport(aggregates: DateAggregate[]): DividendBasisReport {
  const allDiffs = aggregates.flatMap((a) => a.rowDiffsPp);
  const stats = summariseDiffs(allDiffs);

  const meanFlatYieldPct = mean(aggregates.flatMap((a) => a.flatYieldsPct));
  const meanWindowedYieldPct = mean(
    aggregates.flatMap((a) => a.windowedYieldsPct),
  );
  const totalIncluded = aggregates.reduce((t, a) => t + a.includedCount, 0);
  const totalWindowedZero = aggregates.reduce(
    (t, a) => t + a.windowedZeroCount,
    0,
  );
  const windowedZeroSharePct = totalIncluded === 0
    ? 0
    : (totalWindowedZero / totalIncluded) * 100;

  const trimmedMeanDiffPp = trimmedMean(allDiffs, 0.01);
  const within1ppSharePct = stats.count === 0
    ? 0
    : (allDiffs.filter((d) => Math.abs(d) <= 1).length / stats.count) * 100;

  // Under equal weighting the mean per-row (flat - windowed)/buy difference IS
  // the amount the dividend basis moves the Target-over-Actual gap: Target
  // carries the flat credit, Actual carries the windowed credit.
  const contributionPp = stats.mean;
  const direction = contributionPp >= 0
    ? "CONTRIBUTES to (widens)"
    : "OFFSETS (narrows)";

  const verdict =
    `VERDICT: the flat training credit (yearOfDividends / 4) exceeds the ` +
    `realised in-window dividends by a mean ${stats.mean.toFixed(3)} pp of ` +
    `buy price (median ${stats.median.toFixed(3)} pp; 1%-trimmed mean ` +
    `${trimmedMeanDiffPp.toFixed(3)} pp). Because Target embeds the flat ` +
    `credit while Actual credits only realised in-window dividends, this ` +
    `dividend basis ${direction} the Target-over-Actual gap by ` +
    `${Math.abs(contributionPp).toFixed(3)} pp. ` +
    `${windowedZeroSharePct.toFixed(1)}% of included rows realised ZERO ` +
    `in-window dividends yet still receive the flat quarter in training (the ` +
    `same-direction driver), but the raw mean is lumpy: ` +
    `${within1ppSharePct.toFixed(1)}% of rows fall within +/-1 pp and the ` +
    `mean is dominated by a few special/liquidating distributions on ` +
    `low-priced stocks, so the robust contribution is the smaller trimmed mean.`;

  return {
    maturedDates: aggregates.length,
    rowCount: stats.count,
    meanDiffPp: stats.mean,
    medianDiffPp: stats.median,
    minDiffPp: stats.min,
    maxDiffPp: stats.max,
    stdDevPp: stats.stdDev,
    trimmedMeanDiffPp,
    within1ppSharePct,
    meanFlatYieldPct,
    meanWindowedYieldPct,
    windowedZeroSharePct,
    contributionPp,
    verdict,
  };
}

interface ScoreIndexEntry {
  file: string;
  date: string;
}

interface DividendHistoryRecord {
  ex_dividend_date?: string;
  amount?: string | number;
}

// Load one ticker's FULL dividend history from the GRQ-dividends tree
// (../GRQ-dividends/data/<L>/<SYM>.json) into the { exDivDate, amount } shape the
// kernels consume. Returns [] when the file is absent or unparseable so a ticker
// with no published history simply contributes a 0 flat credit.
async function loadDividendHistory(
  dividendsRoot: string,
  strippedSymbol: string,
): Promise<{ exDivDate: Date; amount: number }[]> {
  if (!strippedSymbol) return [];
  const letter = strippedSymbol.charAt(0).toUpperCase();
  const path = `${dividendsRoot}/data/${letter}/${strippedSymbol}.json`;
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch {
    return [];
  }
  let parsed: { data?: DividendHistoryRecord[] };
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const records = Array.isArray(parsed.data) ? parsed.data : [];
  const out: { exDivDate: Date; amount: number }[] = [];
  for (const r of records) {
    if (!r || typeof r.ex_dividend_date !== "string") continue;
    const amount = typeof r.amount === "number"
      ? r.amount
      : parseFloat(String(r.amount));
    if (Number.isNaN(amount)) continue;
    out.push({
      exDivDate: P.setDateToMidnight(new Date(r.ex_dividend_date)),
      amount,
    });
  }
  return out;
}

// Load the matured score set from disk and compute the full diagnostic.
// A score date is "matured" once its full 90-day window has elapsed by `asOf`.
// `dividendsRoot` points at the GRQ-dividends history tree (default
// "../GRQ-dividends", matching src/utils.rs DIVIDEND_DATA_BASE_PATH).
export async function computeDividendBasisDiagnostic(
  docsPath: string,
  asOf: Date,
  dividendsRoot = "../GRQ-dividends",
): Promise<DividendBasisReport> {
  const indexText = await Deno.readTextFile(`${docsPath}/scores/index.json`);
  const index = JSON.parse(indexText) as { scores: ScoreIndexEntry[] };

  const historyCache = new Map<string, { exDivDate: Date; amount: number }[]>();

  const aggregates: DateAggregate[] = [];
  for (const entry of index.scores) {
    const scoreDate = TP.parseScoreDateString(entry.date);
    if (asOf.getTime() < scoreDate.getTime() + NINETY_DAYS_MS) {
      continue; // window not yet complete — not matured
    }
    const base = `${docsPath}/scores/${entry.file.replace(/\.tsv$/, "")}`;
    const tsvText = await readOptional(`${base}.tsv`);
    if (!tsvText.trim()) {
      continue; // index references a date with no generated score file
    }
    const csvText = await readOptional(`${base}.csv`);
    const divText = await readOptional(`${base}-dividends.csv`);

    const scoreRows = TP.parseScoreTsv(tsvText);
    const marketData = TP.parseMarketCsv(csvText);
    const windowedDividends = TP.parseDividendCsv(divText);

    // Full trailing history per ticker on this date (cached across dates).
    // deno-lint-ignore no-explicit-any
    const fullHistory: Record<string, any[]> = {};
    for (const row of scoreRows) {
      const sym = stripSymbol(row.stock);
      if (!historyCache.has(sym)) {
        historyCache.set(sym, await loadDividendHistory(dividendsRoot, sym));
      }
      fullHistory[sym] = historyCache.get(sym) as {
        exDivDate: Date;
        amount: number;
      }[];
    }

    aggregates.push(
      aggregateDate(
        entry.date,
        scoreRows,
        marketData,
        windowedDividends,
        fullHistory,
        scoreDate,
      ),
    );
  }

  return buildReport(aggregates);
}

async function readOptional(path: string): Promise<string> {
  try {
    return await Deno.readTextFile(path);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return "";
    throw err;
  }
}
