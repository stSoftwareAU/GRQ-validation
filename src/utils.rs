use crate::models::DividendData;
use crate::models::IndexData;
use crate::models::MarketData;
use crate::models::StockRecord;
use anyhow::Result;
use chrono::{Duration, NaiveDate};
use std::collections::HashMap;
use std::path::Path;

// Constants for external data paths
pub const MARKET_DATA_BASE_PATH: &str = "../GRQ-shareprices2025Q1";
pub const DIVIDEND_DATA_BASE_PATH: &str = "../GRQ-dividends";

#[allow(dead_code)]
pub fn validate_stock_symbol(symbol: &str) -> bool {
    // Basic validation for stock symbols
    if symbol.is_empty() || symbol.len() > 30 {
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
    let first_letter = ticker.chars().next().unwrap_or('X').to_uppercase();
    format!("{MARKET_DATA_BASE_PATH}/data/{first_letter}/{ticker}.json")
}

#[allow(dead_code)]
pub fn read_tsv_score_file(file_path: &str) -> Result<Vec<StockRecord>> {
    use csv::ReaderBuilder;
    use std::fs::File;

    let file = File::open(file_path)?;
    let mut reader = ReaderBuilder::new()
        .delimiter(b'\t')
        .has_headers(true)
        .from_reader(file);

    let mut stock_records = Vec::new();

    for result in reader.deserialize() {
        let record: StockRecord = result?;
        stock_records.push(record);
    }

    Ok(stock_records)
}

#[allow(dead_code)]
pub fn extract_ticker_codes_from_score_file(file_path: &str) -> Result<Vec<String>> {
    let stock_records = read_tsv_score_file(file_path)?;
    let ticker_codes: Vec<String> = stock_records
        .into_iter()
        .map(|record| record.stock)
        .collect();

    Ok(ticker_codes)
}

#[allow(dead_code)]
pub fn extract_symbol_from_ticker(ticker: &str) -> String {
    let symbol = match ticker.rsplit_once(':') {
        Some((_, symbol)) => symbol.to_string(),
        None => ticker.to_string(),
    };
    // Convert dots to hyphens for file system compatibility
    // e.g., "HEI.A" -> "HEI-A"
    symbol.replace('.', "-")
}

pub fn read_market_data(symbol: &str) -> Result<MarketData> {
    use std::fs::File;

    let first_letter = symbol.chars().next().unwrap_or('X').to_uppercase();
    let market_data_path = format!("{MARKET_DATA_BASE_PATH}/data/{first_letter}/{symbol}.json");

    let file = File::open(&market_data_path)?;
    let market_data: MarketData = serde_json::from_reader(file)?;

    Ok(market_data)
}

#[allow(dead_code)]
pub fn filter_market_data_by_date_range(
    market_data: &MarketData,
    start_date: &str,
    end_date: &str,
) -> Result<Vec<(String, f64)>> {
    let start = NaiveDate::parse_from_str(start_date, "%Y-%m-%d")?;
    let end = NaiveDate::parse_from_str(end_date, "%Y-%m-%d")?;

    let mut filtered_data = Vec::new();

    for (date_str, daily_data) in &market_data.time_series_daily {
        if let Ok(date) = NaiveDate::parse_from_str(date_str, "%Y-%m-%d") {
            if date >= start && date <= end {
                if let Ok(close_price) = daily_data.close.parse::<f64>() {
                    filtered_data.push((date_str.clone(), close_price));
                }
            }
        }
    }

    // Sort by date (oldest first)
    filtered_data.sort_by(|a, b| a.0.cmp(&b.0));

    Ok(filtered_data)
}

/// Derives the CSV output path from a score file path
/// For example: "docs/scores/2025/June/20.tsv" -> "docs/scores/2025/June/20.csv"
pub fn derive_csv_output_path(score_file_path: &str) -> String {
    let path = Path::new(score_file_path);
    if let Some(parent) = path.parent() {
        if let Some(stem) = path.file_stem() {
            return parent
                .join(format!("{}.csv", stem.to_string_lossy()))
                .to_string_lossy()
                .to_string();
        }
    }
    // Fallback: just replace .tsv with .csv
    score_file_path.replace(".tsv", ".csv")
}

/// Creates a CSV file with market data for the given symbols and date range
/// The CSV file will be created in the same directory as the score file with the same base name
pub fn create_market_data_csv_for_score_file(
    score_file_path: &str,
    symbols: &[String],
    score_file_date: &str,
) -> Result<()> {
    let output_path = derive_csv_output_path(score_file_path);
    create_market_data_csv(symbols, score_file_date, &output_path)
}

/// Creates a CSV file with market data for the given symbols and date range
pub fn create_market_data_csv(
    symbols: &[String],
    score_file_date: &str,
    output_path: &str,
) -> Result<()> {
    use csv::Writer;
    use std::fs::File;

    // Calculate date range: from score file date to 180 days after
    let score_date = NaiveDate::parse_from_str(score_file_date, "%Y-%m-%d")?;
    let end_date = score_date + Duration::days(180);
    let end_date_str = end_date.format("%Y-%m-%d").to_string();

    println!("Reading market data from {score_file_date} to {end_date_str}");

    // Collect all market data
    let mut all_market_data: HashMap<String, Vec<(String, f64)>> = HashMap::new();
    let mut all_dates: std::collections::HashSet<String> = std::collections::HashSet::new();

    for symbol in symbols {
        match read_market_data(symbol) {
            Ok(market_data) => {
                match filter_market_data_by_date_range(&market_data, score_file_date, &end_date_str)
                {
                    Ok(filtered_data) => {
                        for (date, _) in &filtered_data {
                            all_dates.insert(date.clone());
                        }
                        all_market_data.insert(symbol.clone(), filtered_data);
                        println!(
                            "  {symbol}: {count} data points",
                            count = all_market_data[symbol].len()
                        );
                    }
                    Err(e) => {
                        println!("  {symbol}: Error filtering data: {e}");
                    }
                }
            }
            Err(e) => {
                println!("  {symbol}: Error reading market data: {e}");
            }
        }
    }

    // Sort all dates
    let mut sorted_dates: Vec<String> = all_dates.into_iter().collect();
    sorted_dates.sort();

    // Create CSV file
    let file = File::create(output_path)?;
    let mut writer = Writer::from_writer(file);
    writer.write_record(["date", "symbol", "close"])?;

    for symbol in symbols {
        match read_market_data(symbol) {
            Ok(market_data) => {
                match filter_market_data_by_date_range(&market_data, score_file_date, &end_date_str)
                {
                    Ok(filtered_data) => {
                        for (date, close_price) in filtered_data {
                            writer.write_record([&date, symbol, &close_price.to_string()])?;
                        }
                    }
                    Err(e) => {
                        println!("  {symbol}: Error filtering data: {e}");
                    }
                }
            }
            Err(e) => {
                println!("  {symbol}: Error reading market data: {e}");
            }
        }
    }

    writer.flush()?;
    println!("CSV file created: {output_path}");

    Ok(())
}

/// Creates a CSV file with market data for the given tickers and date range, in long format.
/// Each row: date, ticker, high, low, open, close
/// The ticker is the full code from the scores file (e.g., NYSE:SEM)
pub fn create_market_data_long_csv(
    tickers: &[String],
    score_file_date: &str,
    output_path: &str,
) -> Result<()> {
    use crate::utils::extract_symbol_from_ticker;
    use csv::Writer;
    use std::fs::File;

    let score_date = NaiveDate::parse_from_str(score_file_date, "%Y-%m-%d")?;
    let end_date = score_date + Duration::days(180);
    let end_date_str = end_date.format("%Y-%m-%d").to_string();

    let file = File::create(output_path)?;
    let mut writer = Writer::from_writer(file);
    writer.write_record([
        "date",
        "ticker",
        "high",
        "low",
        "open",
        "close",
        "split_coefficient",
    ])?;

    for ticker in tickers {
        let symbol = extract_symbol_from_ticker(ticker);
        let market_data = match read_market_data(&symbol) {
            Ok(md) => md,
            Err(_) => continue, // skip missing data
        };
        let filtered =
            match filter_market_data_by_date_range(&market_data, score_file_date, &end_date_str) {
                Ok(f) => f,
                Err(_) => continue,
            };
        for (date, _close) in filtered {
            if let Some(day) = market_data.time_series_daily.get(&date) {
                writer.write_record([
                    &date,
                    ticker,
                    &day.high.to_string(),
                    &day.low.to_string(),
                    &day.open.to_string(),
                    &day.close.to_string(),
                    &day.split_coefficient.to_string(),
                ])?;
            }
        }
    }
    writer.flush()?;
    Ok(())
}

/// Like create_market_data_csv_for_score_file, but outputs long format and allows custom output dir (for tests)
pub fn create_market_data_long_csv_for_score_file(
    score_file_path: &str,
    tickers: &[String],
    score_file_date: &str,
    output_dir: Option<&str>,
) -> Result<String> {
    let output_path = if let Some(dir) = output_dir {
        let path = std::path::Path::new(score_file_path);
        let stem = path.file_stem().unwrap_or_default();
        let out = std::path::Path::new(dir).join(format!("{}.csv", stem.to_string_lossy()));
        out.to_string_lossy().to_string()
    } else {
        derive_csv_output_path(score_file_path)
    };
    create_market_data_long_csv(tickers, score_file_date, &output_path)?;
    Ok(output_path)
}

/// Gets the dividend data path for a given ticker
/// For example: "SEM" -> "../GRQ-dividends/data/S/SEM.json"
pub fn get_dividend_data_path(ticker: &str) -> String {
    let first_letter = ticker.chars().next().unwrap_or('X').to_uppercase();
    format!("{DIVIDEND_DATA_BASE_PATH}/data/{first_letter}/{ticker}.json")
}

/// Reads dividend data for a given ticker
pub fn read_dividend_data(ticker: &str) -> Result<DividendData> {
    use std::fs::File;

    let dividend_data_path = get_dividend_data_path(ticker);
    let file = File::open(&dividend_data_path)?;
    let dividend_data: DividendData = serde_json::from_reader(file)?;

    Ok(dividend_data)
}

/// Filters dividend data by date range
pub fn filter_dividend_data_by_date_range(
    dividend_data: &DividendData,
    start_date: &str,
    end_date: &str,
) -> Result<Vec<(String, f64)>> {
    let start = NaiveDate::parse_from_str(start_date, "%Y-%m-%d")?;
    let end = NaiveDate::parse_from_str(end_date, "%Y-%m-%d")?;

    let mut filtered_data = Vec::new();

    for dividend_record in &dividend_data.data {
        if let Ok(ex_div_date) =
            NaiveDate::parse_from_str(&dividend_record.ex_dividend_date, "%Y-%m-%d")
        {
            if ex_div_date >= start && ex_div_date <= end {
                if let Ok(amount) = dividend_record.amount.parse::<f64>() {
                    filtered_data.push((dividend_record.ex_dividend_date.clone(), amount));
                }
            }
        }
    }

    // Sort by date (oldest first)
    filtered_data.sort_by(|a, b| a.0.cmp(&b.0));

    Ok(filtered_data)
}

/// Derives the dividend CSV output path from a score file path
/// For example: "docs/scores/2025/June/20.tsv" -> "docs/scores/2025/June/20-dividends.csv"
pub fn derive_dividend_csv_output_path(score_file_path: &str) -> String {
    let path = Path::new(score_file_path);
    if let Some(parent) = path.parent() {
        if let Some(stem) = path.file_stem() {
            return parent
                .join(format!("{}-dividends.csv", stem.to_string_lossy()))
                .to_string_lossy()
                .to_string();
        }
    }
    // Fallback: just replace .tsv with -dividends.csv
    score_file_path.replace(".tsv", "-dividends.csv")
}

/// Creates a dividend CSV file for the given symbols and date range
pub fn create_dividend_csv(
    symbols: &[String],
    score_file_date: &str,
    output_path: &str,
) -> Result<()> {
    use csv::Writer;
    use std::fs::File;

    // Calculate date range: from score file date to 180 days after
    let score_date = NaiveDate::parse_from_str(score_file_date, "%Y-%m-%d")?;
    let end_date = score_date + Duration::days(180);
    let end_date_str = end_date.format("%Y-%m-%d").to_string();

    println!("Reading dividend data from {score_file_date} to {end_date_str}");

    let file = File::create(output_path)?;
    let mut writer = Writer::from_writer(file);
    writer.write_record(["date", "symbol", "amount"])?;

    for symbol in symbols {
        // Extract just the symbol part (e.g., "NYSE:SEM" -> "SEM")
        let symbol_only = extract_symbol_from_ticker(symbol);

        match read_dividend_data(&symbol_only) {
            Ok(dividend_data) => {
                match filter_dividend_data_by_date_range(
                    &dividend_data,
                    score_file_date,
                    &end_date_str,
                ) {
                    Ok(filtered_data) => {
                        for (date, amount) in filtered_data {
                            writer.write_record([&date, symbol, &amount.to_string()])?;
                        }
                    }
                    Err(e) => {
                        println!("Warning: Could not filter dividend data for {symbol}: {e}");
                    }
                }
            }
            Err(e) => {
                println!("Warning: Could not read dividend data for {symbol}: {e}");
            }
        }
    }

    writer.flush()?;
    println!("Dividend CSV file created: {output_path}");

    Ok(())
}

/// Creates a dividend CSV file for a score file
pub fn create_dividend_csv_for_score_file(
    score_file_path: &str,
    symbols: &[String],
    score_file_date: &str,
) -> Result<()> {
    let output_path = derive_dividend_csv_output_path(score_file_path);
    create_dividend_csv(symbols, score_file_date, &output_path)
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
        assert!(!validate_stock_symbol(
            "THISISAREALLYLONGSTOCKSYMBOLTHATEXCEEDSTHELIMIT"
        ));
    }

    #[test]
    fn test_calculate_average_score() {
        let scores = vec![0.95, 0.85, 0.90];
        let expected = 0.9;
        let actual = calculate_average_score(&scores);
        assert!(
            (actual - expected).abs() < 0.0001,
            "Expected {expected}, got {actual}"
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
            format!("{MARKET_DATA_BASE_PATH}/data/S/SEM.json")
        );
        assert_eq!(
            get_market_data_path("AAPL"),
            format!("{MARKET_DATA_BASE_PATH}/data/A/AAPL.json")
        );
        assert_eq!(
            get_market_data_path("TSLA"),
            format!("{MARKET_DATA_BASE_PATH}/data/T/TSLA.json")
        );
    }

    #[test]
    fn test_read_tsv_score_file() {
        let result = read_tsv_score_file("docs/scores/2025/June/20.tsv");
        assert!(
            result.is_ok(),
            "Failed to read TSV file: {:?}",
            result.err()
        );

        let stock_records = result.unwrap();
        assert!(!stock_records.is_empty());

        // Check that we have the expected number of records (19 in the file)
        assert_eq!(stock_records.len(), 19);

        // Check first record
        let first_record = &stock_records[0];
        assert_eq!(first_record.stock, "NYSE:SEM");
        assert_eq!(first_record.score, 1.0);
        assert_eq!(first_record.target, 22.63);
        assert_eq!(
            first_record.ex_dividend_date,
            Some("2025-05-15".to_string())
        );
        assert_eq!(first_record.dividend_per_share, Some(0.09375));

        // Check that all records have valid stock symbols
        for (i, record) in stock_records.iter().enumerate() {
            if !validate_stock_symbol(&record.stock) {
                println!(
                    "Invalid stock symbol at row {row}: {symbol}",
                    row = i + 2,
                    symbol = record.stock
                );
            }
            assert!(validate_stock_symbol(&record.stock));
        }
    }

    #[test]
    fn test_extract_ticker_codes_from_score_file() {
        let result = extract_ticker_codes_from_score_file("docs/scores/2025/June/20.tsv");
        assert!(
            result.is_ok(),
            "Failed to read TSV file: {:?}",
            result.err()
        );

        let ticker_codes = result.unwrap();
        assert!(!ticker_codes.is_empty());

        // Check that we have the expected number of ticker codes (19 in the file)
        assert_eq!(ticker_codes.len(), 19);

        // Check that we have some expected ticker codes
        assert!(ticker_codes.contains(&"NYSE:SEM".to_string()));
        assert!(ticker_codes.contains(&"NASDAQ:PPC".to_string()));
        assert!(ticker_codes.contains(&"NYSE:OI".to_string()));

        // Check that all ticker codes are valid
        for ticker in &ticker_codes {
            assert!(validate_stock_symbol(ticker));
        }
    }

    #[test]
    fn test_extract_symbol_from_ticker() {
        assert_eq!(extract_symbol_from_ticker("NASDAQ:CALM"), "CALM");
        assert_eq!(extract_symbol_from_ticker("NYSE:SEM"), "SEM");
        assert_eq!(extract_symbol_from_ticker("SEM"), "SEM");
        assert_eq!(extract_symbol_from_ticker(""), "");
        assert_eq!(extract_symbol_from_ticker("LON:VOD.L"), "VOD-L");
        assert_eq!(extract_symbol_from_ticker("NYSE:HEI.A"), "HEI-A");
    }

    #[test]
    fn test_derive_csv_output_path() {
        assert_eq!(
            derive_csv_output_path("docs/scores/2025/June/20.tsv"),
            "docs/scores/2025/June/20.csv"
        );
        assert_eq!(
            derive_csv_output_path("scores/2025/June/21.tsv"),
            "scores/2025/June/21.csv"
        );
        assert_eq!(derive_csv_output_path("20.tsv"), "20.csv");
    }

    #[test]
    fn test_read_market_data() {
        // Skip test if external data repository is not available
        if !std::path::Path::new(MARKET_DATA_BASE_PATH).exists() {
            println!("Skipping test_read_market_data: external data repository not available");
            return;
        }

        let result = read_market_data("SEM");
        assert!(
            result.is_ok(),
            "Failed to read market data: {:?}",
            result.err()
        );

        let market_data = result.unwrap();
        assert_eq!(market_data.meta_data.symbol, "SEM");
        assert!(!market_data.time_series_daily.is_empty());

        // Check that we have some recent data
        let recent_dates: Vec<&String> = market_data.time_series_daily.keys().collect();
        assert!(!recent_dates.is_empty());
    }

    #[test]
    fn test_filter_market_data_by_date_range() {
        // Skip test if external data repository is not available
        if !std::path::Path::new(MARKET_DATA_BASE_PATH).exists() {
            println!("Skipping test_filter_market_data_by_date_range: external data repository not available");
            return;
        }

        let result = read_market_data("SEM");
        if result.is_err() {
            println!("Market data file not found, skipping test");
            return;
        }

        let market_data = result.unwrap();
        let filtered_data =
            filter_market_data_by_date_range(&market_data, "2025-06-15", "2025-06-20").unwrap();

        assert!(!filtered_data.is_empty());

        // Check that all dates are within the range
        for (date_str, _price) in &filtered_data {
            let date = NaiveDate::parse_from_str(date_str, "%Y-%m-%d").unwrap();
            let start = NaiveDate::parse_from_str("2025-06-15", "%Y-%m-%d").unwrap();
            let end = NaiveDate::parse_from_str("2025-06-20", "%Y-%m-%d").unwrap();

            assert!(date >= start && date <= end);
        }

        // Check that data is sorted by date
        for i in 1..filtered_data.len() {
            let prev_date = NaiveDate::parse_from_str(&filtered_data[i - 1].0, "%Y-%m-%d").unwrap();
            let curr_date = NaiveDate::parse_from_str(&filtered_data[i].0, "%Y-%m-%d").unwrap();
            assert!(prev_date <= curr_date);
        }
    }

    #[test]
    fn test_get_dividend_data_path() {
        assert_eq!(
            get_dividend_data_path("SEM"),
            format!("{DIVIDEND_DATA_BASE_PATH}/data/S/SEM.json")
        );
        assert_eq!(
            get_dividend_data_path("AAPL"),
            format!("{DIVIDEND_DATA_BASE_PATH}/data/A/AAPL.json")
        );
        assert_eq!(
            get_dividend_data_path(""),
            format!("{DIVIDEND_DATA_BASE_PATH}/data/X/.json")
        );
    }

    #[test]
    fn test_derive_dividend_csv_output_path() {
        assert_eq!(
            derive_dividend_csv_output_path("docs/scores/2025/June/20.tsv"),
            "docs/scores/2025/June/20-dividends.csv"
        );
        assert_eq!(
            derive_dividend_csv_output_path("test.tsv"),
            "test-dividends.csv"
        );
    }
}
