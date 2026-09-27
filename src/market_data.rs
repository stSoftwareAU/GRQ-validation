//! Market-data files: resolving a symbol's price CSV inside the caller-supplied
//! market root, reading and filtering those prices, and writing the per-score
//! market-data CSVs that sit beside each prediction file.

use crate::data_roots::market_data_root;
use crate::models::{DailyMarketPoint, MarketData, MarketDataCsv};
use anyhow::{anyhow, Result};
use chrono::{Duration, NaiveDate};
use std::collections::HashMap;
use std::path::Path;

/// Returns `true` when a market-data CSV is missing or contains only the header row.
pub fn is_market_data_csv_empty(csv_path: &str) -> bool {
    use std::fs;

    match fs::read_to_string(csv_path) {
        Ok(content) => {
            let lines: Vec<_> = content
                .lines()
                .filter(|line| !line.trim().is_empty())
                .collect();
            lines.len() <= 1
        }
        Err(_) => true,
    }
}

/// Returns `true` if `symbol` is a plausible stock symbol.
///
/// A symbol is valid when it is non-empty, at most 30 characters, and composed
/// solely of alphanumerics, `.` or `:`.
///
/// # Examples
///
/// ```
/// use grq_validation::utils::validate_stock_symbol;
///
/// assert!(validate_stock_symbol("NYSE:SEM"));
/// assert!(!validate_stock_symbol(""));
/// ```
pub fn validate_stock_symbol(symbol: &str) -> bool {
    // Basic validation for stock symbols
    if symbol.is_empty() || symbol.len() > 30 {
        return false;
    }

    symbol
        .chars()
        .all(|c| c.is_alphanumeric() || c == '.' || c == ':')
}

/// Extracts the ticker following the first `:` (e.g. `"NYSE:SEM"` → `"SEM"`),
/// returning `None` when no `:` is present.
pub fn extract_ticker_from_symbol(symbol: &str) -> Option<String> {
    // Extract ticker from "NYSE:SEM" -> "SEM"
    symbol
        .find(':')
        .map(|colon_pos| symbol[colon_pos + 1..].to_string())
}

/// Builds the market-data JSON path for `ticker` under `root`, bucketed by
/// uppercased first letter (e.g. `"SEM"` → `<root>/data/S/SEM.json`), guarding
/// against path traversal. Path-injectable core of [`get_market_data_path`].
///
/// The `ticker`/`symbol` originates from the `stock` column of a daily score
/// TSV, which is attacker-influenceable (a contributor, a compromised upstream
/// data step, or a malicious pull request against the data set), exactly like
/// the `file` field guarded by [`build_score_file_path`](crate::index::build_score_file_path) and the ticker guarded
/// by [`get_dividend_data_path_in`](crate::dividends::get_dividend_data_path_in). To stop a crafted symbol such as
/// `"../../../../etc/hosts"` escaping the intended `<root>/data/` tree, the
/// path is built with `Path::join` over validated components rather than plain
/// string interpolation: any parent-directory (`..`), root, or prefix component
/// is a traversal attempt and is rejected (issue #195).
///
/// # Errors
///
/// Returns an error if `ticker` is absolute or contains a parent-directory
/// (`..`) segment.
pub fn get_market_data_path_in(root: &Path, ticker: &str) -> Result<String> {
    use std::path::Component;

    let first_letter = ticker
        .chars()
        .next()
        .unwrap_or('X')
        .to_uppercase()
        .to_string();

    // Build within the market-data root via join rather than string
    // concatenation, keeping only normal segments.
    let mut full_path = root.join("data").join(&first_letter);

    let file_name = format!("{ticker}.json");
    for component in Path::new(&file_name).components() {
        match component {
            Component::ParentDir => {
                return Err(anyhow!(
                    "Refusing market-data ticker with parent-directory segment: {ticker:?}"
                ));
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err(anyhow!("Refusing absolute market-data ticker: {ticker:?}"));
            }
            // `.` adds nothing; normal segments extend the path.
            Component::CurDir => {}
            Component::Normal(segment) => full_path.push(segment),
        }
    }

    Ok(full_path.to_string_lossy().into_owned())
}

