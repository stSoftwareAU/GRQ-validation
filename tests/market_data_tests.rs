//! End-to-end test of the score-file → market-data CSV path (issue #804).
//!
//! This was a best-effort smoke test against the operator's private share-price
//! checkout: it skipped unless that tree happened to hold a data file for one of
//! the committed score file's tickers, so on CI and any public checkout it never
//! asserted anything. It now builds a synthetic score file and a synthetic
//! market-data tree inside its own temporary directories, so it runs everywhere
//! and genuinely covers ticker extraction, per-ticker path resolution, and the
//! long-format writer's score-file wrapper.

mod common;

use anyhow::Result;
use common::{write_market_data, write_score_file, PricePoint};
use grq_validation::utils::{
    create_market_data_long_csv_for_score_file, extract_symbol_from_ticker,
    extract_ticker_codes_from_score_file, get_market_data_path_in,
};
use std::path::Path;

/// Synthetic tickers, including a dotted code so the `.` → `-` symbol mapping
/// (`NYSE:GRQVTEST804.A` → `GRQVTEST804-A`) is exercised end to end.
const TICKERS: [&str; 2] = ["NYSE:GRQVTEST804A", "NYSE:GRQVTEST804.A"];

/// Score-file date; the 180-day window runs from `2025-06-20` to `2025-12-17`.
const SCORE_DATE: &str = "2025-06-20";

#[test]
fn test_create_market_data_long_csv_for_first_score_file() -> Result<()> {
    let workspace = tempfile::tempdir()?;
    let market_root = tempfile::tempdir()?;

    // A synthetic score file stands in for a committed `docs/scores/**/DD.tsv`,
    // so the test reads nothing outside its own temporary directory.
    let score_file = write_score_file(&workspace.path().join("20.tsv"), &TICKERS)?;
    let score_file_path = score_file.to_str().expect("temp path is valid UTF-8");

    let ticker_codes = extract_ticker_codes_from_score_file(score_file_path)?;
    assert_eq!(
        ticker_codes,
        TICKERS.map(String::from).to_vec(),
        "every ticker in the score file must be extracted, in file order"
    );

    // One in-window fixture per ticker, written at the path the writer resolves.
    for ticker in &ticker_codes {
        let symbol = extract_symbol_from_ticker(ticker);
        write_market_data(
            market_root.path(),
            &symbol,
            &[PricePoint::detailed(
                SCORE_DATE, "10.10", "10.50", "9.90", "10.25", "123456",
            )],
        )?;
    }

    // Per-ticker path resolution: each symbol resolves to the bucketed JSON file
    // just written, under the caller-supplied root and nowhere else.
    for ticker in &ticker_codes {
        let symbol = extract_symbol_from_ticker(ticker);
        let resolved = get_market_data_path_in(market_root.path(), &symbol)?;
        assert!(
            Path::new(&resolved).starts_with(market_root.path()),
            "{symbol} must resolve under the supplied root, got {resolved}"
        );
        assert!(
            Path::new(&resolved).exists(),
            "expected the fixture for {symbol} at {resolved}"
        );
    }

    let output_dir = workspace.path().join("out");
    std::fs::create_dir_all(&output_dir)?;
    let output_dir_str = output_dir.to_str().expect("temp path is valid UTF-8");

    let output_path = create_market_data_long_csv_for_score_file(
        market_root.path(),
        score_file_path,
        &ticker_codes,
        SCORE_DATE,
        Some(output_dir_str),
    )?;

    // The wrapper names the CSV after the score file's stem, inside output_dir.
    assert_eq!(
        Path::new(&output_path),
        output_dir.join("20.csv"),
        "unexpected derived output path"
    );

    let content = std::fs::read_to_string(&output_path)?;
    assert!(!content.is_empty());
    assert!(content.contains("date,ticker,high,low,open,close"));

    // A row per ticker, keyed by the full ticker code, plus the header.
    for ticker in &ticker_codes {
        assert!(
            content.contains(&format!("{SCORE_DATE},{ticker},10.50,9.90,10.10,10.25")),
            "expected a fully-mapped row for {ticker} in:\n{content}"
        );
    }
    assert_eq!(
        content.lines().count(),
        TICKERS.len() + 1,
        "expected one header row plus one row per ticker in:\n{content}"
    );

    Ok(())
}
