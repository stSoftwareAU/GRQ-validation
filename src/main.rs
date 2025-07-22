use anyhow::{anyhow, Result};
use chrono::{NaiveDate, Utc};
use clap::Parser;
use log::info;
use std::path::Path;
use utils::{
    create_dividend_csv_for_score_file, create_market_data_long_csv_for_score_file,
    extract_ticker_codes_from_score_file, read_index_json,
};

pub mod models;
pub mod utils;

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    /// Path to the docs directory containing TSV files
    #[arg(short, long, default_value = "docs")]
    docs_path: String,

    /// Enable verbose logging
    #[arg(short, long)]
    verbose: bool,

    /// Process all score files, including those more than 180 days old
    #[arg(long)]
    process_all: bool,

    /// Calculate performance metrics for score files
    #[arg(long)]
    calculate_performance: bool,

    /// Only calculate performance metrics (skip CSV generation)
    #[arg(long)]
    performance_only: bool,

    /// Process a specific date (format: YYYY-MM-DD)
    #[arg(long)]
    date: Option<String>,
}

fn main() -> Result<()> {
    let args = Args::parse();

    // Initialize logging
    if args.verbose {
        env_logger::init_from_env(env_logger::Env::default().default_filter_or("debug"));
    } else {
        env_logger::init_from_env(env_logger::Env::default().default_filter_or("info"));
    }

    info!("Starting GRQ Validation processor");
    info!("Docs path: {}", args.docs_path);

    // Process a specific date if provided
    if let Some(date) = args.date {
        info!("Processing specific date: {date}");

        // Parse the date to extract year, month, day
        let date_parts: Vec<&str> = date.split('-').collect();
        if date_parts.len() != 3 {
            return Err(anyhow!("Invalid date format. Use YYYY-MM-DD"));
        }

        let year = date_parts[0];
        let month = date_parts[1];
        let day = date_parts[2];

        // Convert month number to month name
        let month_name = match month {
            "01" => "January",
            "02" => "February",
            "03" => "March",
            "04" => "April",
            "05" => "May",
            "06" => "June",
            "07" => "July",
            "08" => "August",
            "09" => "September",
            "10" => "October",
            "11" => "November",
            "12" => "December",
            _ => return Err(anyhow!("Invalid month: {}", month)),
        };

        let score_file_path = format!(
            "{}/scores/{}/{}/{}.tsv",
            args.docs_path, year, month_name, day
        );
        let score_file_date = &date;

        // Check if the date is less than 90 days old
        let score_date = NaiveDate::parse_from_str(score_file_date, "%Y-%m-%d")?;
        let current_date = Utc::now().naive_utc().date();
        let days_since_score = (current_date - score_date).num_days();

        if days_since_score >= 90 {
            // Use regular performance calculation
            match utils::calculate_portfolio_performance(&score_file_path, score_file_date) {
                Ok(performance) => {
                    println!("\n=== {date} Performance Results ===");
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

                    // Update the index.json with this performance data
                    let mut index_data = utils::read_index_json(&args.docs_path)?;
                    for score_entry in &mut index_data.scores {
                        if score_entry.date == date {
                            score_entry.performance_90_day = Some(performance.performance_90_day);
                            score_entry.performance_annualized =
                                Some(performance.performance_annualized);
                            score_entry.total_stocks = Some(performance.total_stocks);
                            break;
                        }
                    }

                    // Write updated index back to file
                    let index_path = Path::new(&args.docs_path).join("scores").join("index.json");
                    let json_content = serde_json::to_string_pretty(&index_data)?;
                    std::fs::write(index_path, json_content)?;
                    println!("\nUpdated index.json with performance data for {date}");
                }
                Err(e) => {
                    log::error!("Failed to calculate performance: {e}");
                    return Err(e);
                }
            }
        } else {
            // Use hybrid projection for dates less than 90 days old
            match utils::read_tsv_score_file(&score_file_path) {
                Ok(stock_records) => {
                    match utils::read_market_data_from_csv(&utils::derive_csv_output_path(
                        &score_file_path,
                    )) {
                        Ok(market_data_csv) => {
                            match utils::calculate_hybrid_projection(
                                &stock_records,
                                score_file_date,
                                &market_data_csv,
                            ) {
                                Ok(performance) => {
                                    println!("\n=== {date} Projection Results ===");
                                    println!("Score Date: {}", performance.score_date);
                                    println!("Total Stocks: {}", performance.total_stocks);
                                    println!(
                                        "Projected 90-Day Performance: {:.2}%",
                                        performance.performance_90_day
                                    );
                                    println!(
                                        "Projected Annualized Performance: {:.2}%",
                                        performance.performance_annualized
                                    );
                                    println!();

                                    println!("Individual Stock Projections:");
                                    for stock_perf in &performance.individual_performances {
                                        println!("  {}: Buy=${:.2}, Current=${:.2}, Projected Gain/Loss={:.2}%, Dividends=${:.2}, Total Return={:.2}%",
                                            stock_perf.ticker,
                                            stock_perf.buy_price,
                                            stock_perf.current_price,
                                            stock_perf.gain_loss_percent,
                                            stock_perf.dividends_total,
                                            stock_perf.total_return_percent
                                        );
                                    }

                                    // Update the index.json with this projection data
                                    let mut index_data = utils::read_index_json(&args.docs_path)?;
                                    for score_entry in &mut index_data.scores {
                                        if score_entry.date == date {
                                            score_entry.performance_90_day =
                                                Some(performance.performance_90_day);
                                            score_entry.performance_annualized =
                                                Some(performance.performance_annualized);
                                            score_entry.total_stocks =
                                                Some(performance.total_stocks);
                                            break;
                                        }
                                    }

                                    // Write updated index back to file
                                    let index_path = Path::new(&args.docs_path)
                                        .join("scores")
                                        .join("index.json");
                                    let json_content = serde_json::to_string_pretty(&index_data)?;
                                    std::fs::write(index_path, json_content)?;
                                    println!(
                                        "\nUpdated index.json with projection data for {date}"
                                    );
                                }
                                Err(e) => {
                                    log::error!("Failed to calculate projection: {e}");
                                    return Err(e);
                                }
                            }
                        }
                        Err(e) => {
                            log::error!("Failed to read market data CSV: {e}");
                            return Err(e);
                        }
                    }
                }
                Err(e) => {
                    log::error!("Failed to read TSV file: {e}");
                    return Err(e);
                }
            }
        }

        info!("Single date processing completed");
        return Ok(());
    }

    // Calculate performance for all score files that are at least 90 days old
    if args.calculate_performance {
        info!("Calculating performance metrics for all score files...");
        match utils::update_index_with_performance(&args.docs_path) {
            Ok(_) => {
                info!("Successfully updated index.json with performance metrics");
            }
            Err(e) => {
                log::error!("Failed to update performance metrics: {e}");
            }
        }
        return Ok(());
    }

    // Read the index to get all score files
    let index_data = read_index_json(&args.docs_path)?;
    info!("Found {} score files to process", index_data.scores.len());

    // Filter out score files that are more than 180 days old (unless --process-all is specified)
    let current_date = Utc::now().naive_utc().date();
    let scores_to_process: Vec<_> = if args.process_all {
        index_data.scores.iter().collect()
    } else {
        index_data
            .scores
            .iter()
            .filter(|score_entry| {
                if let Ok(score_date) = NaiveDate::parse_from_str(&score_entry.date, "%Y-%m-%d") {
                    let days_since_score = (current_date - score_date).num_days();
                    days_since_score <= 180
                } else {
                    false
                }
            })
            .collect()
    };

    info!(
        "Filtered to {} recent score files (within 180 days)",
        scores_to_process.len()
    );
    info!(
        "Skipped {} old score files (more than 180 days old)",
        index_data.scores.len() - scores_to_process.len()
    );

    // Process each score file
    for (i, score_entry) in scores_to_process.iter().enumerate() {
        let score_file_path = format!("{}/scores/{}", args.docs_path, score_entry.file);

        info!(
            "Processing score file {}/{}: {}",
            i + 1,
            index_data.scores.len(),
            score_file_path
        );
        info!("Score file date: {}", score_entry.date);

        // Extract ticker codes from the score file
        match extract_ticker_codes_from_score_file(&score_file_path) {
            Ok(ticker_codes) => {
                info!("Found {} ticker codes in score file", ticker_codes.len());

                // Create CSV file with market data in long format in the same directory as the score file
                match create_market_data_long_csv_for_score_file(
                    &score_file_path,
                    &ticker_codes,
                    &score_entry.date,
                    None,
                ) {
                    Ok(output_path) => {
                        info!("Successfully created market data CSV: {output_path}");
                    }
                    Err(e) => {
                        log::error!("Failed to create market data CSV: {e}");
                    }
                }

                // Create dividend CSV file
                match create_dividend_csv_for_score_file(
                    &score_file_path,
                    &ticker_codes,
                    &score_entry.date,
                ) {
                    Ok(_) => {
                        info!("Successfully created dividend CSV for {score_file_path}");
                    }
                    Err(e) => {
                        log::error!("Failed to create dividend CSV: {e}");
                    }
                }

                // Calculate performance for this score file immediately after creating CSVs
                info!("Calculating performance for {}", score_entry.date);
                match utils::calculate_portfolio_performance(&score_file_path, &score_entry.date) {
                    Ok(performance) => {
                        info!(
                            "Performance for {}: {:.2}% (90-day), {:.2}% (annualized)",
                            score_entry.date,
                            performance.performance_90_day,
                            performance.performance_annualized
                        );

                        // Update the index.json with this performance data
                        let mut index_data = utils::read_index_json(&args.docs_path)?;
                        for score_entry_update in &mut index_data.scores {
                            if score_entry_update.date == score_entry.date {
                                score_entry_update.performance_90_day =
                                    Some(performance.performance_90_day);
                                score_entry_update.performance_annualized =
                                    Some(performance.performance_annualized);
                                score_entry_update.total_stocks = Some(performance.total_stocks);
                                break;
                            }
                        }

                        // Write updated index back to file
                        let index_path =
                            Path::new(&args.docs_path).join("scores").join("index.json");
                        let json_content = serde_json::to_string_pretty(&index_data)?;
                        std::fs::write(index_path, json_content)?;
                        info!(
                            "Updated index.json with performance data for {}",
                            score_entry.date
                        );
                    }
                    Err(e) => {
                        log::error!(
                            "Failed to calculate performance for {}: {}",
                            score_entry.date,
                            e
                        );
                    }
                }
            }
            Err(e) => {
                log::error!("Failed to read ticker codes from {score_file_path}: {e}");
            }
        }
    }

    // Note: Performance is now calculated inline for each score file
    // The --calculate-performance flag is kept for backward compatibility
    if args.calculate_performance {
        info!("Performance calculation is now done inline for each score file");
        info!("The --calculate-performance flag is no longer needed for normal operation");
    }

    info!("GRQ Validation processor completed successfully");
    Ok(())
}