/// Builds the market-data JSON path for `ticker` under the caller-supplied
/// market-data root, resolving [`market_data_root`] and delegating to
/// [`get_market_data_path_in`].
///
/// # Errors
///
/// Returns an error when [`MARKET_DATA_ROOT_ENV`](crate::data_roots::MARKET_DATA_ROOT_ENV) is unset or blank, or when
/// `ticker` is absolute or contains a parent-directory (`..`) segment.
pub fn get_market_data_path(ticker: &str) -> Result<String> {
    get_market_data_path_in(&market_data_root()?, ticker)
}

/// Reads and deserialises the [`MarketData`] JSON file for `symbol` under the
/// caller-supplied `market_root` (issue #803: the root is threaded in, never
/// resolved per call).
///
/// # Errors
///
/// Returns an error if the market-data file cannot be opened or does not
/// contain valid JSON matching [`MarketData`].
pub fn read_market_data(market_root: &Path, symbol: &str) -> Result<MarketData> {
    use std::fs::File;

    // Build the path through the traversal-guarded helper so an attacker-supplied
    // symbol such as `"../../../../etc/hosts"` cannot escape the data root (issue #195).
    let market_data_path = get_market_data_path_in(market_root, symbol)?;

    let file = File::open(&market_data_path)?;
    let market_data: MarketData = serde_json::from_reader(file)?;

    Ok(market_data)
}

/// Parses a financial value (a price or dividend amount) from its raw string.
///
/// Returns `Some(value)` on success. On failure the offending value is logged
/// to stderr as a `Warning:` line and `None` is returned, so malformed upstream
/// data is visible to the operator rather than being silently coerced to a
/// sentinel (e.g. `0.0`) or dropped without trace. See issue #110.
pub(crate) fn parse_financial_value(field: &str, context: &str, raw: &str) -> Option<f64> {
    match raw.parse::<f64>() {
        Ok(value) => Some(value),
        Err(error) => {
            eprintln!("Warning: skipping unparseable {field} '{raw}' ({context}): {error}");
            None
        }
    }
}

/// Reads a derived market-data CSV into a [`MarketDataCsv`].
///
/// The long-format columns are `date,ticker,high,low,open,close,
/// split_coefficient,volume`. `closes` keeps the original `ticker → (date →
/// close)` shape; `points` additionally carries the
/// `high`/`low`/`split_coefficient` figures the backend needs to
/// correct-or-exclude split-distorted stocks (issue #294) plus the daily
/// `volume` used by the low-volume guard (issue #575). Rows with a non-numeric
/// or non-positive close price are skipped (and a warning is written to
/// stderr). A missing or unparseable `split_coefficient` is treated as `1.0`
/// (no split). The trailing `volume` column is optional: older 7-column CSVs,
/// or a blank/non-numeric value, yield `None`.
///
/// # Errors
///
/// Returns an error if the CSV file cannot be opened or a record cannot be
/// read.
pub fn read_market_data_from_csv(csv_file_path: &str) -> Result<MarketDataCsv> {
    use csv::ReaderBuilder;
    use std::fs::File;

    let file = File::open(csv_file_path)?;
    let mut reader = ReaderBuilder::new().has_headers(true).from_reader(file);

    let mut market_data = MarketDataCsv::default();

    for result in reader.records() {
        let record = result?;
        if record.len() >= 6 {
            let date = record[0].to_string();
            let full_ticker = record[1].to_string();
            // Use close price (column 5); skip and warn if it is non-numeric.
            let close_price = match parse_financial_value(
                "close price",
                &format!("{full_ticker} on {date}"),
                &record[5],
            ) {
                Some(price) => price,
                None => continue,
            };

            if close_price <= 0.0 {
                continue;
            }

            // high/low (columns 2/3) drive the split reconciliation cross-check;
            // fall back to the close so a missing pair simply no-ops the check.
            let high = record
                .get(2)
                .and_then(|v| v.parse::<f64>().ok())
                .unwrap_or(close_price);
            let low = record
                .get(3)
                .and_then(|v| v.parse::<f64>().ok())
                .unwrap_or(close_price);
            // split_coefficient (column 6) is optional; absent or invalid means
            // "no split" (1.0) rather than a parse failure.
            let split_coefficient = record
                .get(6)
                .and_then(|v| v.parse::<f64>().ok())
                .filter(|c| c.is_finite() && *c > 0.0)
                .unwrap_or(1.0);
            // volume (column 7) is optional; absent (older 7-column CSVs), blank
            // or non-numeric all mean "unknown" (None), mirroring how the
            // split_coefficient column is treated above.
            let volume = record
                .get(7)
                .and_then(|v| v.parse::<f64>().ok())
                .filter(|v| v.is_finite());

            // Store data using the full ticker (e.g., "NYSE:MBC").
            market_data
                .closes
                .entry(full_ticker.clone())
                .or_default()
                .insert(date.clone(), close_price);
            market_data.points.entry(full_ticker).or_default().insert(
                date,
                DailyMarketPoint {
                    high,
                    low,
                    split_coefficient,
                    volume,
                },
            );
        }
    }

    Ok(market_data)
}

