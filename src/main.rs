use anyhow::{anyhow, Context, Result};
use chrono::{NaiveDate, Utc};
use clap::Parser;
use grq_validation::data_roots::DataRoots;
use grq_validation::picks_backfill::backfill_picks_sidecars;
use grq_validation::utils::{
    build_score_file_path, create_dividend_csv_for_score_file,
    create_market_data_long_csv_for_score_file, derive_csv_output_path,
    ensure_market_data_repository_at, extract_ticker_codes_from_score_file,
    find_unpaired_prediction_dates, is_market_data_csv_empty, read_index_json,
};
use log::info;
use std::path::Path;

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    /// Path to the docs directory containing TSV files
    #[arg(short, long, default_value = "docs")]
    docs_path: String,

    /// Directory holding the market-data `data/<LETTER>/<SYMBOL>.json` tree; overrides GRQ_MARKET_DATA_PATH
    #[arg(long)]
    market_data_path: Option<String>,

    /// Directory holding the dividend-history `data/<LETTER>/<SYMBOL>.json` tree; overrides GRQ_DIVIDEND_DATA_PATH
    #[arg(long)]
    dividend_data_path: Option<String>,

    /// Enable verbose logging
    #[arg(short, long)]
    verbose: bool,

    /// Process all score files, including those more than 180 days old
    #[arg(long)]
    process_all: bool,

    /// Process only score files whose market-data CSV is missing or header-only
    #[arg(long)]
    regenerate_empty: bool,

    /// Rebuild only the `<date>-picks.csv` sidecar, for every date in the index
    /// (or for `--date` alone); nothing else is regenerated
    #[arg(long)]
    regenerate_picks: bool,

    /// Calculate performance metrics for score files
    #[arg(long)]
    calculate_performance: bool,

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

    // The pick-details backfill (issue #839) rebuilds only `<date>-picks.csv`,
    // across every date in the index — including the ones far older than the
    // 180-day cut-off the other modes apply. It reads market data alone, so it
    // resolves that root only rather than failing an operator for a dividend
    // root it would never open.
    if args.regenerate_picks {
        let market_root = DataRoots::resolve_market(args.market_data_path.as_deref())?;
        info!("Market data root: {}", market_root.display());
        ensure_market_data_repository_at(&market_root)?;

        let summary = backfill_picks_sidecars(&market_root, &args.docs_path, args.date.as_deref())?;
        println!("{}", summary.render());

        // Absence of an explicit failure is not success: a run that wrote no
        // sidecar at all points at a misconfigured root or docs path, so it
        // exits non-zero rather than reporting a clean, empty backfill.
        if summary.written.is_empty() {
            return Err(anyhow!(
                "Pick-details backfill wrote no sidecars for {} considered date(s) — \
                 is {} available and up to date?",
                summary.considered.len(),
                market_root.display()
            ));
        }

        return Ok(());
    }

    // Resolve and validate both caller-supplied data roots before any work
    // begins, so a misconfigured host fails loudly at start-up with one message
    // listing every unusable root — never per-ticker deep in a run (issue #803).
    let roots = DataRoots::resolve(
        args.market_data_path.as_deref(),
        args.dividend_data_path.as_deref(),
    )?;
    info!("Market data root: {}", roots.market.display());
    info!("Dividend data root: {}", roots.dividends.display());

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
            _ => return Err(anyhow!("Invalid month: {month}")),
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
            // Use regular performance calculation. `?` propagates the error to
            // `main`, which prints the full context chain on exit.
            let performance = grq_validation::utils::calculate_portfolio_performance(
                &roots.dividends,
                &score_file_path,
                score_file_date,
            )
            .with_context(|| format!("calculating performance for {date}"))?;

            println!("\n=== {date} Performance Results ===");
            println!("Score Date: {}", performance.score_date);
            println!("Total Stocks: {} (included)", performance.total_stocks);
            if !performance.excluded_tickers.is_empty() {
                println!("Excluded Stocks: {}", performance.excluded_tickers.len());
                for ticker in &performance.excluded_tickers {
                    println!("  - {ticker} (unpriceable)");
                }
            }
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
            let mut index_data = grq_validation::utils::read_index_json(&args.docs_path)?;
            for score_entry in &mut index_data.scores {
                if score_entry.date == date {
                    score_entry.performance_90_day = Some(performance.performance_90_day);
                    score_entry.performance_annualized = Some(performance.performance_annualized);
                    score_entry.total_stocks = Some(performance.total_stocks);
                    break;
                }
            }

            // Write updated index back to file
            let index_path = Path::new(&args.docs_path).join("scores").join("index.json");
            let json_content = serde_json::to_string_pretty(&index_data)?;
            std::fs::write(index_path, json_content)?;
            println!("\nUpdated index.json with performance data for {date}");
        } else {
            // Use hybrid projection for dates less than 90 days old. Each step
            // propagates with `?` plus context instead of a nested match ladder.
            let stock_records = grq_validation::utils::read_tsv_score_file(&score_file_path)
                .with_context(|| format!("reading TSV file {score_file_path}"))?;
            let market_data_csv = grq_validation::utils::read_market_data_from_csv(
                &grq_validation::utils::derive_csv_output_path(&score_file_path),
            )
            .context("reading market data CSV")?
            .closes;
            let performance = grq_validation::utils::calculate_hybrid_projection(
                &roots.dividends,
                &stock_records,
                score_file_date,
                &market_data_csv,
            )
            .with_context(|| format!("calculating projection for {date}"))?;

            println!("\n=== {date} Projection Results ===");
            println!("Score Date: {}", performance.score_date);
            println!("Total Stocks: {} (included)", performance.total_stocks);
            if !performance.excluded_tickers.is_empty() {
                println!("Excluded Stocks: {}", performance.excluded_tickers.len());
                for ticker in &performance.excluded_tickers {
                    println!("  - {ticker} (unpriceable)");
                }
            }
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
            let mut index_data = grq_validation::utils::read_index_json(&args.docs_path)?;
            for score_entry in &mut index_data.scores {
                if score_entry.date == date {
                    score_entry.performance_90_day = Some(performance.performance_90_day);
                    score_entry.performance_annualized = Some(performance.performance_annualized);
                    score_entry.total_stocks = Some(performance.total_stocks);
                    break;
                }
            }

            // Write updated index back to file
            let index_path = Path::new(&args.docs_path).join("scores").join("index.json");
            let json_content = serde_json::to_string_pretty(&index_data)?;
            std::fs::write(index_path, json_content)?;
            println!("\nUpdated index.json with projection data for {date}");
        }

        info!("Single date processing completed");
        return Ok(());
    }

    // Calculate performance for all score files that are at least 90 days old
    if args.calculate_performance {
        info!("Calculating performance metrics for all score files...");
        match grq_validation::utils::update_index_with_performance(
            &roots.dividends,
            &args.docs_path,
        ) {
            Ok(_) => {
                info!("Successfully updated index.json with performance metrics");
            }
            Err(e) => {
                log::error!("Failed to update performance metrics: {e}");
            }
        }
        return Ok(());
    }

    ensure_market_data_repository_at(&roots.market)?;

    // Read the index to get all score files
    let index_data = read_index_json(&args.docs_path)?;
    info!("Found {} score files to process", index_data.scores.len());

    // Filter score files by age, empty CSVs, or --process-all.
    let current_date = Utc::now().naive_utc().date();
    let scores_to_process: Vec<_> = if args.process_all {
        index_data.scores.iter().collect()
    } else if args.regenerate_empty {
        index_data
            .scores
            .iter()
            .filter(|score_entry| {
                build_score_file_path(&args.docs_path, &score_entry.file)
                    .map(|score_file_path| {
                        is_market_data_csv_empty(&derive_csv_output_path(&score_file_path))
                    })
                    .unwrap_or(false)
            })
            .collect()
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

    if args.regenerate_empty {
        info!(
            "Filtered to {} score files with missing or header-only market CSVs",
            scores_to_process.len()
        );
    } else if args.process_all {
        info!("Processing all {} score files", scores_to_process.len());
    } else {
        info!(
            "Filtered to {} recent score files (within 180 days)",
            scores_to_process.len()
        );
        info!(
            "Skipped {} old score files (more than 180 days old)",
            index_data.scores.len() - scores_to_process.len()
        );
    }

    // Process each score file
    for (i, score_entry) in scores_to_process.iter().enumerate() {
        let score_file_path = match build_score_file_path(&args.docs_path, &score_entry.file) {
            Ok(path) => path,
            Err(e) => {
                log::error!("Skipping unsafe score file path {}: {e}", score_entry.file);
                continue;
            }
        };

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
                    &roots.market,
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

                // Create the pick-details sidecar (issue #838): the as-at-the-
                // score-date figures the main CSV cannot carry because they
                // need history from BEFORE the score date.
                match grq_validation::picks_sidecar::create_picks_sidecar_csv_for_score_file(
                    &roots.market,
                    &score_file_path,
                    &ticker_codes,
                    &score_entry.date,
                ) {
                    Ok(output_path) => {
                        info!("Successfully created pick-details sidecar: {output_path}");
                    }
                    Err(e) => {
                        log::error!("Failed to create pick-details sidecar: {e}");
                    }
                }

                // Create dividend CSV file
                match create_dividend_csv_for_score_file(
                    &roots.dividends,
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
                match grq_validation::utils::calculate_portfolio_performance(
                    &roots.dividends,
                    &score_file_path,
                    &score_entry.date,
                ) {
                    Ok(performance) => {
                        info!(
                            "Performance for {}: {:.2}% (90-day), {:.2}% (annualized), {} included stocks",
                            score_entry.date,
                            performance.performance_90_day,
                            performance.performance_annualized,
                            performance.total_stocks
                        );
                        if !performance.excluded_tickers.is_empty() {
                            info!(
                                "Excluded {} unpriceable stocks for {}",
                                performance.excluded_tickers.len(),
                                score_entry.date
                            );
                        }

                        // Update the index.json with this performance data
                        let mut index_data =
                            grq_validation::utils::read_index_json(&args.docs_path)?;
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

    // Every fault inside the loop above is logged and stepped over so one bad
    // score file cannot abandon the rest of the run, and a score file the
    // filter never selected is not visited at all. Either way the run could
    // finish over a tree that has a prediction date with no market data — the
    // state the CI data-presence gate and the promotion guard reject — and
    // still report success, so the scorer committed it (issue #833). Absence of
    // an explicit failure is not success: confirm the outcome and fail loud,
    // naming every offender, when it is not what the gate demands.
    let unpaired = find_unpaired_prediction_dates(&args.docs_path)?;
    if !unpaired.is_empty() {
        return Err(anyhow!(
            "{} prediction date(s) have no market data after processing — \
             the tree is in a state the data-presence gate rejects. Run with \
             --regenerate-empty once the upstream data is available:\n  {}",
            unpaired.len(),
            unpaired.join("\n  ")
        ));
    }

    info!("GRQ Validation processor completed successfully");
    Ok(())
}
