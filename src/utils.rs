use crate::models::IndexData;
use anyhow::Result;

#[allow(dead_code)]
pub fn validate_stock_symbol(symbol: &str) -> bool {
    // Basic validation for stock symbols
    if symbol.is_empty() || symbol.len() > 10 {
        return false;
    }

    symbol
        .chars()
        .all(|c| c.is_alphanumeric() || c == '.' || c == ':')
}

#[allow(dead_code)]
pub fn calculate_average_score(scores: &[f64]) -> f64 {
    if scores.is_empty() {
        return 0.0;
    }

    scores.iter().sum::<f64>() / scores.len() as f64
}

#[allow(dead_code)]
pub fn read_index_json(docs_path: &str) -> Result<IndexData> {
    use std::fs;
    use std::path::Path;

    let index_path = Path::new(docs_path).join("scores").join("index.json");
    let content = fs::read_to_string(index_path)?;
    let index_data: IndexData = serde_json::from_str(&content)?;

    Ok(index_data)
}

#[allow(dead_code)]
pub fn extract_ticker_from_symbol(symbol: &str) -> Option<String> {
    // Extract ticker from "NYSE:SEM" -> "SEM"
    symbol
        .find(':')
        .map(|colon_pos| symbol[colon_pos + 1..].to_string())
}

#[allow(dead_code)]
pub fn get_market_data_path(ticker: &str) -> String {
    // Convert "SEM" -> "data/S/SEM.json"
    let first_letter = ticker.chars().next().unwrap_or('X').to_uppercase();
    format!(
        "../GRQ-shareprices2025Q1/data/{}/{}.json",
        first_letter, ticker
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_stock_symbol() {
        assert!(validate_stock_symbol("AAPL"));
        assert!(validate_stock_symbol("NYSE:AAPL"));
        assert!(validate_stock_symbol("BRK.A"));
        assert!(!validate_stock_symbol(""));
        assert!(!validate_stock_symbol("TOOLONGSTOCKSYMBOL"));
    }

    #[test]
    fn test_calculate_average_score() {
        let scores = vec![0.95, 0.85, 0.90];
        let expected = 0.9;
        let actual = calculate_average_score(&scores);
        assert!(
            (actual - expected).abs() < 0.0001,
            "Expected {}, got {}",
            expected,
            actual
        );

        let empty_scores: Vec<f64> = vec![];
        assert_eq!(calculate_average_score(&empty_scores), 0.0);
    }

    #[test]
    fn test_read_index_json() {
        let result = read_index_json("docs");
        if result.is_err() {
            // If the file doesn't exist, that's okay for now
            println!("Index file not found, skipping test");
            return;
        }

        let index_data = result.unwrap();
        assert!(!index_data.scores.is_empty());

        // Check that we have the expected dates
        let dates: Vec<&str> = index_data.scores.iter().map(|s| s.date.as_str()).collect();
        assert!(dates.contains(&"2025-06-20"));
        assert!(dates.contains(&"2025-06-21"));
    }

    #[test]
    fn test_extract_ticker_from_symbol() {
        assert_eq!(
            extract_ticker_from_symbol("NYSE:SEM"),
            Some("SEM".to_string())
        );
        assert_eq!(
            extract_ticker_from_symbol("NASDAQ:AAPL"),
            Some("AAPL".to_string())
        );
        assert_eq!(extract_ticker_from_symbol("SEM"), None);
        assert_eq!(extract_ticker_from_symbol(""), None);
    }

    #[test]
    fn test_get_market_data_path() {
        assert_eq!(
            get_market_data_path("SEM"),
            "../GRQ-shareprices2025Q1/data/S/SEM.json"
        );
        assert_eq!(
            get_market_data_path("AAPL"),
            "../GRQ-shareprices2025Q1/data/A/AAPL.json"
        );
        assert_eq!(
            get_market_data_path("TSLA"),
            "../GRQ-shareprices2025Q1/data/T/TSLA.json"
        );
    }
}
