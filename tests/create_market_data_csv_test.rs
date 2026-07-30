//! Behaviour tests for `create_market_data_csv` and its wrapper
//! `create_market_data_csv_for_score_file` (issue #265).
//!
//! These were previously the only market-data writers with no test exercising
//! them, directly or indirectly. Each test builds a small, fully controlled
//! market-data fixture inside its own `tempfile::tempdir()` root and asserts
//! the observable CSV output. The assertions pin the public contract — the
//! `date,symbol,close` header and the inclusive 180-day window filter — without
//! caring how the function computes them.
//!
//! The fixtures are synthetic and hermetic (issue #804): every read and write
//! stays inside the test's temporary directory, so the tests run identically on
//! CI and on a maintainer's machine and never touch a configured data root.

mod common;

use anyhow::Result;
use common::{write_market_data, PricePoint};
use grq_validation::utils::{create_market_data_csv, create_market_data_csv_for_score_file};

/// Clearly-synthetic symbols, one per test, so a fixture is always read back
/// from the file the same test wrote.
const FIXTURE_SYMBOL_DIRECT: &str = "GRQVTEST265A";
const FIXTURE_SYMBOL_WRAPPER: &str = "GRQVTEST265B";

/// Score-file date used by every test; the 180-day window therefore runs from
/// `2025-04-15` to `2025-10-12` inclusive.
const SCORE_DATE: &str = "2025-04-15";

/// Three hand-written daily rows: before, inside, and after the 180-day window
/// from [`SCORE_DATE`], so a test can assert both inclusion and exclusion.
fn fixture_points() -> Vec<PricePoint<'static>> {
    vec![
        PricePoint::flat("2024-01-01", "11.11"), // before the window -> excluded
        PricePoint::flat("2025-04-15", "100.5"), // window start (inclusive) -> included
        PricePoint::flat("2025-12-01", "99.99"), // after the window -> excluded
    ]
}

#[test]
fn create_market_data_csv_writes_windowed_rows() -> Result<()> {
    let root = tempfile::tempdir()?;
    write_market_data(root.path(), FIXTURE_SYMBOL_DIRECT, &fixture_points())?;

    let out_dir = tempfile::tempdir()?;
    let out_path = out_dir.path().join("md.csv");
    let out = out_path.to_str().expect("temp path is valid UTF-8");

    create_market_data_csv(
        root.path(),
        &[FIXTURE_SYMBOL_DIRECT.to_string()],
        SCORE_DATE,
        out,
    )?;

    let csv = std::fs::read_to_string(&out_path)?;

    // Header contract.
    assert_eq!(
        csv.lines().next().unwrap(),
        "date,symbol,close",
        "unexpected CSV header in:\n{csv}"
    );

    // In-window row present with its close price.
    assert!(
        csv.contains(&format!("2025-04-15,{FIXTURE_SYMBOL_DIRECT},100.5")),
        "expected the window-start row in:\n{csv}"
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
fn create_market_data_csv_for_score_file_writes_derived_csv() -> Result<()> {
    let root = tempfile::tempdir()?;
    write_market_data(root.path(), FIXTURE_SYMBOL_WRAPPER, &fixture_points())?;

    // The wrapper derives the output path by swapping the score file's
    // extension to `.csv` in the same directory.
    let dir = tempfile::tempdir()?;
    let score_file = dir.path().join("scores.tsv");
    std::fs::write(&score_file, "stock\n")?; // contents are irrelevant here
    let score_file_str = score_file.to_str().expect("temp path is valid UTF-8");

    create_market_data_csv_for_score_file(
        root.path(),
        score_file_str,
        &[FIXTURE_SYMBOL_WRAPPER.to_string()],
        SCORE_DATE,
    )?;

    let derived = dir.path().join("scores.csv");
    assert!(
        derived.exists(),
        "wrapper should write the derived CSV at {derived:?}"
    );

    let csv = std::fs::read_to_string(&derived)?;
    assert_eq!(csv.lines().next().unwrap(), "date,symbol,close");
    assert!(csv.contains(&format!("2025-04-15,{FIXTURE_SYMBOL_WRAPPER},100.5")));

    Ok(())
}
