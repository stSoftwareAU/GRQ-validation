use anyhow::Result;
use clap::Parser;
use log::info;
use chrono::NaiveDate;

mod models;
mod processor;
mod utils;

use processor::StockProcessor;
use utils::parse_date_string;

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    /// Path to the docs directory containing TSV files
    #[arg(short, long, default_value = "docs")]
    docs_path: String,
    
    /// Process all TSV files recursively
    #[arg(short, long)]
    recursive: bool,
    
    /// Specific TSV file to process
    #[arg(short, long)]
    file: Option<String>,
    
    /// Update scores for a specific date (YYYY-MM-DD format)
    #[arg(long)]
    date: Option<String>,
    
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
    
    let processor = StockProcessor::new(&args.docs_path);
    
    if let Some(date_str) = args.date {
        // Update scores for a specific date
        let date = parse_date_string(&date_str)?;
        info!("Updating scores for date: {}", date);
        processor.update_daily_scores(date)?;
    } else if args.recursive {
        // Process all TSV files recursively
        info!("Processing all TSV files recursively");
        let results = processor.process_all_tsv_files()?;
        info!("Successfully processed {} files", results.len());
        
        for result in results {
            info!("Date: {}, Stocks: {}, Avg Score: {:.3}", 
                  result.date, 
                  result.records.len(), 
                  result.summary.average_score);
        }
    } else if let Some(file_path) = args.file {
        // Process a specific file
        info!("Processing specific file: {}", file_path);
        let data = processor.process_tsv_file(std::path::Path::new(&file_path))?;
        info!("Successfully processed file with {} records", data.records.len());
        info!("Date: {}, Avg Score: {:.3}", 
              data.date, 
              data.summary.average_score);
    } else {
        // Default: process all files
        info!("Processing all TSV files");
        let results = processor.process_all_tsv_files()?;
        info!("Successfully processed {} files", results.len());
    }
    
    info!("Processing completed successfully");
    Ok(())
} 