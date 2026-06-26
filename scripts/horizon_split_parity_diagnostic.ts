// Core computation for the issue #555 market-data timing & corporate-action
// parity diagnostic (milestone #544).
//
// The training label and the dashboard agree on the 90-day horizon ROW (both
// take the last point on or before scoreDate + 90 days) and on a split-adjusted
// series. Issue #555 surfaced one historical divergence on the as-of basis: the
// dashboard restated the buy price and the model's target into CURRENT
// (end-of-series) split terms, but read the Actual horizon price RAW. When a
// reconcilable split fell between the horizon and the series end, the Actual sat
// on a different split basis than the buy price it was divided by — a forward
// split inflated Actual (masking the Target-over-Actual gap), a reverse split
// deflated it (widening the gap).
//
// Issue #569 FIXED that divergence: the shipped Actual now reads the horizon
// midpoint through horizonPriceCurrentBasis (getStockReturnBreakdown and
// currentPriceWithinWindow), so it shares the buy price's current basis. This
// module therefore now CONFIRMS the fix and guards against regressions: every
// per-stock figure is delegated to the SHIPPED kernels published on globalThis
// by docs/projection.js and docs/trend_predictions.js, so the diagnostic
// measures the dashboard's own basis, not a re-implementation. With the fix in
// place the shipped (raw-named) and current-basis Actuals coincide and the
// offset is DORMANT; were the raw read reintroduced, the offset would reappear.

import "../docs/projection.js";
import "../docs/volume_recommend.js";
import "../docs/trend_predictions.js";

// deno-lint-ignore no-explicit-any
const P = (globalThis as any).GRQProjection;
// deno-lint-ignore no-explicit-any
const TP = (globalThis as any).GRQTrendPredictions;

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

/** Summary statistics for a list of per-row basis offsets (percentage points). */
export interface OffsetSummary {
  count: number;
  mean: number;
  median: number;
  min: number;
  max: number;
  stdDev: number;
}