/// Returns `(date, close)` pairs from `market_data` whose date falls within the
/// inclusive `start_date`..=`end_date` range, sorted oldest first.
///
/// # Errors
///
/// Returns an error if `start_date` or `end_date` is not a valid `%Y-%m-%d`
/// date.
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
                if let Some(close_price) =
                    parse_financial_value("close price", date_str, &daily_data.close)
                {
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
///
/// # Errors
///
/// Returns an error if the market data cannot be read or the CSV file cannot be
/// written (see [`create_market_data_csv`]).
pub fn create_market_data_csv_for_score_file(
    market_root: &Path,
    score_file_path: &str,
    symbols: &[String],
    score_file_date: &str,
) -> Result<()> {
    let output_path = derive_csv_output_path(score_file_path);
    create_market_data_csv(market_root, symbols, score_file_date, &output_path)
}

/// Creates a CSV file with market data for the given symbols and date range
///
/// # Errors
///
/// Returns an error if `score_file_date` is not a valid date, a symbol's
/// market data cannot be read, or the output CSV cannot be written.
pub fn create_market_data_csv(
    market_root: &Path,
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
        match read_market_data(market_root, symbol) {
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
        match read_market_data(market_root, symbol) {
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
/// Each row: date, ticker, high, low, open, close, split_coefficient, volume
/// The ticker is the full code from the scores file (e.g., NYSE:SEM)
///
/// # Errors
///
/// Returns an error if `score_file_date` is not a valid date, the output CSV
/// cannot be created or written, or every ticker was skipped so no data rows
/// were written. Individual tickers with missing market data are skipped rather
/// than failing the whole file.
pub fn create_market_data_long_csv(
    market_root: &Path,
    tickers: &[String],
    score_file_date: &str,
    output_path: &str,
) -> Result<()> {
    use crate::utils::extract_symbol_from_ticker;
    use csv::Writer;

    // The root is supplied by the caller and validated at start-up (issue
    // #803), so an unset root can never reach this writer and silently produce
    // a header-only CSV (issue #802).
    let root_display = market_root.display();

    let score_date = NaiveDate::parse_from_str(score_file_date, "%Y-%m-%d")?;
    let end_date = score_date + Duration::days(180);
    let end_date_str = end_date.format("%Y-%m-%d").to_string();

    // Build the CSV in memory first so the destination file is only touched once
    // we know whether we actually have data. The previous implementation wrote
    // straight to `File::create(output_path)`, which truncated the existing CSV
    // *before* the "no rows written" guard ran — so a run with no upstream data
    // wiped an already-populated file down to a bare header row (issue #687,
    // recurrences #672/#674/#685). Buffering keeps the write non-destructive.
    let mut writer = Writer::from_writer(Vec::new());
    writer.write_record([
        "date",
        "ticker",
        "high",
        "low",
        "open",
        "close",
        "split_coefficient",
        "volume",
    ])?;

    let mut rows_written = 0u64;

    for ticker in tickers {
        let symbol = extract_symbol_from_ticker(ticker);
        let market_data = match read_market_data(market_root, &symbol) {
            Ok(md) => md,
            Err(error) => {
                log::warn!("Skipping {ticker} ({symbol}): {error}");
                continue;
            }
        };
        let filtered =
            match filter_market_data_by_date_range(&market_data, score_file_date, &end_date_str) {
                Ok(f) => f,
                Err(error) => {
                    log::warn!("Skipping {ticker} ({symbol}): date filter failed: {error}");
                    continue;
                }
            };
        if filtered.is_empty() {
            log::warn!(
                "Skipping {ticker} ({symbol}): no market data between {score_file_date} and {end_date_str}"
            );
            continue;
        }
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
                    &day.volume.to_string(),
                ])?;
                rows_written += 1;
            }
        }
    }
    writer.flush()?;
    let csv_bytes = writer
        .into_inner()
        .map_err(|error| anyhow!("failed to finalise market-data CSV buffer: {error}"))?;

    if rows_written == 0 {
        // No fresh data for this date. Never overwrite an already-populated CSV
        // with a header-only file (issue #687): leave the existing rows intact
        // so the dashboard keeps working, while still surfacing the "no data"
        // error so the operator sees the upstream gap.
        if !is_market_data_csv_empty(output_path) {
            log::warn!(
                "Preserving existing market data at {output_path}: no fresh rows for {score_file_date}"
            );
            if !tickers.is_empty() {
                return Err(anyhow!(
                    "No market data rows written for {score_file_date} — existing CSV at \
                     {output_path} preserved; is {root_display} available and up to date?"
                ));
            }
            return Ok(());
        }

        // Nothing worth preserving (missing or already header-only): write the
        // header-only placeholder as before so a genuinely-new date still gets a
        // file, then surface the same error the caller expects.
        write_atomically(output_path, &csv_bytes)?;
        if !tickers.is_empty() {
            return Err(anyhow!(
                "No market data rows written for {score_file_date} — \
                 is {root_display} available and up to date?"
            ));
        }
        return Ok(());
    }

    // We have real data: replace the destination atomically so a crash mid-write
    // can never leave a truncated CSV behind.
    write_atomically(output_path, &csv_bytes)?;

    Ok(())
}

