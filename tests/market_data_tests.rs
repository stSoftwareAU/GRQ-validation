use grq_validation::utils::{
    extract_symbol_from_ticker, extract_ticker_codes_from_score_file, read_index_json,
};
use std::path::Path;

#[test]
fn test_create_market_data_csv_for_first_score_file() {
    // Read the index to get the first score file
    let index_data = read_index_json("docs").expect("Failed to read index.json");
    assert!(
        !index_data.scores.is_empty(),
        "No score files found in index"
    );

    let first_score_entry = &index_data.scores[0];
    let score_file_path = format!("docs/scores/{}", first_score_entry.file);

    println!("Processing score file: {}", score_file_path);
    println!("Score file date: {}", first_score_entry.date);

    // Verify the score file exists
    assert!(
        Path::new(&score_file_path).exists(),
        "Score file does not exist: {}",
        score_file_path
    );

    // Extract ticker codes from the score file
    let ticker_codes = extract_ticker_codes_from_score_file(&score_file_path)
        .expect("Failed to read ticker codes from score file");

    println!("Found {} ticker codes in score file", ticker_codes.len());

    // Extract symbols for market data lookup
    let symbols: Vec<String> = ticker_codes
        .iter()
        .map(|ticker| extract_symbol_from_ticker(ticker))
        .collect();

    println!("Symbols for market data lookup: {:?}", symbols);

    // TODO: For each symbol, read market data from ../GRQ-shareprices2025Q1/data/{first_letter}/{symbol}.json
    // TODO: Filter market data to up to 180 days from the score file date
    // TODO: Create CSV file with market data for all symbols

    // For now, just verify we can extract symbols correctly
    assert!(
        !symbols.is_empty(),
        "No symbols extracted from ticker codes"
    );

    // Verify some expected symbols are present
    assert!(
        symbols.contains(&"SEM".to_string()),
        "Expected SEM symbol not found"
    );
    assert!(
        symbols.contains(&"CALM".to_string()),
        "Expected CALM symbol not found"
    );

    println!("Test completed successfully - ready to implement market data reading");
}
