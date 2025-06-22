use anyhow::Result;
use clap::Parser;
use log::info;

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

    // TODO: Add processing logic here

    info!("Processing completed successfully");
    Ok(())
}
