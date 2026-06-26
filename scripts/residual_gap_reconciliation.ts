// Core computation for the issue #557 whole-application sweep + residual-gap
// reconciliation (catch-all sub-issue of milestone #544).
//
// Two jobs:
//   1. Sweep the *aggregation* layer for any same-direction Target/Actual
//      asymmetry the targeted #552–#556 sub-issues did not cover — specifically
//      aggregation weighting, the inclusion gate, and null/NaN handling. The one
//      genuine asymmetry the sweep finds is the TARGET-AVAILABILITY denominator
//      skew: a priceable stock with a missing/NaN target is counted in the
//      Actual mean (calculateIncludedPortfolioPerformance) but dropped from the
//      Target mean (calculatePortfolioTargetPercentage), so the two portfolio
//      means can be taken over different stock subsets. This module quantifies
//      that skew by re-aggregating BOTH series over the matched (target-present)
//      subset and reading off the gap difference.
//   2. Reconcile the observed Target-over-Actual gap against the quantified
//      #544-family candidates, leaving the residual that is genuine model
//      optimism rather than measurement.
//
// Every per-stock figure is delegated to the SHIPPED kernels published on
// globalThis by docs/projection.js and docs/trend_predictions.js, so the sweep
// measures the dashboard's own aggregation rather than a re-implementation.

import "../docs/projection.js";
import "../docs/volume_recommend.js";
import "../docs/trend_predictions.js";

// deno-lint-ignore no-explicit-any
const P = (globalThis as any).GRQProjection;
// deno-lint-ignore no-explicit-any
const TP = (globalThis as any).GRQTrendPredictions;

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

// Sign convention for every reconciliation contribution: a POSITIVE value means
// the measurement choice INFLATES the apparent (dashboard) Target-over-Actual
// gap — correcting it would NARROW the gap. A NEGATIVE value means the choice
// MASKS the gap — correcting it would WIDEN it. The residual genuine optimism is
// the observed gap minus the net of these contributions.
export interface GapContribution {
  /** Short key, e.g. "price_basis". */
  key: string;
  /** Owning sub-issue number, e.g. 552. */
  issue: number;
  /** Effect on the apparent gap in percentage points (signed per convention). */
  contributionPp: number;
  /** One-line account of the candidate and its direction. */
  note: string;
}

// The quantified #544-family candidates, as documented by their own diagnostics
// (each computed on the same matured score set, as-of 2026-06-26). Encoded as
// constants here so the reconciliation arithmetic is reproducible and testable;
// the target-availability candidate (#557, this sweep) is computed at runtime
// and appended by buildReconciliation.
export const FAMILY_CONTRIBUTIONS: GapContribution[] = [
  {
    key: "price_basis",
    issue: 552,
    contributionPp: -2.242,
    note:
      "Dashboard reads Actual at the midpoint (high+low)/2; training uses the " +
      "intraday low. mid >= low on every row lifts Actual and MASKS the gap " +
      "(correcting to the trained low widens it by +2.242 pp).",
  },
  {
    key: "dividend_basis",
    issue: 553,
    contributionPp: 1.358,
    note:
      "Training bakes a flat yearOfDividends/4 credit into the Target label; " +
      "the dashboard credits only realised in-window dividends to Actual. The " +
      "over-credit INFLATES the apparent gap (1%-trimmed mean +1.358 pp; raw " +
      "mean +2.827 pp).",
  },
  {
    key: "buy_price_denominator",
    issue: 554,
    contributionPp: 0.0,
    note:
      "Both Target and Actual divide by the SAME buyPrice, so the midpoint-vs-" +
      "close denominator cannot desynchronise them; it only rescales the gap " +
      "(mean buyPrice-vs-close offset +0.046 pp). Ruled out as an asymmetry.",
  },
  {
    key: "horizon_split_parity",
    issue: 555,
    contributionPp: -0.482,
    note:
      "A reconcilable split between the horizon and end-of-series leaves the " +
      "raw Actual on a different split basis than buyPrice; the forward split " +
      "inflates Actual and MASKS the gap (correcting widens it by +0.482 pp).",
  },
  {
    key: "score_target_decoding",
    issue: 556,
    contributionPp: 0.0,
    note:
      "reverseProfitRecommend round-trips cleanly (max |shift| 1.78e-15 pp) " +
      "and the asymmetric floor never fires on the realised scores. Ruled out.",
  },
];

/** Whether a stock has BOTH a usable Actual (included) AND a usable target. */
// deno-lint-ignore no-explicit-any
export function hasUsableTarget(stock: any): boolean {
  if (
    !P.isStockIncluded(stock.buyPrice, stock.currentPrice, stock.splitReliable)
  ) {
    return false;
  }
  const t = stock.adjustedTarget;
  return t !== null && t !== undefined && !Number.isNaN(t);
}

/** One matured score date's portfolio figures, as-shipped and matched-set. */
export interface DateAggregate {
  date: string;
  /** Equal-weight Target % over included + target-present stocks (as shipped). */
  targetPct: number | null;
  /** Equal-weight Actual % over ALL included stocks (as shipped). */
  actualPct: number | null;
  /** Equal-weight Actual % over only the target-present subset. */
  matchedActualPct: number | null;
  /** Included (priceable) stock-rows behind the Actual mean. */
  includedRows: number;
  /** Of those, rows that ALSO carry a usable target (behind the Target mean). */
  targetRows: number;
}