/** Pure stats over a list of numbers. Empty input yields an all-zero summary. */
export function summariseOffsets(values: number[]): OffsetSummary {
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

/** One matured score date's portfolio figures on both Actual bases. */
export interface DateAggregate {
  date: string;
  targetPct: number | null;
  actualRawPct: number | null;
  actualCurrentBasisPct: number | null;
  rowOffsetsPp: number[];
  /** Included rows whose horizon price carries a reconcilable post-horizon split. */
  splitAffectedRows: number;
  /** Included rows considered (denominator for the affected-row share). */
  includedRows: number;
}

// Build the per-stock inputs for one score date and compute the portfolio
// Target %, Actual % on the shipped RAW horizon basis and Actual % on the
// current (split-consistent) horizon basis, plus the per-row as-of-basis offsets
// over the INCLUDED stocks. Pure: the caller supplies already-parsed score rows
// and the market-data map.
export function aggregateDate(
  date: string,
  // deno-lint-ignore no-explicit-any
  scoreRows: any[],
  // deno-lint-ignore no-explicit-any
  marketData: Record<string, any[]>,
  // deno-lint-ignore no-explicit-any
  dividendData: Record<string, any[]>,
  scoreDate: Date,
): DateAggregate {
  const rawStocks = TP.resolvePredictionStocks(
    scoreRows,
    marketData,
    dividendData,
    scoreDate,
  );

  const rowOffsetsPp: number[] = [];
  let splitAffectedRows = 0;
  let includedRows = 0;
  // deno-lint-ignore no-explicit-any
  const currentBasisStocks = rawStocks.map((stock: any, i: number) => {
    const points = marketData[scoreRows[i].stock];
    const currentBasisMid = P.horizonPriceCurrentBasis(points, scoreDate);
    const offset = P.horizonAsOfBasisOffsetPercent(
      stock.buyPrice,
      stock.currentPrice,
      currentBasisMid,
    );
    const included = P.isStockIncluded(
      stock.buyPrice,
      stock.currentPrice,
      stock.splitReliable,
    );
    if (included) {
      includedRows++;
      if (offset !== null) {
        rowOffsetsPp.push(offset);
        if (Math.abs(offset) > 0) splitAffectedRows++;
      }
    }
    // Same stock, Actual measured on the buy price's current split basis.
    return { ...stock, currentPrice: currentBasisMid };
  });

  return {
    date,
    targetPct: P.calculatePortfolioTargetPercentage(rawStocks),
    actualRawPct: P.calculateIncludedPortfolioPerformance(rawStocks),
    actualCurrentBasisPct: P.calculateIncludedPortfolioPerformance(
      currentBasisStocks,
    ),
    rowOffsetsPp,
    splitAffectedRows,
    includedRows,
  };
}

/** The full diagnostic result over the matured historical score set. */
export interface HorizonSplitParityReport {
  maturedDates: number;
  rowCount: number;
  splitAffectedRows: number;
  meanOffsetPp: number;
  medianOffsetPp: number;
  minOffsetPp: number;
  maxOffsetPp: number;
  stdDevPp: number;
  meanTargetPct: number;
  meanActualRawPct: number;
  meanActualCurrentBasisPct: number;
  observedGapPp: number;
  gapOnCurrentBasisPp: number;
  basisContributionPp: number;
  verdict: string;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((t, v) => t + v, 0) / values.length;
}

// Assemble the report from per-date aggregates. Pure so it can be unit-tested
// with synthetic DateAggregate rows.
export function buildReport(
  aggregates: DateAggregate[],
): HorizonSplitParityReport {
  const allOffsets = aggregates.flatMap((a) => a.rowOffsetsPp);
  const stats = summariseOffsets(allOffsets);
  const splitAffectedRows = aggregates.reduce(
    (t, a) => t + a.splitAffectedRows,
    0,
  );

  const withFigures = aggregates.filter((a) =>
    a.targetPct !== null && a.actualRawPct !== null &&
    a.actualCurrentBasisPct !== null
  );
  const meanTargetPct = mean(withFigures.map((a) => a.targetPct as number));
  const meanActualRawPct = mean(
    withFigures.map((a) => a.actualRawPct as number),
  );
  const meanActualCurrentBasisPct = mean(
    withFigures.map((a) => a.actualCurrentBasisPct as number),
  );
  const observedGapPp = meanTargetPct - meanActualRawPct;
  const gapOnCurrentBasisPp = meanTargetPct - meanActualCurrentBasisPct;
  const basisContributionPp = gapOnCurrentBasisPp - observedGapPp;

  const direction = splitAffectedRows === 0
    ? "NO matured row carries a reconcilable post-horizon split, so the " +
      "as-of-basis divergence is DORMANT on the current data — it contributes " +
      "0 pp in practice"
    : `${splitAffectedRows} matured row(s) carry a reconcilable post-horizon ` +
      `split; restating their Actual onto the buy price's current split basis ` +
      `moves the observed gap by ${basisContributionPp.toFixed(3)} pp`;

  const verdict =
    `VERDICT: the horizon row and the split-adjusted series are ALIGNED ` +
    `between training and the dashboard; the only divergence is the as-of ` +
    `split basis of the Actual horizon price (read RAW) versus the buy price ` +
    `(restated to current terms). ${direction}. A forward post-horizon split ` +
    `inflates Actual (MASKING the gap); a reverse split deflates it (WIDENING ` +
    `the gap). Issue #569 landed the fix: the shipped Actual now reads the ` +
    `horizon price through horizonPriceCurrentBasis so it shares the buy ` +
    `price's basis, and this diagnostic now serves as a regression guard.`;

  return {
    maturedDates: aggregates.length,
    rowCount: stats.count,
    splitAffectedRows,
    meanOffsetPp: stats.mean,
    medianOffsetPp: stats.median,
    minOffsetPp: stats.min,
    maxOffsetPp: stats.max,
    stdDevPp: stats.stdDev,
    meanTargetPct,
    meanActualRawPct,
    meanActualCurrentBasisPct,
    observedGapPp,
    gapOnCurrentBasisPp,
    basisContributionPp,
    verdict,
  };
}

interface ScoreIndexEntry {
  file: string;
  date: string;
}

// Load the matured score set from disk and compute the full diagnostic.
// A score date is "matured" once its full 90-day window has elapsed by `asOf`.
export async function computeHorizonSplitParityDiagnostic(
  docsPath: string,
  asOf: Date,
): Promise<HorizonSplitParityReport> {
  const indexText = await Deno.readTextFile(`${docsPath}/scores/index.json`);
  const index = JSON.parse(indexText) as { scores: ScoreIndexEntry[] };

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
    const dividendData = TP.parseDividendCsv(divText);
    aggregates.push(
      aggregateDate(
        entry.date,
        scoreRows,
        marketData,
        dividendData,
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
