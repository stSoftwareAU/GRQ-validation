#![warn(missing_docs)]
#![warn(clippy::missing_errors_doc)]
#![deny(unsafe_code)]
#![deny(unsafe_op_in_unsafe_fn)]
//! Processes daily stock-score TSV files and computes portfolio performance.
//!
//! The crate exposes these modules, one concern each (issue #882):
//!
//! - [`data_roots`] — the caller-supplied market- and dividend-data roots,
//!   resolved once at start-up and threaded into every entry point.
//! - [`dividends`] — dividend-file paths, reading/filtering and the per-score
//!   dividend CSVs.
//! - [`index`] — the `docs/index.json` score index and safe score-file paths.
//! - [`market_data`] — market-data paths, reading/filtering prices and the
//!   per-score market-data CSVs.
//! - [`models`] — serde-backed data types for score records, market data,
//!   dividends and the computed performance results.
//! - [`picks_backfill`] — the pass that rebuilds the sidecar for every
//!   historical score date listed in `docs/scores/index.json`.
//! - [`picks_sidecar`] — the per-score-date `<date>-picks.csv` sidecar holding
//!   the as-at-the-score-date figures the dashboard's pick details need.
//! - [`performance`] — the priceability gate, annualisation, portfolio
//!   performance and the hybrid 90-day projection.
//! - [`splits`] — the split-coefficient guard and correct-or-exclude factor.
//! - [`utils`] — score-file helpers, plus re-exports of the items above so
//!   existing `utils::` call sites keep compiling.

/// The caller-supplied data roots, resolved once at start-up.
pub mod data_roots;
/// Dividend history: paths, reading/filtering and the per-score dividend CSVs.
pub mod dividends;
/// The `docs/index.json` score index and safe score-file path building.
pub mod index;
/// Market data: paths, reading/filtering prices and the per-score CSVs.
pub mod market_data;
/// Data types shared across the crate (score records, market data, dividends
/// and performance results).
pub mod models;
/// Performance maths: priceability, annualisation, portfolio and projection.
pub mod performance;
/// The historical backfill of the pick-details sidecar across every score date
/// in `docs/scores/index.json`.
pub mod picks_backfill;
/// The per-score-date pick-details sidecar (52-week range, five-day-prior
/// close, trailing dollar ADV).
pub mod picks_sidecar;
/// The split-coefficient guard and correct-or-exclude adjustment.
pub mod splits;
/// Score-file helpers, plus re-exports of the split-out modules' items.
pub mod utils;
