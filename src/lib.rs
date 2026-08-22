#![warn(missing_docs)]
#![warn(clippy::missing_errors_doc)]
#![deny(unsafe_code)]
#![deny(unsafe_op_in_unsafe_fn)]
//! Processes daily stock-score TSV files and computes portfolio performance.
//!
//! The crate exposes five modules:
//!
//! - [`data_roots`] — the caller-supplied market- and dividend-data roots,
//!   resolved once at start-up and threaded into every entry point.
//! - [`models`] — serde-backed data types for score records, market data,
//!   dividends and the computed performance results.
//! - [`picks_backfill`] — the pass that rebuilds the sidecar for every
//!   historical score date listed in `docs/scores/index.json`.
//! - [`picks_sidecar`] — the per-score-date `<date>-picks.csv` sidecar holding
//!   the as-at-the-score-date figures the dashboard's pick details need.
//! - [`utils`] — functions to read the score/market/dividend files, build the
//!   derived CSVs and calculate 90-day and annualised portfolio performance.

/// The caller-supplied data roots, resolved once at start-up.
pub mod data_roots;
/// Data types shared across the crate (score records, market data, dividends
/// and performance results).
pub mod models;
/// The historical backfill of the pick-details sidecar across every score date
/// in `docs/scores/index.json`.
pub mod picks_backfill;
/// The per-score-date pick-details sidecar (52-week range, five-day-prior
/// close, trailing dollar ADV).
pub mod picks_sidecar;
/// File-reading, CSV-building and performance-calculation helpers.
pub mod utils;
