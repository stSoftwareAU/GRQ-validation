// Shared row-shape interfaces for the milestone #544 diagnostic scripts
// (issue #692). These describe the objects produced by the SHIPPED kernels
// published on globalThis by docs/projection.js and docs/trend_predictions.js
// (parseScoreTsv, parseMarketCsv, parseDividendCsv and resolvePredictionStocks).
//
// The values originate from locally-parsed CSV/TSV, not from an external
// attacker, so this is a maintainability typing rather than a trust boundary:
// naming the row shapes at the exported diagnostic signatures replaces the
// per-line `// deno-lint-ignore no-explicit-any` and lets property typos (e.g.
// `stock.buyPrice`) be caught at compile time.
//
// Fields the diagnostics never read are marked OPTIONAL so a synthetic caller
// (a unit test) may omit them; the real parsers always populate them. No index
// signature is used, so a mistyped property name is still a compile error.

/** One parsed score-file (TSV) row, as produced by `parseScoreTsv`. */
export interface ScoreRow {
  /** Ticker; the only field the diagnostics read directly. */
  stock: string;
  score?: number;
  target?: number;
  exDividendDate?: string | null;
  dividendPerShare?: number;
  notes?: string;
  intrinsicValuePerShareBasic?: number | null;
  intrinsicValuePerShareAdjusted?: number | null;
}

/** One parsed market-data (CSV) point for a ticker, from `parseMarketCsv`. */
export interface MarketPoint {
  date: Date;
  high: number;
  low: number;
  open: number;
  close: number;
  splitCoefficient: number;
  /** Trailing volume column; absent on pre-#575 (7-column) CSVs. */
  volume?: number | null;
}

/**
 * One parsed dividend record for a ticker. Both the in-window dividend map from
 * `parseDividendCsv` and the full trailing history loaded from the
 * GRQ-dividends tree share this `{ exDivDate, amount }` shape.
 */
export interface DividendPoint {
  exDivDate: Date;
  amount: number;
}

/** A per-stock projection row resolved by `resolvePredictionStocks`. */
export interface ResolvedStock {
  buyPrice: number | null;
  currentPrice: number | null;
  splitReliable: boolean;
  adjustedTarget: number | null;
  totalDividends?: number;
  stock?: string;
  lowVolume?: boolean;
  avgStars?: number | null;
}
