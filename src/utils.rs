use crate::models::{
    DividendData, IndexData, MarketData, PortfolioPerformance, StockPerformance, StockRecord,
};
use anyhow::{anyhow, Result};
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

pub fn read_market_data_from_csv(
    csv_file_path: &str,
) -> Result<HashMap<String, HashMap<String, f64>>> {
    use csv::ReaderBuilder;
    use std::fs::File;

    let file = File::open(csv_file_path)?;
    let mut reader = ReaderBuilder::new().has_headers(true).from_reader(file);

    let mut market_data: HashMap<String, HashMap<String, f64>> = HashMap::new();

    for result in reader.records() {
        let record = result?;
        if record.len() >= 6 {
            let date = record[0].to_string();
            let full_ticker = record[1].to_string();
            let close_price = record[5].parse::<f64>().unwrap_or(0.0); // Use close price (column 5)

            if close_price > 0.0 {
                // Store data using the full ticker (e.g., "NYSE:MBC")
                market_data
                    .entry(full_ticker)
                    .or_default()
                    .insert(date, close_price);
            }
        }
    }

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

/// Calculates portfolio performance for a given score file
pub fn calculate_portfolio_performance(
    score_file_path: &str,
    score_file_date: &str,
) -> Result<PortfolioPerformance> {
    // Read the score file
    let stock_records = read_tsv_score_file(score_file_path)?;
    let total_stocks = stock_records.len() as i32;

    // Calculate the 90-day end date
    let score_date = NaiveDate::parse_from_str(score_file_date, "%Y-%m-%d")?;
    let end_date = score_date + Duration::days(90);
    let end_date_str = end_date.format("%Y-%m-%d").to_string();

    // Read market data from the CSV file that was created by the program
    let csv_file_path = derive_csv_output_path(score_file_path);
    let market_data_csv = read_market_data_from_csv(&csv_file_path)?;

    let mut individual_performances = Vec::new();

    for record in &stock_records {
        // Use the full ticker (e.g., "NYSE:SEM") to match CSV data
        let full_ticker = &record.stock;

        // Get the buy price (first day close) from CSV data
        let buy_price = if let Some(first_day_data) = market_data_csv.get(full_ticker) {
            if let Some(first_day) = first_day_data.get(score_file_date) {
                *first_day
            } else {
                // Find the next available trading day
                let mut next_trading_day_price = 0.0;
                let mut next_trading_day_date = None;

                for (date_str, price) in first_day_data {
                    if let Ok(date) = NaiveDate::parse_from_str(date_str, "%Y-%m-%d") {
                        if date >= score_date
                            && (next_trading_day_date.is_none()
                                || date < next_trading_day_date.unwrap())
                        {
                            next_trading_day_date = Some(date);
                            next_trading_day_price = *price;
                        }
                    }
                }

                if next_trading_day_price > 0.0 {
                    next_trading_day_price
                } else {
                    continue; // Skip if no data after score date
                }
            }
        } else {
            continue; // Skip if no data for this symbol
        };

        // Get the current price (90-day end date or latest available)
        let current_price = if let Some(symbol_data) = market_data_csv.get(full_ticker) {
            if let Some(end_day) = symbol_data.get(&end_date_str) {
                *end_day
            } else {
                // Find the latest available price within 90 days
                let mut latest_price = 0.0;
                let mut latest_date = score_date;

                for (date_str, price) in symbol_data {
                    if let Ok(date) = NaiveDate::parse_from_str(date_str, "%Y-%m-%d") {
                        if date >= score_date && date <= end_date && date >= latest_date {
                            latest_date = date;
                            latest_price = *price;
                        }
                    }
                }
                latest_price
            }
        } else {
            continue; // Skip if no data for this symbol
        };

        if buy_price > 0.0 && current_price > 0.0 {
            // Calculate price gain/loss
            let gain_loss_percent = ((current_price - buy_price) / buy_price) * 100.0;

            // Calculate dividends for the 90-day period
            let dividends_total =
                calculate_dividends_for_period(full_ticker, score_file_date, &end_date_str)
                    .unwrap_or(0.0);

            // Calculate total return (price + dividends)
            let total_return_percent = gain_loss_percent + (dividends_total / buy_price * 100.0);

            individual_performances.push(StockPerformance {
                ticker: record.stock.clone(),
                buy_price,
                target_price: record.target,
                current_price,
                gain_loss_percent,
                dividends_total,
                total_return_percent,
            });
        }
    }

    // Calculate portfolio performance
    let performance_90_day = if !individual_performances.is_empty() {
        let total_return: f64 = individual_performances
            .iter()
            .map(|p| p.total_return_percent)
            .sum();
        total_return / individual_performances.len() as f64
    } else {
        0.0
    };

    // Calculate annualized performance (90 days = 0.2466 years)
    let performance_annualized = if performance_90_day != 0.0 {
        ((1.0 + performance_90_day / 100.0).powf(1.0 / 0.2466) - 1.0) * 100.0
    } else {
        0.0
    };

    Ok(PortfolioPerformance {
        score_date: score_file_date.to_string(),
        total_stocks,
        performance_90_day,
        performance_annualized,
        individual_performances,
    })
}

/// Calculates hybrid projection for scores less than 90 days old
pub fn calculate_hybrid_projection(
    stock_records: &[StockRecord],
    score_file_date: &str,
    market_data_csv: &HashMap<String, HashMap<String, f64>>,
) -> Result<PortfolioPerformance> {
    let score_date = NaiveDate::parse_from_str(score_file_date, "%Y-%m-%d")?;
    let current_date = chrono::Utc::now().naive_utc().date();
    let days_elapsed = (current_date - score_date).num_days();

    if days_elapsed >= 90 {
        return Err(anyhow!(
            "Score is already 90 days old, use regular performance calculation"
        ));
    }

    let mut individual_performances = Vec::new();
    let mut total_projected_performance = 0.0;
    let mut valid_projections = 0;

    for record in stock_records {
        let full_ticker = &record.stock;

        // Get current performance data
        if let Some(symbol_data) = market_data_csv.get(full_ticker) {
            // Find the latest available price
            let mut latest_price = 0.0;
            let mut latest_date = score_date;

            for (date_str, price) in symbol_data {
                if let Ok(date) = NaiveDate::parse_from_str(date_str, "%Y-%m-%d") {
                    if date >= score_date && date <= current_date && date >= latest_date {
                        latest_date = date;
                        latest_price = *price;
                    }
                }
            }

            if latest_price > 0.0 {
                // Get buy price (first available price after score date)
                let buy_price = if let Some(first_day_data) = market_data_csv.get(full_ticker) {
                    if let Some(first_day) = first_day_data.get(score_file_date) {
                        *first_day
                    } else {
                        // Find the next available trading day
                        let mut next_trading_day_price = 0.0;
                        let mut next_trading_day_date = None;

                        for (date_str, price) in first_day_data {
                            if let Ok(date) = NaiveDate::parse_from_str(date_str, "%Y-%m-%d") {
                                if date >= score_date
                                    && (next_trading_day_date.is_none()
                                        || date < next_trading_day_date.unwrap())
                                {
                                    next_trading_day_date = Some(date);
                                    next_trading_day_price = *price;
                                }
                            }
                        }
                        next_trading_day_price
                    }
                } else {
                    0.0
                };

                if buy_price > 0.0 {
                    let gain_loss_percent = ((latest_price - buy_price) / buy_price) * 100.0;
                    let current_rate = gain_loss_percent / days_elapsed as f64; // % per day

                    // Calculate projected 90-day performance based on current trajectory
                    let mut projected_90_day = current_rate * 90.0;

                    // Apply dampening based on days elapsed
                    let dampening_factor = if days_elapsed < 30 {
                        0.3 // Early days: dampen by 70%
                    } else if days_elapsed < 60 {
                        0.5 // Medium term: dampen by 50%
                    } else {
                        0.7 // Later days: dampen by 30%
                    };

                    projected_90_day *= dampening_factor;

                    // Cap at realistic bounds
                    projected_90_day = projected_90_day.clamp(-100.0, 200.0);

                    // Calculate dividends for the period
                    let end_date = score_date + chrono::Duration::days(90);
                    let end_date_str = end_date.format("%Y-%m-%d").to_string();
                    let dividends_total =
                        calculate_dividends_for_period(full_ticker, score_file_date, &end_date_str)
                            .unwrap_or(0.0);

                    // Calculate total return including dividends
                    let total_return_percent =
                        projected_90_day + (dividends_total / buy_price * 100.0);

                    individual_performances.push(StockPerformance {
                        ticker: record.stock.clone(),
                        buy_price,
                        target_price: record.target,
                        current_price: latest_price,
                        gain_loss_percent: projected_90_day,
                        dividends_total,
                        total_return_percent,
                    });

                    total_projected_performance += total_return_percent;
                    valid_projections += 1;
                }
            }
        }
    }

    // Calculate average projected performance
    let performance_90_day = if valid_projections > 0 {
        total_projected_performance / valid_projections as f64
    } else {
        0.0
    };

    // Calculate annualized performance
    let performance_annualized = if performance_90_day != 0.0 {
        ((1.0 + performance_90_day / 100.0).powf(365.25 / 90.0) - 1.0) * 100.0
    } else {
        0.0
    };

    Ok(PortfolioPerformance {
        score_date: score_file_date.to_string(),
        total_stocks: stock_records.len() as i32,
        performance_90_day,
        performance_annualized,
        individual_performances,
    })
}

/// Calculates total dividends for a stock in a given date range
fn calculate_dividends_for_period(symbol: &str, start_date: &str, end_date: &str) -> Result<f64> {
    match read_dividend_data(symbol) {
        Ok(dividend_data) => {
            let filtered_data =
                filter_dividend_data_by_date_range(&dividend_data, start_date, end_date)?;

            let total_dividends: f64 = filtered_data.iter().map(|(_, amount)| amount).sum();

            Ok(total_dividends)
        }
        Err(_) => Ok(0.0), // Return 0 if no dividend data available
    }
}

/// Updates the index.json file with performance metrics
pub fn update_index_with_performance(docs_path: &str) -> Result<()> {
    let mut index_data = read_index_json(docs_path)?;

    for score_entry in &mut index_data.scores {
        let score_file_path = format!("{}/scores/{}", docs_path, score_entry.file);

        // Only calculate performance for files that are at least 90 days old
        let score_date = NaiveDate::parse_from_str(&score_entry.date, "%Y-%m-%d")?;
        let current_date = chrono::Utc::now().naive_utc().date();
        let days_since_score = (current_date - score_date).num_days();

        if days_since_score >= 90 {
            match calculate_portfolio_performance(&score_file_path, &score_entry.date) {
                Ok(performance) => {
                    score_entry.performance_90_day = Some(performance.performance_90_day);
                    score_entry.performance_annualized = Some(performance.performance_annualized);
                    score_entry.total_stocks = Some(performance.total_stocks);
                }
                Err(e) => {
                    println!(
                        "Warning: Could not calculate performance for {}: {}",
                        score_entry.file, e
                    );
                }
            }
        } else {
            // For scores less than 90 days old, use hybrid projection
            match read_tsv_score_file(&score_file_path) {
                Ok(stock_records) => {
                    match read_market_data_from_csv(&derive_csv_output_path(&score_file_path)) {
                        Ok(market_data_csv) => {
                            match calculate_hybrid_projection(
                                &stock_records,
                                &score_entry.date,
                                &market_data_csv,
                            ) {
                                Ok(performance) => {
                                    score_entry.performance_90_day =
                                        Some(performance.performance_90_day);
                                    score_entry.performance_annualized =
                                        Some(performance.performance_annualized);
                                    score_entry.total_stocks = Some(performance.total_stocks);
                                }
                                Err(e) => {
                                    println!(
                                        "Warning: Could not calculate hybrid projection for {}: {}",
                                        score_entry.file, e
                                    );
                                }
                            }
                        }
                        Err(e) => {
                            println!(
                                "Warning: Could not read market data CSV for {}: {}",
                                score_entry.file, e
                            );
                        }
                    }
                }
                Err(e) => {
                    println!(
                        "Warning: Could not read TSV file for {}: {}",
                        score_entry.file, e
                    );
                }
            }
        }
    }

    // Write updated index back to file
    let index_path = Path::new(docs_path).join("scores").join("index.json");
    let json_content = serde_json::to_string_pretty(&index_data)?;
    std::fs::write(index_path, json_content)?;

    Ok(())
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
    fn test_read_tsv_score_file_with_currency() {
        let result = read_tsv_score_file("docs/scores/2025/May/27.tsv");
        assert!(
            result.is_ok(),
            "Failed to read TSV file with currency values: {:?}",
            result.err()
        );

        let stock_records = result.unwrap();
        assert!(!stock_records.is_empty());

        // Check that we have the expected number of records (22 in the file)
        assert_eq!(stock_records.len(), 22);

        // Check first record with currency values
        let first_record = &stock_records[0];
        assert_eq!(first_record.stock, "NYSE:SEM");
        assert_eq!(first_record.score, 1.0);
        assert_eq!(first_record.target, 21.99); // Should parse "$21.99" correctly
        assert_eq!(
            first_record.ex_dividend_date,
            Some("15 May 2025".to_string())
        );
        assert_eq!(first_record.dividend_per_share, Some(0.09375));

        // Check a record with negative currency values
        let record_with_negative = stock_records
            .iter()
            .find(|r| r.stock == "NYSE:SHG")
            .unwrap();
        assert_eq!(
            record_with_negative.intrinsic_value_per_share_basic,
            Some(-555.69)
        ); // Should parse "-$555.69" correctly
        assert_eq!(
            record_with_negative.intrinsic_value_per_share_adjusted,
            Some(-538.38)
        ); // Should parse "-$538.38" correctly

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

    #[test]
    fn test_calculate_performance_november_15_2024() {
        // Skip test if external data repository is not available
        if !std::path::Path::new(MARKET_DATA_BASE_PATH).exists() {
            println!("Skipping test_calculate_performance_november_15_2024: external data repository not available");
            return;
        }

        let score_file_path = "docs/scores/2024/November/15.tsv";
        let score_file_date = "2024-11-15";

        let result = calculate_portfolio_performance(score_file_path, score_file_date);
        assert!(
            result.is_ok(),
            "Failed to calculate performance: {:?}",
            result.err()
        );

        let performance = result.unwrap();

        println!("=== November 15, 2024 Performance Results ===");
        println!("Score Date: {}", performance.score_date);
        println!("Total Stocks: {}", performance.total_stocks);
        println!("90-Day Performance: {:.2}%", performance.performance_90_day);
        println!(
            "Annualized Performance: {:.2}%",
            performance.performance_annualized
        );
        println!();

        println!("Individual Stock Performances:");
        for stock_perf in &performance.individual_performances {
            println!("  {}: Buy=${:.2}, Current=${:.2}, Gain/Loss={:.2}%, Dividends=${:.2}, Total Return={:.2}%",
                stock_perf.ticker,
                stock_perf.buy_price,
                stock_perf.current_price,
                stock_perf.gain_loss_percent,
                stock_perf.dividends_total,
                stock_perf.total_return_percent
            );
        }

        // Basic assertions
        assert_eq!(performance.score_date, "2024-11-15");
        assert!(performance.total_stocks > 0);

        // The 90-day period should be from 2024-11-15 to 2025-02-13
        // Since this is historical data, we should have results
        assert!(
            performance.performance_90_day != 0.0 || performance.individual_performances.is_empty()
        );

        // Annualized performance should be calculated if we have 90-day performance
        if performance.performance_90_day != 0.0 {
            assert!(performance.performance_annualized != 0.0);
        }
    }
}
