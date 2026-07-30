//! End-to-end test of the score-file → dividend CSV path (issue #804).
//!
//! This previously skipped unless the operator's private dividend checkout was
//! present and, when it was, wrote `docs/scores/2025/March/5-dividends.csv` into
//! the committed tree from real private data. It now builds a synthetic score
//! file and a synthetic dividend tree inside its own temporary directory, so it
//! runs everywhere, asserts for real, and leaves the working tree untouched.

mod common;

use anyhow::Result;
use common::{write_dividend_data, write_score_file};
use grq_validation::utils::{
    create_dividend_csv_for_score_file, extract_ticker_codes_from_score_file,
};

/// Synthetic tickers: the first pays dividends inside the window, the second
/// has no dividend file at all — a missing symbol must be skipped, not fatal.
const PAYING_TICKER: &str = "NYSE:GRQVTEST804D";
const SILENT_TICKER: &str = "NYSE:GRQVTEST804N";

/// The March 5 date the original test used; the dividend window therefore runs
/// from `2025-03-05` to `2025-09-01` inclusive.
const SCORE_DATE: &str = "2025-03-05";

#[test]
fn test_create_dividend_csv_for_first_score_file() -> Result<()> {
    let workspace = tempfile::tempdir()?;
    let dividend_root = tempfile::tempdir()?;

    // The wrapper derives `<dir>/5-dividends.csv` from the score file, so a
    // score file inside the temp workspace keeps the output there too.
    let score_file = write_score_file(
        &workspace.path().join("5.tsv"),
        &[PAYING_TICKER, SILENT_TICKER],
    )?;
    let score_file_path = score_file.to_str().expect("temp path is valid UTF-8");

    // Two events inside the 180-day window and one after it, so the CSV proves
    // both dividend presence and the window filter.
    write_dividend_data(
        dividend_root.path(),
        "GRQVTEST804D",
        &[
            ("2025-03-20", "0.09375"),
            ("2025-06-20", "0.10"),
            ("2025-12-01", "0.25"), // after the window -> excluded
        ],
    )?;

    let ticker_codes = extract_ticker_codes_from_score_file(score_file_path)?;
    assert_eq!(ticker_codes, vec![PAYING_TICKER, SILENT_TICKER]);

    create_dividend_csv_for_score_file(
        dividend_root.path(),
        score_file_path,
        &ticker_codes,
        SCORE_DATE,
    )?;

    let dividend_output_path = workspace.path().join("5-dividends.csv");
    let content = std::fs::read_to_string(&dividend_output_path)?;
    assert!(!content.is_empty());
    assert!(content.contains("date,symbol,amount"));

    let lines: Vec<&str> = content.lines().collect();
    assert!(lines.len() > 1, "Should have at least header and some data");

    // Dividend presence: both in-window events, keyed by the full ticker code.
    assert!(
        content.contains(&format!("2025-03-20,{PAYING_TICKER},0.09375")),
        "expected the first in-window dividend in:\n{content}"
    );
    assert!(
        content.contains(&format!("2025-06-20,{PAYING_TICKER},0.1")),
        "expected the second in-window dividend in:\n{content}"
    );

    // The out-of-window event is filtered, and a symbol with no dividend file
    // is skipped rather than failing the run.
    assert!(
        !content.contains("2025-12-01"),
        "dividend after the window must be excluded in:\n{content}"
    );
    assert_eq!(
        lines.len(),
        3,
        "expected the header plus exactly the two in-window dividends in:\n{content}"
    );

    Ok(())
}
