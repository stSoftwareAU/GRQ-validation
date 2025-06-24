use anyhow::Result;
use grq_validation::utils::{
    create_dividend_csv_for_score_file, extract_ticker_codes_from_score_file,
};

#[test]
fn test_create_dividend_csv_for_first_score_file() -> Result<()> {
    // Test with the March 5 score file which is older and should have dividends
    let score_file_path = "docs/scores/2025/March/5.tsv";
    let score_file_date = "2025-03-05";

    // Extract ticker codes from the score file
    let ticker_codes = extract_ticker_codes_from_score_file(score_file_path)?;
    println!(
        "Found {} ticker codes: {:?}",
        ticker_codes.len(),
        ticker_codes
    );

    // Create dividend CSV
    create_dividend_csv_for_score_file(score_file_path, &ticker_codes, score_file_date)?;

    // Verify the dividend file was created
    let dividend_output_path = "docs/scores/2025/March/5-dividends.csv";
    let content = std::fs::read_to_string(dividend_output_path)?;
    assert!(!content.is_empty());
    assert!(content.contains("date,symbol,amount"));

    // Check if we have any dividend data (SEM should have dividends)
    let lines: Vec<&str> = content.lines().collect();
    assert!(lines.len() > 1, "Should have at least header and some data");

    Ok(())
}
