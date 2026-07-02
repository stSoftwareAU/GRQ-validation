// Core computation for the issue #554 buy-price denominator diagnostic.
//
// Splits the pure aggregation (testable with synthetic rows, no disk) from the
// file IO. Every per-stock figure is delegated to the SHIPPED kernels published
// on globalThis by docs/projection.js and docs/trend_predictions.js, so the
// diagnostic measures the dashboard's own denominator rather than a
// re-implementation.
//
// The question: training divides the 90-day return by `monthsAgoPrice` (the
// CLOSE on the score date — GRQ/src/CoreFeatures.ts -> GRQ/src/LearnUtil.ts),
// while the dashboard divides BOTH Target and Actual by `buyPrice` (the
// split-adjusted MIDPOINT of the first usable point). This module quantifies the
// denominator offset and the gap it contributes when Target and Actual are
// restated onto the trained close basis.

import "../docs/projection.js";
import "../docs/volume_recommend.js";
import "../docs/trend_predictions.js";

import type {
  DividendPoint,
  MarketPoint,
  ResolvedStock,
  ScoreRow,
} from "./diagnostic_types.ts";

// deno-lint-ignore no-explicit-any
const P = (globalThis as any).GRQProjection;
// deno-lint-ignore no-explicit-any
const TP = (globalThis as any).GRQTrendPredictions;

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

/** Summary statistics for a list of per-row denominator offsets (pp). */
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

/** One matured score date's portfolio figures on both buy-price bases. */
export interface DateAggregate {
  date: string;
  // Dashboard basis (denominator = midpoint buyPrice).
  targetMidPct: number | null;
  actualMidPct: number | null;
  // Trained basis (denominator = split-adjusted close).
  targetClosePct: number | null;
  actualClosePct: number | null;
  rowOffsetsPp: number[];
}

// Build the dashboard (midpoint-denominator) and trained (close-denominator)
// per-stock inputs for one score date and compute the portfolio Target % and
// Actual % on each basis, plus the per-row `(buyPrice - buyPriceClose) /
// buyPrice` denominator offsets over the INCLUDED stocks. Pure: the caller
// supplies already-parsed score rows and the market-data map.
export function aggregateDate(
  date: string,
  scoreRows: ScoreRow[],
  marketData: Record<string, MarketPoint[]>,
  dividendData: Record<string, DividendPoint[]>,
  scoreDate: Date,
): DateAggregate {
  const midStocks: ResolvedStock[] = TP.resolvePredictionStocks(
    scoreRows,
    marketData,
    dividendData,
    scoreDate,
  );

  const rowOffsetsPp: number[] = [];
  const closeStocks = midStocks.map((stock, i) => {
    const points = marketData[scoreRows[i].stock];
    const closeObj = P.buyPriceCloseBasis(points, scoreDate);
    const buyPriceClose = closeObj ? closeObj.price : null;
    const offset = P.denominatorBasisOffsetPercent(
      stock.buyPrice,
      buyPriceClose,
    );
    const included = P.isStockIncluded(
      stock.buyPrice,
      stock.currentPrice,
      stock.splitReliable,
    );
    if (included && offset !== null) {
      rowOffsetsPp.push(offset);
    }
    // Same stock, both Target and Actual measured on the trained close
    // denominator instead of the midpoint buy price. Only the denominator
    // changes; numerators (adjustedTarget, currentPrice, dividends) are shared.
    return { ...stock, buyPrice: buyPriceClose };
  });

  return {
    date,
    targetMidPct: P.calculatePortfolioTargetPercentage(midStocks),
    actualMidPct: P.calculateIncludedPortfolioPerformance(midStocks),
    targetClosePct: P.calculatePortfolioTargetPercentage(closeStocks),
    actualClosePct: P.calculateIncludedPortfolioPerformance(closeStocks),
    rowOffsetsPp,
  };
}

/** The full diagnostic result over the matured historical score set. */
export interface DenominatorReport {
  maturedDates: number;
  rowCount: number;
  meanOffsetPp: number;
  medianOffsetPp: number;
  minOffsetPp: number;
  maxOffsetPp: number;
  stdDevPp: number;
  meanTargetMidPct: number;
  meanActualMidPct: number;
  meanTargetClosePct: number;
  meanActualClosePct: number;
  observedGapPp: number;
  gapOnCloseBasisPp: number;
  basisContributionPp: number;
  verdict: string;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((t, v) => t + v, 0) / values.length;
}

// Assemble the report from per-date aggregates. Pure so it can be unit-tested
// with synthetic DateAggregate rows.
export function buildReport(aggregates: DateAggregate[]): DenominatorReport {
  const allOffsets = aggregates.flatMap((a) => a.rowOffsetsPp);
  const stats = summariseOffsets(allOffsets);

  const withFigures = aggregates.filter((a) =>
    a.targetMidPct !== null && a.actualMidPct !== null &&
    a.targetClosePct !== null && a.actualClosePct !== null
  );
  const meanTargetMidPct = mean(
    withFigures.map((a) => a.targetMidPct as number),
  );
  const meanActualMidPct = mean(
    withFigures.map((a) => a.actualMidPct as number),
  );
  const meanTargetClosePct = mean(
    withFigures.map((a) => a.targetClosePct as number),
  );
  const meanActualClosePct = mean(
    withFigures.map((a) => a.actualClosePct as number),
  );
  // Both bases divide Target and Actual by the SAME denominator, so each basis
  // is internally self-consistent; the gap on each is Target - Actual.
  const observedGapPp = meanTargetMidPct - meanActualMidPct;
  const gapOnCloseBasisPp = meanTargetClosePct - meanActualClosePct;
  const basisContributionPp = gapOnCloseBasisPp - observedGapPp;

  const sign = stats.mean >= 0 ? "+" : "-";
  const widthWord = basisContributionPp >= 0 ? "WIDEN" : "NARROW";
  const verdict =
    `VERDICT: the dashboard divides BOTH Target and Actual by the same ` +
    `midpoint buyPrice, so the denominator choice does NOT desynchronise ` +
    `Target vs Actual — it rescales any existing gap by buyPrice/close. The ` +
    `midpoint buyPrice runs a mean ${sign}${
      Math.abs(stats.mean).toFixed(3)
    } pp versus the trained close denominator. Restating BOTH series onto the ` +
    `trained close basis would ${widthWord} the observed gap by ${
      Math.abs(basisContributionPp).toFixed(3)
    } pp (from ${observedGapPp.toFixed(3)} to ${
      gapOnCloseBasisPp.toFixed(3)
    } pp). The denominator is therefore a second-order rescale, not a cause of ` +
    `the Target-over-Actual gap.`;

  return {
    maturedDates: aggregates.length,
    rowCount: stats.count,
    meanOffsetPp: stats.mean,
    medianOffsetPp: stats.median,
    minOffsetPp: stats.min,
    maxOffsetPp: stats.max,
    stdDevPp: stats.stdDev,
    meanTargetMidPct,
    meanActualMidPct,
    meanTargetClosePct,
    meanActualClosePct,
    observedGapPp,
    gapOnCloseBasisPp,
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
export async function computeDenominatorDiagnostic(
  docsPath: string,
  asOf: Date,
): Promise<DenominatorReport> {
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