/// Writes `bytes` to `path` atomically by staging them in a sibling temporary
/// file and renaming it over `path`. A rename on the same filesystem is atomic,
/// so neither a concurrent reader nor a crash ever observes a partially written
/// or truncated file — the destination holds either the previous content or the
/// complete new content. The market-data writer relies on this so a failed or
/// interrupted regeneration can never wipe an existing populated CSV (issue
/// #687).
///
/// # Errors
///
/// Returns an error if the temporary file cannot be created/written or the
/// rename over `path` fails.
pub(crate) fn write_atomically(path: &str, bytes: &[u8]) -> Result<()> {
    use std::io::Write;

    let tmp_path = format!("{path}.tmp");
    {
        let mut tmp = std::fs::File::create(&tmp_path)?;
        tmp.write_all(bytes)?;
        tmp.flush()?;
    }
    std::fs::rename(&tmp_path, path)?;
    Ok(())
}

/// Like create_market_data_csv_for_score_file, but outputs long format and allows custom output dir (for tests)
///
/// # Errors
///
/// Returns an error if the long-format CSV cannot be created or written (see
/// [`create_market_data_long_csv`]).
pub fn create_market_data_long_csv_for_score_file(
    market_root: &Path,
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
    create_market_data_long_csv(market_root, tickers, score_file_date, &output_path)?;
    Ok(output_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data_roots::test_fixtures::{absent_data_root, configured_market_root};

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
    fn test_is_market_data_csv_empty_missing_file() {
        // A path that does not exist is treated as empty.
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("nope.csv");
        assert!(is_market_data_csv_empty(missing.to_str().unwrap()));
    }

    #[test]
    fn test_is_market_data_csv_empty_header_only() {
        // A file with only a header row (plus blank lines) counts as empty.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("header.csv");
        std::fs::write(&path, "date,ticker,high,low,open,close\n\n").unwrap();
        assert!(is_market_data_csv_empty(path.to_str().unwrap()));
    }

    #[test]
    fn test_is_market_data_csv_empty_with_data_row() {
        // A header plus at least one data row is not empty.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("data.csv");
        std::fs::write(
            &path,
            "date,ticker,high,low,open,close\n2025-06-20,NYSE:AAPL,1,1,1,1\n",
        )
        .unwrap();
        assert!(!is_market_data_csv_empty(path.to_str().unwrap()));
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
        // Signature changed to `Result<String>` in issue #195 to guard against
        // path traversal; legitimate tickers still resolve under the
        // caller-supplied root (issue #802).
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        assert_eq!(
            get_market_data_path_in(root, "SEM").unwrap(),
            root.join("data/S/SEM.json").to_string_lossy()
        );
        assert_eq!(
            get_market_data_path_in(root, "AAPL").unwrap(),
            root.join("data/A/AAPL.json").to_string_lossy()
        );
        assert_eq!(
            get_market_data_path_in(root, "TSLA").unwrap(),
            root.join("data/T/TSLA.json").to_string_lossy()
        );
    }

    #[test]
    fn test_get_market_data_path_allows_plain_ticker_with_exchange_prefix() {
        // A legitimate ticker with an exchange prefix contains no path
        // separators or traversal segments and must still resolve.
        let dir = tempfile::tempdir().unwrap();
        let path = get_market_data_path_in(dir.path(), "NYSE:SEM").unwrap();
        assert_eq!(
            path,
            dir.path().join("data/N/NYSE:SEM.json").to_string_lossy()
        );
    }

    // Regression tests for issue #195: a `..` or absolute segment in an
    // attacker-influenceable symbol must not escape the market-data root.
    #[test]
    fn test_get_market_data_path_rejects_parent_dir_traversal() {
        let dir = tempfile::tempdir().unwrap();
        let result = get_market_data_path_in(dir.path(), "../../../../etc/hosts");
        assert!(
            result.is_err(),
            "expected a symbol containing `..` to be rejected, got {result:?}"
        );
        assert!(result.unwrap_err().to_string().contains("parent-directory"));
    }

    #[test]
    fn test_get_market_data_path_rejects_absolute_symbol() {
        let dir = tempfile::tempdir().unwrap();
        let result = get_market_data_path_in(dir.path(), "/etc/hosts");
        assert!(
            result.is_err(),
            "expected an absolute symbol to be rejected, got {result:?}"
        );
    }

    #[test]
    fn test_read_market_data_rejects_traversal_symbol() {
        // The read must fail at the path-validation stage rather than opening an
        // out-of-tree file. We assert it errors for a traversal symbol.
        let result = read_market_data(absent_data_root(), "../../../../etc/hosts");
        assert!(
            result.is_err(),
            "expected read_market_data to reject a traversal symbol, got ok"
        );
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
        let Some(root) = configured_market_root("test_read_market_data") else {
            return;
        };

        let result = read_market_data(&root, "SEM");
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
        let Some(root) = configured_market_root("test_filter_market_data_by_date_range") else {
            return;
        };

        let result = read_market_data(&root, "SEM");
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

    // --- Issue #110: numeric parse failures must be skipped, not coerced ---

    #[test]
    fn test_parse_financial_value_valid() {
        assert_eq!(
            parse_financial_value("close price", "ctx", "12.34"),
            Some(12.34)
        );
        assert_eq!(parse_financial_value("close price", "ctx", "0"), Some(0.0));
        assert_eq!(
            parse_financial_value("dividend amount", "ctx", "-1.5"),
            Some(-1.5)
        );
    }

    #[test]
    fn test_parse_financial_value_invalid() {
        // Non-numeric, empty, and sentinel-like strings all return None rather
        // than being silently coerced to 0.0.
        assert_eq!(parse_financial_value("close price", "ctx", "N/A"), None);
        assert_eq!(parse_financial_value("close price", "ctx", ""), None);
        assert_eq!(parse_financial_value("dividend amount", "ctx", "abc"), None);
    }

    fn make_daily_data(close: &str) -> crate::models::DailyData {
        crate::models::DailyData {
            open: "0".to_string(),
            high: "0".to_string(),
            low: "0".to_string(),
            close: close.to_string(),
            adjusted_close: "0".to_string(),
            volume: "0".to_string(),
            dividend_amount: "0".to_string(),
            split_coefficient: "0".to_string(),
        }
    }

    fn make_market_data(entries: &[(&str, &str)]) -> MarketData {
        let mut time_series_daily = HashMap::new();
        for (date, close) in entries {
            time_series_daily.insert(date.to_string(), make_daily_data(close));
        }
        MarketData {
            meta_data: crate::models::MarketDataMeta {
                information: String::new(),
                symbol: "TEST".to_string(),
                last_refreshed: String::new(),
                output_size: String::new(),
                time_zone: String::new(),
            },
            time_series_daily,
        }
    }

    #[test]
    fn test_filter_market_data_skips_unparseable_close() {
        let market_data = make_market_data(&[
            ("2025-06-16", "10.00"),
            ("2025-06-17", "not-a-number"),
            ("2025-06-18", "12.00"),
        ]);

        let filtered =
            filter_market_data_by_date_range(&market_data, "2025-06-15", "2025-06-20").unwrap();

        // The unparseable row is dropped; the two valid rows survive.
        assert_eq!(filtered.len(), 2);
        assert_eq!(filtered[0], ("2025-06-16".to_string(), 10.00));
        assert_eq!(filtered[1], ("2025-06-18".to_string(), 12.00));
    }

    #[test]
    fn test_read_market_data_from_csv_skips_unparseable_close() {
        use std::io::Write;

        // CSV columns: date,ticker,open,high,low,close
        let csv = "date,ticker,open,high,low,close\n\
                   2025-06-16,NYSE:TEST,1,1,1,10.00\n\
                   2025-06-17,NYSE:TEST,1,1,1,not-a-number\n\
                   2025-06-18,NYSE:TEST,1,1,1,12.00\n";

        let mut tmp = tempfile::NamedTempFile::new().unwrap();
        tmp.write_all(csv.as_bytes()).unwrap();
        let path = tmp.path().to_string_lossy().to_string();

        // `read_market_data_from_csv` now returns a `MarketDataCsv`; the close
        // map lives under `.closes` (issue #294). Behaviour for close parsing is
        // otherwise unchanged.
        let market_data = read_market_data_from_csv(&path).unwrap().closes;

        // Previously the bad close became 0.0 and was dropped by the > 0.0
        // guard; now it is explicitly skipped with a warning. Either way only
        // the two valid rows are retained.
        let ticker = market_data.get("NYSE:TEST").unwrap();
        assert_eq!(ticker.len(), 2);
        assert_eq!(ticker.get("2025-06-16"), Some(&10.00));
        assert_eq!(ticker.get("2025-06-18"), Some(&12.00));
        assert!(ticker.get("2025-06-17").is_none());
    }

    #[test]
    fn test_read_market_data_from_csv_reads_trailing_volume_column() {
        use std::io::Write;

        // 8-column shape (issue #575): the trailing `volume` column is populated.
        let csv = "date,ticker,high,low,open,close,split_coefficient,volume\n\
                   2025-06-16,NYSE:VOL,11,9,10,10.50,1.0,123456\n\
                   2025-06-17,NYSE:VOL,12,10,11,11.50,1.0,\n\
                   2025-06-18,NYSE:VOL,13,11,12,12.50,1.0,not-a-number\n";

        let mut tmp = tempfile::NamedTempFile::new().unwrap();
        tmp.write_all(csv.as_bytes()).unwrap();
        let path = tmp.path().to_string_lossy().to_string();

        let points = read_market_data_from_csv(&path).unwrap().points;
        let ticker = points.get("NYSE:VOL").unwrap();

        // A numeric value is parsed; blank and non-numeric both fall back to None.
        assert_eq!(ticker.get("2025-06-16").unwrap().volume, Some(123456.0));
        assert_eq!(ticker.get("2025-06-17").unwrap().volume, None);
        assert_eq!(ticker.get("2025-06-18").unwrap().volume, None);
    }

    #[test]
    fn test_read_market_data_from_csv_legacy_7_column_has_no_volume() {
        use std::io::Write;

        // Older 7-column CSVs (no volume column) must still parse, with volume
        // reported as None for every row (backward compatibility, issue #575).
        let csv = "date,ticker,high,low,open,close,split_coefficient\n\
                   2025-06-16,NYSE:OLD,11,9,10,10.50,1.0\n\
                   2025-06-17,NYSE:OLD,12,10,11,11.50,1.0\n";

        let mut tmp = tempfile::NamedTempFile::new().unwrap();
        tmp.write_all(csv.as_bytes()).unwrap();
        let path = tmp.path().to_string_lossy().to_string();

        let parsed = read_market_data_from_csv(&path).unwrap();
        let ticker = parsed.points.get("NYSE:OLD").unwrap();

        assert_eq!(ticker.len(), 2);
        assert_eq!(ticker.get("2025-06-16").unwrap().volume, None);
        assert_eq!(ticker.get("2025-06-17").unwrap().volume, None);
        // Existing positional fields remain intact.
        assert_eq!(ticker.get("2025-06-16").unwrap().split_coefficient, 1.0);
        assert_eq!(parsed.closes.get("NYSE:OLD").unwrap().len(), 2);
    }
}
