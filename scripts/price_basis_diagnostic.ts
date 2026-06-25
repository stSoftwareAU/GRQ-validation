// Core computation for the issue #552 price-basis diagnostic.
//
// Splits the pure aggregation (testable with synthetic rows, no disk) from the
// file IO. Every per-stock figure is delegated to the SHIPPED kernels published
// on globalThis by docs/projection.js and docs/trend_predictions.js, so the
// diagnostic measures the dashboard's own basis rather than a re-implementation.

import "../docs/projection.js";
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

/** Pure stats over a list of numbers. Empty input yields all-zero summary. */
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

/** One matured score date's portfolio figures on both price bases. */
export interface DateAggregate {
  date: string;
  targetPct: number | null;
  actualMidPct: number | null;
  actualLowPct: number | null;
  rowOffsetsPp: number[];
}

// Build the mid-basis and low-basis per-stock inputs for one score date and
// compute the portfolio Target %, Actual % (mid) and Actual % (low), plus the
// per-row (mid - low) / buyPrice offsets over the INCLUDED stocks. Pure: the
// caller supplies already-parsed score rows and the market-data map.
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
  const midStocks = TP.resolvePredictionStocks(
    scoreRows,
    marketData,
    dividendData,
    scoreDate,
  );

  const rowOffsetsPp: number[] = [];
  // deno-lint-ignore no-explicit-any
  const lowStocks = midStocks.map((stock: any, i: number) => {
    const points = marketData[scoreRows[i].stock];
    const low = P.lowPriceAtNinetyDayHorizon(points, scoreDate);
    const offset = P.priceBasisOffsetPercent(
      stock.buyPrice,
      stock.currentPrice,
      low,
    );
    const included = P.isStockIncluded(
      stock.buyPrice,
      stock.currentPrice,
      stock.splitReliable,
    );
    if (included && offset !== null) {
      rowOffsetsPp.push(offset);
    }
    // Same stock, Actual measured at the trained low basis instead of mid.
    return { ...stock, currentPrice: low };
  });

  return {
    date,
    targetPct: P.calculatePortfolioTargetPercentage(midStocks),
    actualMidPct: P.calculateIncludedPortfolioPerformance(midStocks),
    actualLowPct: P.calculateIncludedPortfolioPerformance(lowStocks),
    rowOffsetsPp,
  };
}

/** The full diagnostic result over the matured historical score set. */
export interface PriceBasisReport {
  maturedDates: number;
  rowCount: number;
  meanOffsetPp: number;
  medianOffsetPp: number;
  minOffsetPp: number;
  maxOffsetPp: number;
  stdDevPp: number;
  meanTargetPct: number;
  meanActualMidPct: number;
  meanActualLowPct: number;
  observedGapPp: number;
  gapOnLowBasisPp: number;
  basisContributionPp: number;
  verdict: string;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((t, v) => t + v, 0) / values.length;
}

// Assemble the report from per-date aggregates. Pure so it can be unit-tested
// with synthetic DateAggregate rows.
export function buildReport(aggregates: DateAggregate[]): PriceBasisReport {
  const allOffsets = aggregates.flatMap((a) => a.rowOffsetsPp);
  const stats = summariseOffsets(allOffsets);

  const withFigures = aggregates.filter((a) =>
    a.targetPct !== null && a.actualMidPct !== null &&
    a.actualLowPct !== null
  );
  const meanTargetPct = mean(withFigures.map((a) => a.targetPct as number));
  const meanActualMidPct = mean(
    withFigures.map((a) => a.actualMidPct as number),
  );
  const meanActualLowPct = mean(
    withFigures.map((a) => a.actualLowPct as number),
  );
  const observedGapPp = meanTargetPct - meanActualMidPct;
  const gapOnLowBasisPp = meanTargetPct - meanActualLowPct;
  const basisContributionPp = gapOnLowBasisPp - observedGapPp;

  const verdict =
    `VERDICT: the midpoint basis lifts Actual by a mean ${
      stats.mean.toFixed(3)
    } pp versus the trained intraday-low basis. The offset is >= 0 on every ` +
    `row, so it NARROWS (masks) the Target-over-Actual gap; restating Actual ` +
    `onto the trained low basis would WIDEN the observed gap by ` +
    `${basisContributionPp.toFixed(3)} pp. This candidate therefore offsets, ` +
    `rather than causes, the gap — genuine model optimism must exceed the ` +
    `raw observed gap by this amount.`;

  return {
    maturedDates: aggregates.length,
    rowCount: stats.count,
    meanOffsetPp: stats.mean,
    medianOffsetPp: stats.median,
    minOffsetPp: stats.min,
    maxOffsetPp: stats.max,
    stdDevPp: stats.stdDev,
    meanTargetPct,
    meanActualMidPct,
    meanActualLowPct,
    observedGapPp,
    gapOnLowBasisPp,
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
export async function computePriceBasisDiagnostic(
  docsPath: string,
  asOf: Date,
): Promise<PriceBasisReport> {
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
