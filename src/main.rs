use anyhow::Result;
use clap::Parser;
use log::info;
use utils::{
    create_market_data_long_csv_for_score_file, extract_ticker_codes_from_score_file,
    read_index_json,
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

    // Read the index to get the first score file
    let index_data = read_index_json(&args.docs_path)?;
    let first_score_entry = &index_data.scores[0];
    let score_file_path = format!("{}/scores/{}", args.docs_path, first_score_entry.file);

    info!("Processing score file: {}", score_file_path);
    info!("Score file date: {}", first_score_entry.date);

    // Extract ticker codes from the score file
    let ticker_codes = extract_ticker_codes_from_score_file(&score_file_path)?;
    info!("Found {} ticker codes in score file", ticker_codes.len());

    // Create CSV file with market data in long format in the same directory as the score file
    let output_path = create_market_data_long_csv_for_score_file(
        &score_file_path,
        &ticker_codes,
        &first_score_entry.date,
        None,
    )?;

    info!("Successfully created market data CSV: {}", output_path);
    info!("Processing completed successfully");
    Ok(())
}
