#![warn(missing_docs)]
#![warn(clippy::missing_errors_doc)]
#![deny(unsafe_code)]
#![deny(unsafe_op_in_unsafe_fn)]
//! Processes daily stock-score TSV files and computes portfolio performance.
//!
//! The crate exposes two modules:
//!
//! - [`models`] — serde-backed data types for score records, market data,
//!   dividends and the computed performance results.
//! - [`utils`] — functions to read the score/market/dividend files, build the
//!   derived CSVs and calculate 90-day and annualised portfolio performance.

/// Data types shared across the crate (score records, market data, dividends
/// and performance results).
pub mod models;
/// File-reading, CSV-building and performance-calculation helpers.
pub mod utils;
