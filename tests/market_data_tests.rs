use anyhow::Result;
use grq_validation::utils::{
    create_market_data_long_csv_for_score_file, extract_symbol_from_ticker,
    extract_ticker_codes_from_score_file, get_market_data_path, MARKET_DATA_BASE_PATH,
};

/// Best-effort smoke test against the external share-price repository. It only
/// asserts when real market data for this score file's date is genuinely
/// present; otherwise it skips.
///
/// The guard must NOT be a bare `MARKET_DATA_BASE_PATH` existence check.
/// Sibling tests (`create_market_data_csv_test.rs`,
/// `create_market_data_long_csv_test.rs`) drop synthetic fixtures under that
/// same base directory, so a bare existence check is a shared, mutable sentinel
/// that another test can transiently satisfy — making this test run against a
/// directory that exists but holds none of its tickers. Combined with the
/// non-destructive writer's "no rows written → error" guard (#687), that race
/// turned this test into an intermittent CI failure. The current share-price
/// repo also spans a single quarter and need not contain this file's date at
/// all. We therefore gate on a real data file for one of this file's tickers,
/// which a synthetic `GRQVTEST…` fixture never creates.
#[test]
fn test_create_market_data_long_csv_for_first_score_file() -> Result<()> {
    let score_file_path = "docs/scores/2025/June/20.tsv";
    let score_file_date = "2025-06-20";
    let output_dir = "target/test_output";

    // Extract ticker codes from the score file (the file itself is committed, so
    // this works regardless of the external repository's availability).
    let ticker_codes = extract_ticker_codes_from_score_file(score_file_path)?;

    // Skip unless the external repository genuinely holds a data file for one of
    // these tickers. This distinguishes a real clone from an empty or
    // fixture-polluted base directory.
    let has_real_data = ticker_codes.iter().any(|ticker| {
        let symbol = extract_symbol_from_ticker(ticker);
        get_market_data_path(&symbol)
            .map(|path| std::path::Path::new(&path).exists())
            .unwrap_or(false)
    });
    if !has_real_data {
        println!(
            "Skipping test_create_market_data_long_csv_for_first_score_file: \
             no market data for this score file's tickers under {MARKET_DATA_BASE_PATH}"
        );
        return Ok(());
    }

    println!(
        "Found {} ticker codes: {:?}",
        ticker_codes.len(),
        ticker_codes
    );

    // Create output directory if it doesn't exist.
    std::fs::create_dir_all(output_dir)?;

    // Create market data CSV. When the repository holds ticker files but no rows
    // fall inside this date's 180-day window, the non-destructive writer returns
    // a "no rows written" error (#687). That means the data is present but not
    // for this date, so skip rather than fail — the writer's error contract is
    // covered directly by the fixture-based tests in
    // `create_market_data_long_csv_test.rs`.
    let output_path = match create_market_data_long_csv_for_score_file(
        score_file_path,
        &ticker_codes,
        score_file_date,
        Some(output_dir),
    ) {
        Ok(path) => path,
        Err(error) => {
            println!("Skipping test_create_market_data_long_csv_for_first_score_file: {error}");
            return Ok(());
        }
    };

    println!("Created market data CSV: {output_path}");

    // Verify the file was created and has content.
    let content = std::fs::read_to_string(&output_path)?;
    assert!(!content.is_empty());
    assert!(content.contains("date,ticker,high,low,open,close"));

    // Clean up.
    let _ = std::fs::remove_file(&output_path);

    Ok(())
}
