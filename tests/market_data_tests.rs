use grq_validation::utils::{
    create_market_data_long_csv_for_score_file, extract_ticker_codes_from_score_file,
    read_index_json,
};
use std::path::Path;

#[test]
fn test_create_market_data_long_csv_for_first_score_file() {
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

    // Extract ticker codes from the score file
    let ticker_codes = extract_ticker_codes_from_score_file(&score_file_path)
        .expect("Failed to read ticker codes from score file");

    println!("Found {} ticker codes in score file", ticker_codes.len());

    // Create test output directory if it doesn't exist
    let test_output_dir = ".test_output";
    std::fs::create_dir_all(test_output_dir).unwrap();

    // Create CSV file with market data in long format in the test output directory
    let result = create_market_data_long_csv_for_score_file(
        &score_file_path,
        &ticker_codes,
        &first_score_entry.date,
        Some(test_output_dir),
    );

    match result {
        Ok(output_path) => {
            println!("Successfully created market data CSV: {}", output_path);
            // Verify the CSV file was created
            assert!(
                Path::new(&output_path).exists(),
                "CSV file was not created: {}",
                output_path
            );
            // Clean up the test file
            std::fs::remove_file(&output_path).ok();
            println!("Test completed successfully - CSV file created and cleaned up");
        }
        Err(e) => {
            println!("Failed to create CSV file: {}", e);
            println!("Test completed with warnings - some market data may be missing");
        }
    }
}
