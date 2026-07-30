//! Behaviour tests for `create_market_data_long_csv` (issue #634).
//!
//! Each test builds a small, fully controlled market-data fixture inside its
//! own `tempfile::tempdir()` root and asserts the observable contract — the
//! 8-column `date,ticker,high,low,open,close,split_coefficient,volume` output
//! and the "no rows written → error" guard — without caring how the writer is
//! implemented. They mirror `tests/create_market_data_csv_test.rs`.
//!
//! The fixtures are synthetic and hermetic (issue #804): every read and write
//! stays inside the test's temporary directory, so the tests run identically on
//! CI and on a maintainer's machine and never touch a configured data root.

mod common;

use anyhow::Result;
use common::{write_market_data, PricePoint};
use grq_validation::utils::create_market_data_long_csv;
use std::path::Path;

/// Clearly-synthetic symbol for the happy-path test. Each fixture-installing
/// test uses a *distinct* symbol under its own temporary root.
const FIXTURE_SYMBOL: &str = "GRQVTEST634A";

/// Full ticker code as it appears in a scores file. The long writer keeps the
/// whole code (exchange prefix included) in the `ticker` column.
const FIXTURE_TICKER: &str = "NYSE:GRQVTEST634A";

/// Distinct fixture symbol for the replacement test.
const FIXTURE_SYMBOL_REPLACE: &str = "GRQVTEST634B";

/// Full ticker code for the replacement test's fixture symbol.
const FIXTURE_TICKER_REPLACE: &str = "NYSE:GRQVTEST634B";

/// Score-file date used by the happy-path test; the 180-day window therefore
/// runs from `2025-04-15` to `2025-10-12` inclusive.
const SCORE_DATE: &str = "2025-04-15";

/// Three hand-written daily rows: before, inside, and after the 180-day window
/// from [`SCORE_DATE`]. The in-window row uses distinct
/// open/high/low/close/volume values so a test can verify each long-format
/// column is mapped to the right field.
fn fixture_points() -> Vec<PricePoint<'static>> {
    vec![
        // before the window -> excluded
        PricePoint::detailed("2024-01-01", "1.0", "1.0", "1.0", "1.0", "10"),
        // window start (inclusive) -> included, with distinct columns
        PricePoint::detailed("2025-04-15", "100.5", "105.25", "98.75", "102.0", "123456"),
        // after the window -> excluded
        PricePoint::detailed("2025-12-01", "9.0", "9.0", "9.0", "9.0", "20"),
    ]
}

#[test]
fn create_market_data_long_csv_writes_eight_column_rows() -> Result<()> {
    let root = tempfile::tempdir()?;
    write_market_data(root.path(), FIXTURE_SYMBOL, &fixture_points())?;

    let out_dir = tempfile::tempdir()?;
    let out_path = out_dir.path().join("long.csv");
    let out = out_path.to_str().expect("temp path is valid UTF-8");

    create_market_data_long_csv(root.path(), &[FIXTURE_TICKER.to_string()], SCORE_DATE, out)?;

    let csv = std::fs::read_to_string(&out_path)?;

    // 8-column header contract.
    assert_eq!(
        csv.lines().next().unwrap(),
        "date,ticker,high,low,open,close,split_coefficient,volume",
        "unexpected long-format CSV header in:\n{csv}"
    );

    // In-window row present with each column mapped to its field. The ticker
    // column keeps the full code (exchange prefix included).
    assert!(
        csv.contains(&format!(
            "2025-04-15,{FIXTURE_TICKER},105.25,98.75,100.5,102.0,1.0,123456"
        )),
        "expected the fully-mapped window-start row in:\n{csv}"
    );

    // Out-of-window rows excluded (both before and after the 180-day window).
    assert!(
        !csv.contains("2024-01-01"),
        "row before the window must be excluded in:\n{csv}"
    );
    assert!(
        !csv.contains("2025-12-01"),
        "row after the window must be excluded in:\n{csv}"
    );

    Ok(())
}

