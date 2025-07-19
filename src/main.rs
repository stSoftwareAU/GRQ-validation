use anyhow::Result;
use chrono::{NaiveDate, Utc};
use clap::Parser;
use log::info;
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

    /// Process all score files, including those more than 100 days old (default: only process recent files)
    #[arg(long)]
    process_all: bool,
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

    // Read the index to get all score files
    let index_data = read_index_json(&args.docs_path)?;
    info!("Found {} score files to process", index_data.scores.len());

    // Filter out score files that are more than 100 days old (unless --process-all is specified)
    let scores_to_process = if args.process_all {
        info!("Processing all score files (including old ones)");
        index_data.scores.iter().collect()
    } else {
        let today = Utc::now().naive_utc().date();
        let cutoff_date = today - chrono::Duration::days(100);

        let recent_scores: Vec<_> = index_data
            .scores
            .iter()
            .filter(|score| {
                if let Ok(score_date) = NaiveDate::parse_from_str(&score.date, "%Y-%m-%d") {
                    score_date >= cutoff_date
                } else {
                    false
                }
            })
            .collect();

        info!(
            "Filtered to {} recent score files (within 100 days)",
            recent_scores.len()
        );
        if recent_scores.len() < index_data.scores.len() {
            info!(
                "Skipped {} old score files (more than 100 days old)",
                index_data.scores.len() - recent_scores.len()
            );
        }
        recent_scores
    };

    let mut processed_count = 0;
    let mut error_count = 0;

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

                        // Also create dividend CSV file
                        match create_dividend_csv_for_score_file(
                            &score_file_path,
                            &ticker_codes,
                            &score_entry.date,
                        ) {
                            Ok(_) => {
                                info!("Successfully created dividend CSV for {score_file_path}");
                            }
                            Err(e) => {
                                log::warn!(
                                    "Failed to create dividend CSV for {score_file_path}: {e}"
                                );
                            }
                        }

                        processed_count += 1;
                    }
                    Err(e) => {
                        log::error!("Failed to create CSV for {score_file_path}: {e}");
                        error_count += 1;
                    }
                }
            }
            Err(e) => {
                log::error!("Failed to read ticker codes from {score_file_path}: {e}");
                error_count += 1;
            }
        }
    }

    info!("Processing completed: {processed_count} successful, {error_count} errors");

    if error_count > 0 {
        log::warn!("Some files had errors, but processing continued");
    }

    Ok(())
}
