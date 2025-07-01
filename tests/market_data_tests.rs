use anyhow::Result;
use grq_validation::utils::{
    create_market_data_long_csv_for_score_file, extract_ticker_codes_from_score_file,
    MARKET_DATA_BASE_PATH,
};

#[test]
fn test_create_market_data_long_csv_for_first_score_file() -> Result<()> {
    // Skip test if external data repository is not available
    if !std::path::Path::new(MARKET_DATA_BASE_PATH).exists() {
        println!("Skipping test_create_market_data_long_csv_for_first_score_file: external data repository not available");
        return Ok(());
    }

    // Test with the first score file from the index
    let score_file_path = "docs/scores/2025/June/20.tsv";
    let score_file_date = "2025-06-20";
    let output_dir = "target/test_output";

    // Create output directory if it doesn't exist
    std::fs::create_dir_all(output_dir)?;

    // Extract ticker codes from the score file
    let ticker_codes = extract_ticker_codes_from_score_file(score_file_path)?;
    println!(
        "Found {} ticker codes: {:?}",
        ticker_codes.len(),
        ticker_codes
    );

    // Create market data CSV
    let output_path = create_market_data_long_csv_for_score_file(
        score_file_path,
        &ticker_codes,
        score_file_date,
        Some(output_dir),
    )?;

    println!("Created market data CSV: {output_path}");

    // Verify the file was created and has content
    let content = std::fs::read_to_string(&output_path)?;
    assert!(!content.is_empty());
    assert!(content.contains("date,ticker,high,low,open,close"));

    // Clean up
    let _ = std::fs::remove_file(&output_path);

    Ok(())
}