#[test]
fn create_market_data_long_csv_errors_when_all_tickers_skipped() -> Result<()> {
    // An empty fixture root: the symbol has no market-data file, so the only
    // ticker is skipped and no data rows are written. The documented guard at
    // `src/utils.rs` must turn this into an error rather than a silent
    // header-only CSV.
    let root = tempfile::tempdir()?;
    let out_dir = tempfile::tempdir()?;
    let out_path = out_dir.path().join("empty.csv");
    let out = out_path.to_str().expect("temp path is valid UTF-8");

    let result = create_market_data_long_csv(
        root.path(),
        &["NYSE:GRQVTEST634MISSING".to_string()],
        SCORE_DATE,
        out,
    );

    assert!(
        result.is_err(),
        "expected an error when every ticker is skipped and no rows are written"
    );

    Ok(())
}

#[test]
fn create_market_data_long_csv_preserves_existing_rows_when_no_fresh_data() -> Result<()> {
    // Regression for issue #687 (recurrences #672/#674/#685): when the upstream
    // share-price data is unavailable for a date, the writer must NOT clobber an
    // already-populated CSV with a bare header row. The external scorer pipeline
    // runs this generator and commits its output straight to `main`, so a
    // destructive truncation here wipes the dashboard's market data and forces
    // "Limited data mode".
    let root = tempfile::tempdir()?;
    let out_dir = tempfile::tempdir()?;
    let out_path = out_dir.path().join("populated.csv");
    let out = out_path.to_str().expect("temp path is valid UTF-8");

    // A pre-existing, populated market-data CSV (as produced by an earlier run).
    let existing = "date,ticker,high,low,open,close,split_coefficient,volume\n\
        2026-04-02,NYSE:GRQVTEST687,10.0,9.0,9.5,9.8,1.0,1000\n";
    std::fs::write(&out_path, existing)?;

    // Empty fixture root -> the only ticker is skipped -> zero rows written.
    let result = create_market_data_long_csv(
        root.path(),
        &["NYSE:GRQVTEST687MISSING".to_string()],
        SCORE_DATE,
        out,
    );

    // The writer still signals that no fresh data was available...
    assert!(
        result.is_err(),
        "expected an error when no fresh rows are written and data is unavailable"
    );

    // ...but the existing populated CSV must be left completely untouched.
    let after = std::fs::read_to_string(&out_path)?;
    assert_eq!(
        after, existing,
        "existing market-data rows must be preserved when no fresh data is available"
    );

    // No stray temporary file must be left behind next to the destination.
    assert!(
        !Path::new(&format!("{out}.tmp")).exists(),
        "the atomic-write temp file must not linger after a preserve"
    );

    Ok(())
}

#[test]
fn create_market_data_long_csv_replaces_existing_when_fresh_data_available() -> Result<()> {
    // Complement to the preservation test: when fresh data IS available, the
    // destination is replaced atomically with the new content — no stale rows
    // and no leftover temp file (issue #687).
    let root = tempfile::tempdir()?;
    write_market_data(root.path(), FIXTURE_SYMBOL_REPLACE, &fixture_points())?;

    let out_dir = tempfile::tempdir()?;
    let out_path = out_dir.path().join("replace.csv");
    let out = out_path.to_str().expect("temp path is valid UTF-8");

    // Stale content that must be fully replaced by the fresh write.
    std::fs::write(&out_path, "stale,garbage\n1,2\n")?;

    create_market_data_long_csv(
        root.path(),
        &[FIXTURE_TICKER_REPLACE.to_string()],
        SCORE_DATE,
        out,
    )?;

    let csv = std::fs::read_to_string(&out_path)?;
    assert_eq!(
        csv.lines().next().unwrap(),
        "date,ticker,high,low,open,close,split_coefficient,volume",
        "unexpected header after replacement in:\n{csv}"
    );
    assert!(
        csv.contains(&format!("2025-04-15,{FIXTURE_TICKER_REPLACE}")),
        "expected the fresh window-start row after replacement in:\n{csv}"
    );
    assert!(
        !csv.contains("stale,garbage"),
        "stale content must be fully replaced in:\n{csv}"
    );
    assert!(
        !Path::new(&format!("{out}.tmp")).exists(),
        "the atomic-write temp file must not linger after a successful write"
    );

    Ok(())
}