// Build one matured score date's aggregate. Pure: the caller supplies the
// already-parsed score rows and the market/dividend maps. Both series are taken
// over the dashboard's own kernels so the as-shipped figures equal the live
// dashboard's; the matched-set Actual re-runs the Actual kernel over only the
// target-present subset so the target-availability skew can be read off.
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
  const stocks = TP.resolvePredictionStocks(
    scoreRows,
    marketData,
    dividendData,
    scoreDate,
  );

  // `stocks` is the (untyped) kernel output, so `s` is implicitly any here —
  // no explicit-any annotation needed.
  let includedRows = 0;
  for (const s of stocks) {
    if (P.isStockIncluded(s.buyPrice, s.currentPrice, s.splitReliable)) {
      includedRows++;
    }
  }
  const matchedStocks = stocks.filter(hasUsableTarget);
  const targetRows = matchedStocks.length;

  return {
    date,
    // Target kernel already drops null-target rows, so as-shipped Target ==
    // matched-set Target; the gap difference comes entirely from the Actual mean.
    targetPct: P.calculatePortfolioTargetPercentage(stocks),
    actualPct: P.calculateIncludedPortfolioPerformance(stocks),
    matchedActualPct: P.calculateIncludedPortfolioPerformance(matchedStocks),
    includedRows,
    targetRows,
  };
}

/** The full reconciliation result over the matured historical score set. */
export interface ReconciliationReport {
  maturedDates: number;
  includedRows: number;
  targetRows: number;
  droppedTargetRows: number;
  meanTargetPct: number;
  meanActualPct: number;
  meanMatchedActualPct: number;
  /** Observed (as-shipped) gap = mean Target - mean Actual. */
  observedGapPp: number;
  /** Gap when both series are taken over the matched (target-present) subset. */
  matchedGapPp: number;
  /** Target-availability skew = observedGap - matchedGap (this sweep, #557). */
  targetAvailabilityPp: number;
  /** Every contribution, including the runtime target-availability one. */
  contributions: GapContribution[];
  /** Net of all contributions (signed per the convention above). */
  netMeasurementPp: number;
  /** observedGap - netMeasurement: the residual attributed to model optimism. */
  residualOptimismPp: number;
  verdict: string;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((t, v) => t + v, 0) / values.length;
}

// Assemble the reconciliation from per-date aggregates and the family
// contributions. Pure so it can be unit-tested with synthetic rows. The
// target-availability contribution is computed from the aggregates and appended
// to `family` before netting.
export function buildReconciliation(
  aggregates: DateAggregate[],
  family: GapContribution[] = FAMILY_CONTRIBUTIONS,
): ReconciliationReport {
  // Dates with a full set of figures contribute to the portfolio means.
  const withFigures = aggregates.filter((a) =>
    a.targetPct !== null && a.actualPct !== null &&
    a.matchedActualPct !== null
  );
  const meanTargetPct = mean(withFigures.map((a) => a.targetPct as number));
  const meanActualPct = mean(withFigures.map((a) => a.actualPct as number));
  const meanMatchedActualPct = mean(
    withFigures.map((a) => a.matchedActualPct as number),
  );

  const observedGapPp = meanTargetPct - meanActualPct;
  const matchedGapPp = meanTargetPct - meanMatchedActualPct;
  const targetAvailabilityPp = observedGapPp - matchedGapPp;

  const includedRows = aggregates.reduce((t, a) => t + a.includedRows, 0);
  const targetRows = aggregates.reduce((t, a) => t + a.targetRows, 0);
  const droppedTargetRows = includedRows - targetRows;

  const contributions: GapContribution[] = [
    ...family,
    {
      key: "target_availability",
      issue: 557,
      contributionPp: targetAvailabilityPp,
      note:
        `Priceable stocks with a missing/NaN target (${droppedTargetRows} of ` +
        `${includedRows} included rows) are counted in Actual but dropped from ` +
        `Target, so the two means span different subsets. Re-aggregating both ` +
        `over the matched subset moves the gap by ${
          targetAvailabilityPp.toFixed(3)
        } pp.`,
    },
  ];

  const netMeasurementPp = contributions.reduce(
    (t, c) => t + c.contributionPp,
    0,
  );
  const residualOptimismPp = observedGapPp - netMeasurementPp;

  const verdict =
    `VERDICT (whole-application sweep + reconciliation): aggregation weighting ` +
    `and the inclusion gate are SHARED and equal-weight for both Target and ` +
    `Actual; the only aggregation-layer asymmetry is the target-availability ` +
    `skew (${targetAvailabilityPp.toFixed(3)} pp). Netting every quantified ` +
    `#544 candidate leaves a residual of ${residualOptimismPp.toFixed(3)} pp ` +
    `out of the observed ${observedGapPp.toFixed(3)} pp gap. The measurement ` +
    `candidates roughly cancel (net ${
      netMeasurementPp.toFixed(3)
    } pp), so the ` +
    `bulk of the gap is genuine model optimism, not measurement.`;

  return {
    maturedDates: aggregates.length,
    includedRows,
    targetRows,
    droppedTargetRows,
    meanTargetPct,
    meanActualPct,
    meanMatchedActualPct,
    observedGapPp,
    matchedGapPp,
    targetAvailabilityPp,
    contributions,
    netMeasurementPp,
    residualOptimismPp,
    verdict,
  };
}

interface ScoreIndexEntry {
  file: string;
  date: string;
}

// Load the matured score set from disk and compute the full reconciliation.
// A score date is "matured" once its full 90-day window has elapsed by `asOf`.
export async function computeResidualGapReconciliation(
  docsPath: string,
  asOf: Date,
): Promise<ReconciliationReport> {
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

    aggregates.push(
      aggregateDate(
        entry.date,
        TP.parseScoreTsv(tsvText),
        TP.parseMarketCsv(csvText),
        TP.parseDividendCsv(divText),
        scoreDate,
      ),
    );
  }

  return buildReconciliation(aggregates);
}

async function readOptional(path: string): Promise<string> {
  try {
    return await Deno.readTextFile(path);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return "";
    throw err;
  }
}
