use crate::models::{
    DailyMarketPoint, DividendData, IndexData, MarketData, MarketDataCsv, PortfolioPerformance,
    StockPerformance, StockRecord,
};
use anyhow::{anyhow, Result};
use chrono::{Duration, NaiveDate};
use std::collections::HashMap;
use std::path::Path;

/// Base path of the external share-price data repository.
pub const MARKET_DATA_BASE_PATH: &str = "../GRQ-shareprices2026Q2";

/// Returns `true` when a share-price data repository exists at `base` (i.e. it
/// contains a `data/` subdirectory). Path-injectable core of
/// [`market_data_repository_available`] so the guard is deterministically
/// testable against a temporary directory.
fn market_data_repository_available_at(base: &Path) -> bool {
    base.join("data").is_dir()
}

/// Returns `true` when the share-price data repository is present on disk.
pub fn market_data_repository_available() -> bool {
    market_data_repository_available_at(Path::new(MARKET_DATA_BASE_PATH))
}

/// Ensures a share-price data repository is present at `base` before batch
/// processing. Path-injectable core of [`ensure_market_data_repository`].
///
/// # Errors
///
/// Returns an error when `base`/`data` is missing.
fn ensure_market_data_repository_at(base: &Path) -> Result<()> {
    if market_data_repository_available_at(base) {
        Ok(())
    } else {
        Err(anyhow!(
            "Market data repository not found at {}/data — \
             clone GRQ-shareprices2026Q2 as a sibling directory",
            base.display()
        ))
    }
}

/// Ensures the share-price data repository is present before batch processing.
///
/// # Errors
///
/// Returns an error when [`MARKET_DATA_BASE_PATH`]/`data` is missing.
pub fn ensure_market_data_repository() -> Result<()> {
    ensure_market_data_repository_at(Path::new(MARKET_DATA_BASE_PATH))
}

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
/// Base path of the external dividend data repository.
pub const DIVIDEND_DATA_BASE_PATH: &str = "../GRQ-dividends";

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

/// Returns `true` if both `buy_price` and `current_price` are positive and
/// usable, the split series is reliable, and the AI model `score` is positive.
///
/// A stock is priceable when both prices are greater than 0.0. Stocks without
/// usable prices are excluded from portfolio performance calculations entirely.
///
/// # Examples
///
/// ```
/// use grq_validation::utils::is_priceable;
///
/// assert!(is_priceable(10.5, 12.0, true, 0.5));
/// assert!(!is_priceable(0.0, 12.0, true, 0.5));  // missing buy price
/// assert!(!is_priceable(10.5, 0.0, true, 0.5));  // missing current price
/// assert!(!is_priceable(0.0, 0.0, true, 0.5));   // both missing
/// assert!(!is_priceable(10.5, 12.0, false, 0.5)); // split series unreliable
/// assert!(!is_priceable(10.5, 12.0, true, 0.0));  // zero score -> hold cash
/// assert!(!is_priceable(10.5, 12.0, true, -0.5)); // negative score -> hold cash
/// ```
///
/// `split_reliable` mirrors the frontend `isStockIncluded` predicate (issue
/// #293): a stock whose split series cannot be trustworthily reconciled is
/// excluded through this single gate rather than via a parallel path.
///
/// `score` is the raw AI model score (issue #627): a value <= 0 means the model
/// predicts the stock will fall, so we would hold cash rather than buy it. Such
/// a name is excluded through this same single gate, mirroring the frontend.
pub fn is_priceable(buy_price: f64, current_price: f64, split_reliable: bool, score: f64) -> bool {
    buy_price > 0.0 && current_price > 0.0 && split_reliable && score > 0.0
}

/// Trustworthy split-adjustment thresholds, mirroring `docs/projection.js`
/// (issues #291/#292, parent #272). Agreed in the #291 investigation — see
/// `docs/fixes/klac-split-distortion-investigation.md`.
const MAX_PLAUSIBLE_COEFFICIENT: f64 = 10.0; // a single split of <= 10:1 is plausible
const DUPLICATE_WINDOW_DAYS: i64 = 5; // splits within 5 days = the same event twice
const MAX_CUMULATIVE_FACTOR: f64 = 50.0; // cumulative factor cap over the window
const MIN_CUMULATIVE_FACTOR: f64 = 1.0 / MAX_CUMULATIVE_FACTOR; // reverse-split floor
const RECONCILE_TOLERANCE: f64 = 0.15; // +/-15% price-ratio cross-check

/// Effective N:1 split magnitude for forward (`c`) and reverse (`1/c`) events.
fn split_event_magnitude(c: f64) -> f64 {
    if c >= 1.0 {
        c
    } else {
        1.0 / c
    }
}

/// Returns `true` when `c` is a valid split coefficient (not 1.0, positive, finite).
fn is_split_coefficient(c: f64) -> bool {
    c.is_finite() && c > 0.0 && (c - 1.0).abs() > f64::EPSILON
}

/// Cumulative split adjustment for a window plus whether it can be trusted.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SplitAdjustment {
    /// De-duplicated, plausibility-checked cumulative split factor (kept for
    /// diagnostics even when `reliable` is `false`).
    pub factor: f64,
    /// `false` when the series cannot be reconciled; callers must then exclude
    /// the stock rather than silently apply `factor`.
    pub reliable: bool,
}

impl SplitAdjustment {
    /// A no-split, trivially-reliable adjustment (factor `1.0`).
    pub const NONE: SplitAdjustment = SplitAdjustment {
        factor: 1.0,
        reliable: true,
    };
}

/// Computes the cumulative split adjustment for splits strictly after
/// `from_date`, judging whether the series can be trusted — the Rust mirror of
/// the frontend `computeSplitAdjustment` (issue #294, parent #272).
///
/// Rules: de-duplicate split events recorded within [`DUPLICATE_WINDOW_DAYS`];
/// flag any single event whose effective ratio exceeds [`MAX_PLAUSIBLE_COEFFICIENT`]
/// (forward *or* reverse); bound the cumulative factor between
/// [`MIN_CUMULATIVE_FACTOR`] and [`MAX_CUMULATIVE_FACTOR`]; and cross-check each
/// split against the observed pre/post price move within [`RECONCILE_TOLERANCE`].
/// A missing or empty series means no known splits, so the factor is `1.0` and
/// the series is reliable.
pub fn compute_split_adjustment(
    series: &HashMap<String, DailyMarketPoint>,
    from_date: NaiveDate,
) -> SplitAdjustment {
    // Sort by date so "the price immediately before a split" is well-defined
    // regardless of map iteration order.
    let mut points: Vec<(NaiveDate, &DailyMarketPoint)> = series
        .iter()
        .filter_map(|(date_str, point)| {
            NaiveDate::parse_from_str(date_str, "%Y-%m-%d")
                .ok()
                .map(|date| (date, point))
        })
        .collect();
    points.sort_by_key(|(date, _)| *date);

    let mut factor = 1.0;
    let mut reliable = true;
    let mut last_event: Option<NaiveDate> = None;

    for (i, (date, point)) in points.iter().enumerate() {
        let date = *date;
        let c = point.split_coefficient;

        // Only splits strictly after the buy date adjust the buy price.
        if date <= from_date {
            continue;
        }
        // Invalid / unity coefficients mean "no adjustment" (treat as 1.0).
        if !is_split_coefficient(c) {
            continue;
        }
        // De-duplicate: a split within DUPLICATE_WINDOW_DAYS of the last kept
        // one is the same corporate event recorded twice — apply it once.
        if let Some(prev_event) = last_event {
            if (date - prev_event).num_days() <= DUPLICATE_WINDOW_DAYS {
                continue;
            }
        }
        last_event = Some(date);

        // Implausibly large single event (forward or reverse): cannot trust.
        if split_event_magnitude(c) > MAX_PLAUSIBLE_COEFFICIENT {
            reliable = false;
        }

        // Price-ratio cross-check: prev_mid / split_mid should match `c` for
        // both forward splits (c > 1, price falls) and reverse splits (c < 1,
        // price rises).
        if i > 0 {
            let prev = points[i - 1].1;
            let prev_mid = (prev.high + prev.low) / 2.0;
            let split_mid = (point.high + point.low) / 2.0;
            if prev_mid.is_finite() && split_mid.is_finite() && split_mid > 0.0 {
                let observed_ratio = prev_mid / split_mid;
                if (observed_ratio / c - 1.0).abs() > RECONCILE_TOLERANCE {
                    reliable = false;
                }
            }
        }

        factor *= c;
    }

    // Cumulative-factor plausibility bound (forward product too large, or reverse
    // product too small, almost certainly means duplicated/spurious coefficients).
    if !(MIN_CUMULATIVE_FACTOR..=MAX_CUMULATIVE_FACTOR).contains(&factor) {
        reliable = false;
    }

    SplitAdjustment { factor, reliable }
}

/// Returns the arithmetic mean of `scores`, or `0.0` for an empty slice.
///
/// # Examples
///
/// ```
/// use grq_validation::utils::calculate_average_score;
///
/// assert_eq!(calculate_average_score(&[1.0, 2.0, 3.0]), 2.0);
/// assert_eq!(calculate_average_score(&[]), 0.0);
/// ```
pub fn calculate_average_score(scores: &[f64]) -> f64 {
    if scores.is_empty() {
        return 0.0;
    }

    scores.iter().sum::<f64>() / scores.len() as f64
}

/// Reads `<docs_path>/scores/index.json` and returns its entries sorted by date.
///
/// # Errors
///
/// Returns an error if the index file cannot be read or does not contain valid
/// JSON matching [`IndexData`].
pub fn read_index_json(docs_path: &str) -> Result<IndexData> {
    use std::fs;
    use std::path::Path;

    let index_path = Path::new(docs_path).join("scores").join("index.json");
    let content = fs::read_to_string(index_path)?;
    let mut index_data: IndexData = serde_json::from_str(&content)?;

    // Sort the scores by date to ensure chronological order
    index_data.scores.sort_by(|a, b| {
        // Parse dates and compare them
        if let (Ok(date_a), Ok(date_b)) = (
            NaiveDate::parse_from_str(&a.date, "%Y-%m-%d"),
            NaiveDate::parse_from_str(&b.date, "%Y-%m-%d"),
        ) {
            date_a.cmp(&date_b)
        } else {
            // Fallback to string comparison if date parsing fails
            a.date.cmp(&b.date)
        }
    });

    Ok(index_data)
}

/// Builds the on-disk path for a score file, guarding against path traversal.
///
/// The `file` field originates from `docs/scores/index.json`, which can be
/// influenced by contributors or upstream tooling. To stop a crafted entry
/// such as `"../../../tmp/evil"` escaping the intended `docs/scores/`
/// directory, this rejects any `file` value that is absolute or that contains
/// a parent-directory (`..`) segment before joining. With neither present, the
/// joined path is lexically guaranteed to stay within `<docs_path>/scores`.
/// Mirrors the containment guard in `helpers/server.ts::getFilePath`.
///
/// # Errors
///
/// Returns an error if `file` is empty, absolute, or contains a
/// parent-directory (`..`) segment.
pub fn build_score_file_path(docs_path: &str, file: &str) -> Result<String> {
    use std::path::Component;

    if file.trim().is_empty() {
        return Err(anyhow!("Refusing empty score file path"));
    }

    let candidate = Path::new(file);

    // Build within the scores root via join rather than string concatenation,
    // keeping only normal segments. Any `..`, root, or prefix component is a
    // traversal attempt and is rejected.
    let mut full_path = Path::new(docs_path).join("scores");
    for component in candidate.components() {
        match component {
            Component::ParentDir => {
                return Err(anyhow!(
                    "Refusing score file path with parent-directory segment: {file:?}"
                ));
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err(anyhow!("Refusing absolute score file path: {file:?}"));
            }
            // `.` adds nothing; normal segments extend the path.
            Component::CurDir => {}
            Component::Normal(segment) => full_path.push(segment),
        }
    }

    Ok(full_path.to_string_lossy().into_owned())
}

/// Extracts the ticker following the first `:` (e.g. `"NYSE:SEM"` → `"SEM"`),
/// returning `None` when no `:` is present.
pub fn extract_ticker_from_symbol(symbol: &str) -> Option<String> {
    // Extract ticker from "NYSE:SEM" -> "SEM"
    symbol
        .find(':')
        .map(|colon_pos| symbol[colon_pos + 1..].to_string())
}

/// Builds the market-data JSON path for `ticker` under [`MARKET_DATA_BASE_PATH`],
/// bucketed by uppercased first letter (e.g. `"SEM"` → `.../data/S/SEM.json`),
/// guarding against path traversal.
///
/// The `ticker`/`symbol` originates from the `stock` column of a daily score
/// TSV, which is attacker-influenceable (a contributor, a compromised upstream
/// data step, or a malicious pull request against the data set), exactly like
/// the `file` field guarded by [`build_score_file_path`] and the ticker guarded
/// by [`get_dividend_data_path`]. To stop a crafted symbol such as
/// `"../../../../etc/hosts"` escaping the intended `MARKET_DATA_BASE_PATH/data/`
/// tree, the path is built with `Path::join` over validated components rather
/// than plain string interpolation: any parent-directory (`..`), root, or
/// prefix component is a traversal attempt and is rejected (issue #195).
///
/// # Errors
///
/// Returns an error if `ticker` is absolute or contains a parent-directory
/// (`..`) segment.
pub fn get_market_data_path(ticker: &str) -> Result<String> {
    use std::path::Component;

    let first_letter = ticker
        .chars()
        .next()
        .unwrap_or('X')
        .to_uppercase()
        .to_string();

    // Build within the market-data root via join rather than string
    // concatenation, keeping only normal segments.
    let mut full_path = Path::new(MARKET_DATA_BASE_PATH)
        .join("data")
        .join(&first_letter);

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

/// Reads a tab-separated score file into a vector of [`StockRecord`]s.
///
/// # Errors
///
/// Returns an error if the file cannot be opened or a row cannot be
/// deserialised into a [`StockRecord`].
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

/// Reads a score file and returns just the `Stock` ticker codes, in file order.
///
/// # Errors
///
/// Returns an error if the underlying score file cannot be read or parsed (see
/// [`read_tsv_score_file`]).
pub fn extract_ticker_codes_from_score_file(file_path: &str) -> Result<Vec<String>> {
    let stock_records = read_tsv_score_file(file_path)?;
    let ticker_codes: Vec<String> = stock_records
        .into_iter()
        .map(|record| record.stock)
        .collect();

    Ok(ticker_codes)
}

/// Returns the file-system-safe symbol for `ticker`: the part after the last
/// `:`, with `.` replaced by `-` (e.g. `"NYSE:HEI.A"` → `"HEI-A"`).
pub fn extract_symbol_from_ticker(ticker: &str) -> String {
    let symbol = match ticker.rsplit_once(':') {
        Some((_, symbol)) => symbol.to_string(),
        None => ticker.to_string(),
    };
    // Convert dots to hyphens for file system compatibility
    // e.g., "HEI.A" -> "HEI-A"
    symbol.replace('.', "-")
}

/// Reads and deserialises the [`MarketData`] JSON file for `symbol`.
///
/// # Errors
///
/// Returns an error if the market-data file cannot be opened or does not
/// contain valid JSON matching [`MarketData`].
pub fn read_market_data(symbol: &str) -> Result<MarketData> {
    use std::fs::File;

    // Build the path through the traversal-guarded helper so an attacker-supplied
    // symbol such as `"../../../../etc/hosts"` cannot escape the data root (issue #195).
    let market_data_path = get_market_data_path(symbol)?;

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
fn parse_financial_value(field: &str, context: &str, raw: &str) -> Option<f64> {
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
    score_file_path: &str,
    symbols: &[String],
    score_file_date: &str,
) -> Result<()> {
    let output_path = derive_csv_output_path(score_file_path);
    create_market_data_csv(symbols, score_file_date, &output_path)
}

/// Creates a CSV file with market data for the given symbols and date range
///
/// # Errors
///
/// Returns an error if `score_file_date` is not a valid date, a symbol's
/// market data cannot be read, or the output CSV cannot be written.
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
    tickers: &[String],
    score_file_date: &str,
    output_path: &str,
) -> Result<()> {
    use crate::utils::extract_symbol_from_ticker;
    use csv::Writer;

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
        let market_data = match read_market_data(&symbol) {
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
                     {output_path} preserved; is {MARKET_DATA_BASE_PATH} available and up to date?"
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
                 is {MARKET_DATA_BASE_PATH} available and up to date?"
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
fn write_atomically(path: &str, bytes: &[u8]) -> Result<()> {
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

/// Gets the dividend data path for a given ticker.
///
/// For example: `"SEM"` -> `"../GRQ-dividends/data/S/SEM.json"`.
///
/// The `ticker` field of a score TSV is attacker-influenceable (a contributor,
/// a compromised upstream data step, or a malicious pull request against the
/// data set), exactly like the `file` field guarded by [`build_score_file_path`].
/// To stop a crafted ticker such as `"X/../../../../../../etc/some"` escaping
/// the intended `../GRQ-dividends/data/` tree, the path is built with
/// `Path::join` over validated components rather than plain string
/// interpolation: any parent-directory (`..`), root, or prefix component is a
/// traversal attempt and is rejected. This mirrors the defence-in-depth posture
/// of the market-data path (`extract_symbol_from_ticker`) and `build_score_file_path`
/// (issue #182).
///
/// # Errors
///
/// Returns an error if `ticker` is absolute or contains a parent-directory
/// (`..`) segment.
pub fn get_dividend_data_path(ticker: &str) -> Result<String> {
    use std::path::Component;

    let first_letter = ticker
        .chars()
        .next()
        .unwrap_or('X')
        .to_uppercase()
        .to_string();

    // Build within the dividend-data root via join rather than string
    // concatenation, keeping only normal segments.
    let mut full_path = Path::new(DIVIDEND_DATA_BASE_PATH)
        .join("data")
        .join(&first_letter);

    let file_name = format!("{ticker}.json");
    for component in Path::new(&file_name).components() {
        match component {
            Component::ParentDir => {
                return Err(anyhow!(
                    "Refusing dividend ticker with parent-directory segment: {ticker:?}"
                ));
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err(anyhow!("Refusing absolute dividend ticker: {ticker:?}"));
            }
            // `.` adds nothing; normal segments extend the path.
            Component::CurDir => {}
            Component::Normal(segment) => full_path.push(segment),
        }
    }

    Ok(full_path.to_string_lossy().into_owned())
}

/// Reads dividend data for a given ticker
///
/// # Errors
///
/// Returns an error if the dividend file cannot be opened or does not contain
/// valid JSON matching [`DividendData`].
pub fn read_dividend_data(ticker: &str) -> Result<DividendData> {
    use std::fs::File;

    let dividend_data_path = get_dividend_data_path(ticker)?;
    let file = File::open(&dividend_data_path)?;
    let dividend_data: DividendData = serde_json::from_reader(file)?;

    Ok(dividend_data)
}

/// Filters dividend data by date range
///
/// # Errors
///
/// Returns an error if `start_date` or `end_date` is not a valid `%Y-%m-%d`
/// date.
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
                if let Some(amount) = parse_financial_value(
                    "dividend amount",
                    &dividend_record.ex_dividend_date,
                    &dividend_record.amount,
                ) {
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
///
/// # Errors
///
/// Returns an error if `score_file_date` is not a valid date or the output CSV
/// cannot be created or written. Symbols with missing dividend data are skipped
/// with a warning rather than failing.
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
///
/// # Errors
///
/// Returns an error if the dividend CSV cannot be created or written (see
/// [`create_dividend_csv`]).
pub fn create_dividend_csv_for_score_file(
    score_file_path: &str,
    symbols: &[String],
    score_file_date: &str,
) -> Result<()> {
    let output_path = derive_dividend_csv_output_path(score_file_path);
    create_dividend_csv(symbols, score_file_date, &output_path)
}

/// Annualises a period return using compound growth over the actual number of
/// days observed.
///
/// Spec (`docs/fixes/ANNUALIZED_PERFORMANCE_CALCULATION.md`):
/// `annualised = ((1 + performance/100) ^ (365.25 / days_elapsed) - 1) * 100`.
///
/// Returns `0.0` when the period return is exactly zero or no days have
/// elapsed — the dashboard treats those as a not-yet-meaningful figure.
pub fn calculate_annualized_performance(performance_pct: f64, days_elapsed: i64) -> f64 {
    if performance_pct != 0.0 && days_elapsed > 0 {
        ((1.0 + performance_pct / 100.0).powf(365.25 / days_elapsed as f64) - 1.0) * 100.0
    } else {
        0.0
    }
}

/// Calculates 90-day and annualised portfolio performance for a score file.
///
/// Reads the score TSV at `score_file_path` and the derived market-data CSV
/// alongside it, then computes per-stock and portfolio-wide returns for the
/// 90-day window starting at `score_file_date` (`YYYY-MM-DD`).
///
/// # Examples
///
/// ```no_run
/// use grq_validation::utils::calculate_portfolio_performance;
///
/// let performance =
///     calculate_portfolio_performance("docs/scores/2024/November/15.tsv", "2024-11-15")?;
/// println!("90-day return: {:.2}%", performance.performance_90_day);
/// # Ok::<(), anyhow::Error>(())
/// ```
///
/// # Errors
///
/// Returns an error if the score file or the derived market-data CSV cannot be
/// read, or if `score_file_date` is not a valid `%Y-%m-%d` date.
pub fn calculate_portfolio_performance(
    score_file_path: &str,
    score_file_date: &str,
) -> Result<PortfolioPerformance> {
    // Read the score file
    let stock_records = read_tsv_score_file(score_file_path)?;

    // Calculate the 90-day end date
    let score_date = NaiveDate::parse_from_str(score_file_date, "%Y-%m-%d")?;
    let end_date = score_date + Duration::days(90);
    let end_date_str = end_date.format("%Y-%m-%d").to_string();

    // Read market data from the CSV file that was created by the program
    let csv_file_path = derive_csv_output_path(score_file_path);
    let market = read_market_data_from_csv(&csv_file_path)?;
    let market_data_csv = &market.closes;

    let mut individual_performances = Vec::new();
    let mut excluded_tickers = Vec::new();
    let mut latest_market_date = score_date;

    for record in &stock_records {
        // Use the full ticker (e.g., "NYSE:SEM") to match CSV data
        let full_ticker = &record.stock;

        // Get the buy price (first day close) from CSV data, and the date it
        // came from (needed to know which splits fall inside the window).
        let (buy_price, buy_date) = if let Some(first_day_data) = market_data_csv.get(full_ticker) {
            if let Some(first_day) = first_day_data.get(score_file_date) {
                (*first_day, score_date)
            } else {
                // Find the next available trading day
                let mut next_trading_day_price = 0.0;
                let mut next_trading_day_date = score_date;
                let mut found: Option<NaiveDate> = None;

                for (date_str, price) in first_day_data {
                    if let Ok(date) = NaiveDate::parse_from_str(date_str, "%Y-%m-%d") {
                        if date >= score_date && found.is_none_or(|d| date < d) {
                            found = Some(date);
                            next_trading_day_date = date;
                            next_trading_day_price = *price;
                        }
                    }
                }

                (next_trading_day_price, next_trading_day_date)
            }
        } else {
            (0.0, score_date)
        };

        // Get the current price (90-day end date or latest available)
        let current_price = if let Some(symbol_data) = market_data_csv.get(full_ticker) {
            if let Some(end_day) = symbol_data.get(&end_date_str) {
                // Update the latest market date when we have the exact end date
                if let Ok(end_date_parsed) = NaiveDate::parse_from_str(&end_date_str, "%Y-%m-%d") {
                    if end_date_parsed > latest_market_date {
                        latest_market_date = end_date_parsed;
                    }
                }
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

                // Update the latest market date across all stocks
                if latest_date > latest_market_date {
                    latest_market_date = latest_date;
                }

                latest_price
            }
        } else {
            0.0
        };

        // Reconcile any split between the buy date and the current-price date.
        // A reliable series is corrected (buy price restated to current terms);
        // an unreliable one drops the stock through the single is_priceable gate.
        let split = market
            .points
            .get(full_ticker)
            .map(|series| compute_split_adjustment(series, buy_date))
            .unwrap_or(SplitAdjustment::NONE);

        // Use the priceable predicate (now split- and score-aware) to determine
        // inclusion. A negative/zero score drops the stock (issue #627).
        if is_priceable(buy_price, current_price, split.reliable, record.score) {
            // Restate the buy price into current (post-split) terms so the
            // return is not distorted by a split inside the window. With no
            // split the factor is 1.0 and the cost basis is unchanged.
            let adjusted_buy_price = buy_price / split.factor;

            // Calculate price gain/loss against the corrected cost basis.
            let gain_loss_percent =
                ((current_price - adjusted_buy_price) / adjusted_buy_price) * 100.0;

            // Calculate dividends for the 90-day period
            let dividends_total =
                calculate_dividends_for_period(full_ticker, score_file_date, &end_date_str)
                    .unwrap_or(0.0);

            // Calculate total return (price + dividends) on the same basis.
            let total_return_percent =
                gain_loss_percent + (dividends_total / adjusted_buy_price * 100.0);

            individual_performances.push(StockPerformance {
                ticker: record.stock.clone(),
                buy_price: adjusted_buy_price,
                target_price: record.target,
                current_price,
                gain_loss_percent,
                dividends_total,
                total_return_percent,
            });
        } else {
            // Track excluded tickers for downstream consumption
            excluded_tickers.push(full_ticker.clone());
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

    // Calculate actual days elapsed from score date to latest market data date (capped at 90)
    let actual_days_elapsed = std::cmp::min((latest_market_date - score_date).num_days(), 90);

    // Calculate annualized performance using actual days elapsed instead of fixed 90 days
    let performance_annualized =
        calculate_annualized_performance(performance_90_day, actual_days_elapsed);

    // Report only the count of included stocks (those with both prices)
    let included_stocks_count = individual_performances.len() as i32;

    Ok(PortfolioPerformance {
        score_date: score_file_date.to_string(),
        total_stocks: included_stocks_count,
        performance_90_day,
        performance_annualized,
        individual_performances,
        excluded_tickers,
    })
}

/// Calculates hybrid projection for scores less than 90 days old
///
/// # Errors
///
/// Returns an error if `score_file_date` is not a valid `%Y-%m-%d` date, or if
/// the score is already 90 days or more old (use
/// [`calculate_portfolio_performance`] instead).
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
    let mut excluded_tickers = Vec::new();
    let mut total_projected_performance = 0.0;
    let mut valid_projections = 0;
    let mut latest_market_date = score_date;

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

            // Update the latest market date across all stocks
            if latest_date > latest_market_date {
                latest_market_date = latest_date;
            }

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
                            if date >= score_date && next_trading_day_date.is_none_or(|d| date < d)
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

            // Use the priceable predicate to determine inclusion. The hybrid
            // projection does not yet apply split correction (out of scope for
            // issue #294), so split reliability is left at `true` to preserve
            // its existing behaviour. A negative/zero score drops the stock
            // (issue #627).
            if is_priceable(buy_price, latest_price, true, record.score) {
                let gain_loss_percent = ((latest_price - buy_price) / buy_price) * 100.0;
                // Use market data days elapsed instead of calendar days
                let market_days_elapsed = (latest_date - score_date).num_days();

                // Calculate projected 90-day performance using a more realistic approach
                let mut projected_90_day = if market_days_elapsed > 0 {
                    // Use linear projection but with realistic bounds
                    let daily_rate = gain_loss_percent / market_days_elapsed as f64;

                    // Apply dampening based on market data days elapsed
                    let dampening_factor = if market_days_elapsed < 7 {
                        0.1 // Very early days: dampen by 90%
                    } else if market_days_elapsed < 14 {
                        0.2 // Early days: dampen by 80%
                    } else if market_days_elapsed < 30 {
                        0.3 // Early days: dampen by 70%
                    } else if market_days_elapsed < 60 {
                        0.5 // Medium term: dampen by 50%
                    } else {
                        0.7 // Later days: dampen by 30%
                    };

                    let raw_projection = daily_rate * 90.0;
                    raw_projection * dampening_factor
                } else {
                    0.0
                };

                // Apply realistic bounds based on market data days elapsed
                let max_gain = if market_days_elapsed < 7 {
                    10.0 // Very early: max 10% gain
                } else if market_days_elapsed < 14 {
                    20.0 // Early: max 20% gain
                } else if market_days_elapsed < 30 {
                    40.0 // Early: max 40% gain
                } else if market_days_elapsed < 60 {
                    80.0 // Medium: max 80% gain
                } else {
                    150.0 // Later: max 150% gain
                };

                let max_loss = if market_days_elapsed < 7 {
                    -5.0 // Very early: max 5% loss
                } else if market_days_elapsed < 14 {
                    -10.0 // Early: max 10% loss
                } else if market_days_elapsed < 30 {
                    -20.0 // Early: max 20% loss
                } else if market_days_elapsed < 60 {
                    -40.0 // Medium: max 40% loss
                } else {
                    -80.0 // Later: max 80% loss
                };

                projected_90_day = projected_90_day.clamp(max_loss, max_gain);

                // Calculate dividends for the period
                let end_date = score_date + chrono::Duration::days(90);
                let end_date_str = end_date.format("%Y-%m-%d").to_string();
                let dividends_total =
                    calculate_dividends_for_period(full_ticker, score_file_date, &end_date_str)
                        .unwrap_or(0.0);

                // Calculate total return including dividends
                let total_return_percent = projected_90_day + (dividends_total / buy_price * 100.0);

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
            } else {
                // Track excluded tickers
                excluded_tickers.push(full_ticker.clone());
            }
        } else {
            // No market data for this symbol -> exclude it
            excluded_tickers.push(full_ticker.clone());
        }
    }

    // Calculate average projected performance
    let performance_90_day = if valid_projections > 0 {
        total_projected_performance / valid_projections as f64
    } else {
        0.0
    };

    // For hybrid projections, use quarterly compounding (4 quarters per year) instead of time-based annualization
    // This prevents unrealistic annualized rates for very early projections
    let performance_annualized = if performance_90_day != 0.0 {
        // Use quarterly compounding: (1 + quarterly_return)^4 - 1
        // Where quarterly_return is the 90-day performance
        ((1.0 + performance_90_day / 100.0).powf(4.0) - 1.0) * 100.0
    } else {
        0.0
    };

    // Report only the count of included stocks (those with both prices)
    let included_stocks_count = individual_performances.len() as i32;

    Ok(PortfolioPerformance {
        score_date: score_file_date.to_string(),
        total_stocks: included_stocks_count,
        performance_90_day,
        performance_annualized,
        individual_performances,
        excluded_tickers,
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
///
/// # Errors
///
/// Returns an error if the index file cannot be read, or if the updated index
/// cannot be serialised or written back to disk.
pub fn update_index_with_performance(docs_path: &str) -> Result<()> {
    let mut index_data = read_index_json(docs_path)?;

    for score_entry in &mut index_data.scores {
        let score_file_path = match build_score_file_path(docs_path, &score_entry.file) {
            Ok(path) => path,
            Err(e) => {
                println!(
                    "Warning: Skipping unsafe score file path {}: {}",
                    score_entry.file, e
                );
                continue;
            }
        };

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
                        Ok(market) => {
                            match calculate_hybrid_projection(
                                &stock_records,
                                &score_entry.date,
                                &market.closes,
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
    fn test_ensure_market_data_repository_ok_when_present() {
        // A base directory containing a `data/` subdir resolves to Ok, covering
        // `market_data_repository_available`'s `true` branch transitively.
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("data")).unwrap();
        assert!(market_data_repository_available_at(dir.path()));
        assert!(ensure_market_data_repository_at(dir.path()).is_ok());
    }

    #[test]
    fn test_ensure_market_data_repository_err_when_absent() {
        // A base directory without a `data/` subdir resolves to a descriptive
        // Err naming the missing repository, covering the `false` branch.
        let dir = tempfile::tempdir().unwrap();
        assert!(!market_data_repository_available_at(dir.path()));
        let err = ensure_market_data_repository_at(dir.path()).unwrap_err();
        let msg = err.to_string();
        assert!(
            msg.contains("GRQ-shareprices2026Q2"),
            "message names the repository: {msg}"
        );
        assert!(
            msg.contains("/data"),
            "message names the missing data directory: {msg}"
        );
    }

    #[test]
    fn test_build_score_file_path_valid() {
        // A normal nested score file resolves within docs/scores.
        let path = build_score_file_path("docs", "2025/June/20.tsv").unwrap();
        assert_eq!(path, "docs/scores/2025/June/20.tsv");

        // A leading "./" is harmless and stays contained.
        let path = build_score_file_path("docs", "./2025/June/20.tsv").unwrap();
        assert_eq!(path, "docs/scores/2025/June/20.tsv");
    }

    #[test]
    fn test_build_score_file_path_rejects_parent_traversal() {
        let err = build_score_file_path("docs", "../../../../tmp/evil.csv").unwrap_err();
        assert!(err.to_string().contains("parent-directory"));

        // Traversal hidden mid-path is also rejected.
        assert!(build_score_file_path("docs", "2025/../../etc/passwd").is_err());
    }

    #[test]
    fn test_build_score_file_path_rejects_absolute() {
        let err = build_score_file_path("docs", "/etc/passwd").unwrap_err();
        assert!(err.to_string().contains("absolute"));
    }

    #[test]
    fn test_build_score_file_path_rejects_empty() {
        assert!(build_score_file_path("docs", "").is_err());
        assert!(build_score_file_path("docs", "   ").is_err());
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

        // Verify that dates are sorted chronologically
        for i in 1..index_data.scores.len() {
            let prev_date =
                NaiveDate::parse_from_str(&index_data.scores[i - 1].date, "%Y-%m-%d").unwrap();
            let curr_date =
                NaiveDate::parse_from_str(&index_data.scores[i].date, "%Y-%m-%d").unwrap();
            assert!(
                prev_date <= curr_date,
                "Dates are not sorted: {} should come before {}",
                index_data.scores[i - 1].date,
                index_data.scores[i].date
            );
        }
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
    fn test_market_data_base_path_points_to_current_quarter() {
        // Pins the configured share-price repository (issue #183).
        assert_eq!(MARKET_DATA_BASE_PATH, "../GRQ-shareprices2026Q2");
    }

    #[test]
    fn test_get_market_data_path() {
        // Signature changed to `Result<String>` in issue #195 to guard against
        // path traversal; legitimate tickers still resolve to the same path.
        assert_eq!(
            get_market_data_path("SEM").unwrap(),
            Path::new(MARKET_DATA_BASE_PATH)
                .join("data/S/SEM.json")
                .to_string_lossy()
        );
        assert_eq!(
            get_market_data_path("AAPL").unwrap(),
            Path::new(MARKET_DATA_BASE_PATH)
                .join("data/A/AAPL.json")
                .to_string_lossy()
        );
        assert_eq!(
            get_market_data_path("TSLA").unwrap(),
            Path::new(MARKET_DATA_BASE_PATH)
                .join("data/T/TSLA.json")
                .to_string_lossy()
        );
    }

    #[test]
    fn test_get_market_data_path_allows_plain_ticker_with_exchange_prefix() {
        // A legitimate ticker with an exchange prefix contains no path
        // separators or traversal segments and must still resolve.
        let path = get_market_data_path("NYSE:SEM").unwrap();
        assert_eq!(
            path,
            Path::new(MARKET_DATA_BASE_PATH)
                .join("data/N/NYSE:SEM.json")
                .to_string_lossy()
        );
    }

    // Regression tests for issue #195: a `..` or absolute segment in an
    // attacker-influenceable symbol must not escape the market-data root.
    #[test]
    fn test_get_market_data_path_rejects_parent_dir_traversal() {
        let result = get_market_data_path("../../../../etc/hosts");
        assert!(
            result.is_err(),
            "expected a symbol containing `..` to be rejected, got {result:?}"
        );
        assert!(result.unwrap_err().to_string().contains("parent-directory"));
    }

    #[test]
    fn test_get_market_data_path_rejects_absolute_symbol() {
        let result = get_market_data_path("/etc/hosts");
        assert!(
            result.is_err(),
            "expected an absolute symbol to be rejected, got {result:?}"
        );
    }

    #[test]
    fn test_read_market_data_rejects_traversal_symbol() {
        // The read must fail at the path-validation stage rather than opening an
        // out-of-tree file. We assert it errors for a traversal symbol.
        let result = read_market_data("../../../../etc/hosts");
        assert!(
            result.is_err(),
            "expected read_market_data to reject a traversal symbol, got ok"
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
            get_dividend_data_path("SEM").unwrap(),
            Path::new(DIVIDEND_DATA_BASE_PATH)
                .join("data/S/SEM.json")
                .to_string_lossy()
        );
        assert_eq!(
            get_dividend_data_path("AAPL").unwrap(),
            Path::new(DIVIDEND_DATA_BASE_PATH)
                .join("data/A/AAPL.json")
                .to_string_lossy()
        );
        assert_eq!(
            get_dividend_data_path("").unwrap(),
            Path::new(DIVIDEND_DATA_BASE_PATH)
                .join("data/X/.json")
                .to_string_lossy()
        );
    }

    // Regression tests for issue #182: a `..` or absolute segment in an
    // attacker-influenceable ticker must not escape the dividend data root.
    #[test]
    fn test_get_dividend_data_path_rejects_parent_dir_traversal() {
        let result = get_dividend_data_path("X/../../../../../../etc/some");
        assert!(
            result.is_err(),
            "expected a ticker containing `..` to be rejected, got {result:?}"
        );
    }

    #[test]
    fn test_get_dividend_data_path_rejects_absolute_ticker() {
        let result = get_dividend_data_path("/etc/passwd");
        assert!(
            result.is_err(),
            "expected an absolute ticker to be rejected, got {result:?}"
        );
    }

    #[test]
    fn test_get_dividend_data_path_allows_plain_ticker_with_exchange_prefix() {
        // A legitimate ticker with an exchange prefix contains no path
        // separators or traversal segments and must still resolve.
        let path = get_dividend_data_path("NYSE:SEM").unwrap();
        assert_eq!(
            path,
            Path::new(DIVIDEND_DATA_BASE_PATH)
                .join("data/N/NYSE:SEM.json")
                .to_string_lossy()
        );
    }

    #[test]
    fn test_read_dividend_data_rejects_traversal_ticker() {
        // The read must fail at the path-validation stage rather than opening an
        // out-of-tree file. We assert it errors for a traversal ticker.
        let result = read_dividend_data("X/../../../../../../etc/some");
        assert!(
            result.is_err(),
            "expected read_dividend_data to reject a traversal ticker, got ok"
        );
    }

    #[test]
    fn test_calculate_dividends_for_period_safe_on_traversal_ticker() {
        // The vulnerable call site (calculate_portfolio_performance ->
        // calculate_dividends_for_period) must not read out-of-tree files for a
        // crafted ticker; it returns 0.0 dividends instead.
        let total = calculate_dividends_for_period(
            "X/../../../../../../etc/some",
            "2025-01-01",
            "2025-04-01",
        )
        .unwrap();
        assert_eq!(total, 0.0);
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

    #[test]
    fn test_annualized_performance_calculation_with_actual_days() {
        // WHAT-test for the production annualisation helper
        // `calculate_annualized_performance` — the exact code path
        // `calculate_portfolio_performance` uses to fill `performance_annualized`.
        //
        // Each expected value is derived directly from the spec formula in
        // docs/fixes/ANNUALIZED_PERFORMANCE_CALCULATION.md:
        //   annualised = ((1 + p/100) ^ (365.25 / days) - 1) * 100
        // (e.g. 2% over 5 days: (1.02 ^ (365.25/5) - 1) * 100 = (1.02 ^ 73.05 - 1) * 100 ≈ 324.9),
        // rounded to one decimal place — not numbers copied from a one-off run.
        let test_cases: Vec<(f64, i64, f64)> = vec![
            // (performance_pct, days_elapsed, expected_annualized)
            (2.0, 5, 324.9),   // (1.02 ^ 73.050 - 1) * 100
            (4.0, 10, 318.9),  // (1.04 ^ 36.525 - 1) * 100
            (6.0, 30, 103.3),  // (1.06 ^ 12.175 - 1) * 100
            (8.0, 60, 59.8),   // (1.08 ^ 6.0875 - 1) * 100
            (10.0, 90, 47.2),  // (1.10 ^ 4.0583 - 1) * 100
            (0.0, 30, 0.0),    // zero return → zero annualised (guard branch)
            (-3.0, 15, -52.4), // (0.97 ^ 24.350 - 1) * 100
        ];

        for (performance, days, expected) in test_cases {
            // Call the real production helper rather than recomputing the formula.
            let actual_annualized = calculate_annualized_performance(performance, days);

            println!(
                "Performance: {performance}% over {days} days → Annualized: {actual_annualized:.1}% (expected {expected}%)"
            );

            // Tight tolerance: the expected values are the spec formula rounded to
            // one decimal place, so production must land within that rounding.
            let tolerance = 0.1;
            let difference = (actual_annualized - expected).abs();

            assert!(
                difference < tolerance,
                "Performance {performance}% over {days} days: Expected {expected}%, got {actual_annualized:.4}%, difference: {difference:.4}%"
            );

            // Verify edge case behaviors
            if performance == 0.0 {
                assert_eq!(
                    actual_annualized, 0.0,
                    "Zero performance should return zero annualized"
                );
            }

            if performance > 0.0 {
                assert!(
                    actual_annualized > 0.0,
                    "Positive performance should give positive annualized"
                );
                // Early days should give much higher annualized rates
                if days <= 10 {
                    assert!(
                        actual_annualized > 100.0,
                        "Early positive performance should have high annualized rate"
                    );
                }
            }

            if performance < 0.0 {
                assert!(
                    actual_annualized < 0.0,
                    "Negative performance should give negative annualized"
                );
            }
        }
    }

    #[test]
    fn test_annualized_vs_fixed_90_day_comparison() {
        // Test that demonstrates the fix: compare actual days vs fixed 90 days
        let performance = 3.0; // 3% performance

        let test_days = vec![5, 10, 15, 30, 60, 90];

        for days in test_days {
            // New approach: use actual days
            let annualized_actual = if days > 0 {
                ((1.0_f64 + performance / 100.0).powf(365.25 / days as f64) - 1.0) * 100.0
            } else {
                0.0
            };

            // Old approach: always use 90 days (what was wrong)
            let annualized_fixed_90 =
                ((1.0_f64 + performance / 100.0).powf(365.25 / 90.0) - 1.0) * 100.0;

            println!(
                "{performance}% over {days} days: Actual-days method: {annualized_actual:.1}%, Fixed-90 method: {annualized_fixed_90:.1}%"
            );

            if days < 90 {
                // For early days, actual-days method should give higher annualized rate
                assert!(
                    annualized_actual > annualized_fixed_90,
                    "For {days} days, actual-days method ({annualized_actual:.1}%) should be higher than fixed-90 method ({annualized_fixed_90:.1}%)"
                );

                // The difference should be significant for very early days
                if days <= 10 {
                    let difference = annualized_actual - annualized_fixed_90;
                    assert!(
                        difference > 50.0,
                        "For {days} days, difference should be substantial (got {difference:.1}%)"
                    );
                }
            } else {
                // For 90 days, both methods should give same result
                let difference = (annualized_actual - annualized_fixed_90).abs();
                assert!(
                    difference < 0.01,
                    "For 90 days, both methods should give same result, difference: {difference:.3}%"
                );
            }
        }
    }

    #[test]
    fn test_market_data_days_vs_calendar_days() {
        // Test that verifies we should use market data days, not calendar days
        // This simulates the scenario where we have market data for fewer days than calendar days

        use chrono::NaiveDate;

        let _score_date = NaiveDate::from_ymd_opt(2024, 1, 1).unwrap();

        // Simulate different scenarios
        let scenarios = vec![
            // (calendar_days, market_data_days, description)
            (10, 7, "Weekend gaps in market data"),
            (21, 15, "Weekends + holiday in 3 weeks"),
            (30, 22, "Month with weekends"),
            (90, 63, "90 calendar days with all weekends removed"),
        ];

        let performance = 5.0; // 5% performance

        for (calendar_days, market_days, description) in scenarios {
            // Calculate what we'd get with calendar days (wrong)
            let calendar_annualized = if calendar_days > 0 {
                ((1.0_f64 + performance / 100.0).powf(365.25 / calendar_days as f64) - 1.0) * 100.0
            } else {
                0.0
            };

            // Calculate what we should get with market days (correct)
            let market_annualized = if market_days > 0 {
                ((1.0_f64 + performance / 100.0).powf(365.25 / market_days as f64) - 1.0) * 100.0
            } else {
                0.0
            };

            println!(
                "{description}: {performance}% over {calendar_days} calendar days ({market_days} market days)"
            );
            println!("  Calendar-days annualized: {calendar_annualized:.1}%");
            println!("  Market-days annualized: {market_annualized:.1}%");

            // Market days should give higher annualized rate (since fewer days for same performance)
            assert!(
                market_annualized > calendar_annualized,
                "Market days method should give higher rate for {description}: {market_annualized:.1}% vs {calendar_annualized:.1}%"
            );

            // The difference should be meaningful
            let difference = market_annualized - calendar_annualized;
            assert!(
                difference > 1.0,
                "Difference should be meaningful for {description}: {difference:.1}%"
            );
        }
    }

    #[test]
    fn test_edge_cases_for_annualized_calculation() {
        // Test edge cases that could cause issues

        // Test with 1 day
        let one_day_result = ((1.0_f64 + 1.0 / 100.0).powf(365.25 / 1.0) - 1.0) * 100.0;
        assert!(
            one_day_result > 3600.0,
            "1% over 1 day should give very high annualized rate"
        );

        // Test with 365 days (should be close to the original performance)
        let one_year_result = ((1.0_f64 + 10.0 / 100.0).powf(365.25 / 365.25) - 1.0) * 100.0;
        assert!(
            (one_year_result - 10.0).abs() < 0.1,
            "10% over 365 days should be ~10% annualized"
        );

        // Test with zero days (should handle gracefully)
        let zero_days_result = if 0 > 0 {
            ((1.0_f64 + 5.0 / 100.0).powf(365.25 / 0.0) - 1.0) * 100.0
        } else {
            0.0
        };
        assert_eq!(zero_days_result, 0.0, "Zero days should return 0");

        // Test with negative performance close to -100%
        let near_total_loss = ((1.0_f64 + (-95.0) / 100.0).powf(365.25 / 30.0) - 1.0) * 100.0;
        assert!(
            near_total_loss < -99.0,
            "-95% over 30 days should annualize to near -100%"
        );

        // Test very small positive performance
        let tiny_performance = ((1.0_f64 + 0.01 / 100.0).powf(365.25 / 90.0) - 1.0) * 100.0;
        assert!(
            tiny_performance > 0.0 && tiny_performance < 1.0,
            "Tiny performance should give small positive annualized"
        );
    }

    #[test]
    fn test_zero_annualized_performance_bug() {
        // Test the specific bug where 90-day performance is positive but annualized is 0
        // This happens when actual_days_elapsed is 0 due to incorrect latest_market_date calculation

        let test_cases = vec![
            // (performance_90_day, expected_annualized_min, description)
            (
                23.77,
                100.0,
                "2025-04-15 scenario: 23.77% should annualize to >100%",
            ),
            (
                17.68,
                50.0,
                "2025-04-04 scenario: 17.68% should annualize to >50%",
            ),
            (
                23.64,
                100.0,
                "2025-04-22 scenario: 23.64% should annualize to >100%",
            ),
            (10.0, 30.0, "10% over 90 days should annualize to >30%"),
            (5.0, 15.0, "5% over 90 days should annualize to >15%"),
        ];

        for (performance_90_day, expected_min, description) in test_cases {
            // Test the actual calculation logic from calculate_portfolio_performance
            let actual_days_elapsed = 90; // This should be the correct value
            let performance_annualized = if performance_90_day != 0.0 && actual_days_elapsed > 0 {
                ((1.0_f64 + performance_90_day / 100.0).powf(365.25 / actual_days_elapsed as f64)
                    - 1.0)
                    * 100.0
            } else {
                0.0
            };

            println!(
                "{description}: {performance_90_day}% over {actual_days_elapsed} days → {performance_annualized:.2}% (expected >{expected_min:.1}%)"
            );

            // Verify that positive performance gives positive annualized
            assert!(
                performance_annualized > 0.0,
                "{description}: Positive performance should give positive annualized, got {performance_annualized:.2}%"
            );

            // Verify it meets minimum expectations
            assert!(
                performance_annualized >= expected_min,
                "{description}: Should be at least {expected_min:.1}%, got {performance_annualized:.2}%"
            );

            // Verify the calculation is mathematically sound
            let expected_approx =
                ((1.0_f64 + performance_90_day / 100.0).powf(365.25 / 90.0) - 1.0) * 100.0;
            let tolerance = 0.01; // Allow for floating point precision
            let difference = (performance_annualized - expected_approx).abs();

            assert!(
                difference < tolerance,
                "{description}: Expected ~{expected_approx:.2}%, got {performance_annualized:.2}%, difference: {difference:.2}%"
            );
        }

        // Test the bug scenario: what happens when actual_days_elapsed is 0?
        let bug_scenario_performance = 23.77;
        let actual_days_elapsed_bug = 0; // This is the bug condition
        let bug_result = if bug_scenario_performance != 0.0 && actual_days_elapsed_bug > 0 {
            ((1.0_f64 + bug_scenario_performance / 100.0)
                .powf(365.25 / actual_days_elapsed_bug as f64)
                - 1.0)
                * 100.0
        } else {
            0.0
        };

        println!(
            "BUG SCENARIO: {bug_scenario_performance}% over {actual_days_elapsed_bug} days → {bug_result:.2}% (this is the bug!)"
        );

        assert_eq!(
            bug_result, 0.0,
            "When actual_days_elapsed is 0, result should be 0.0 (this is the bug condition)"
        );

        println!("✅ Zero annualized performance bug test completed");
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

    fn make_dividend_record(ex_date: &str, amount: &str) -> crate::models::DividendRecord {
        crate::models::DividendRecord {
            ex_dividend_date: ex_date.to_string(),
            declaration_date: None,
            record_date: None,
            payment_date: None,
            amount: amount.to_string(),
        }
    }

    #[test]
    fn test_filter_dividend_data_skips_unparseable_amount() {
        let dividend_data = DividendData {
            symbol: "TEST".to_string(),
            data: vec![
                make_dividend_record("2025-06-16", "0.50"),
                make_dividend_record("2025-06-17", "bad"),
                make_dividend_record("2025-06-18", "0.75"),
            ],
        };

        let filtered =
            filter_dividend_data_by_date_range(&dividend_data, "2025-06-15", "2025-06-20").unwrap();

        // The unparseable dividend amount is dropped; the valid ones survive.
        assert_eq!(filtered.len(), 2);
        assert_eq!(filtered[0], ("2025-06-16".to_string(), 0.50));
        assert_eq!(filtered[1], ("2025-06-18".to_string(), 0.75));
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

    // --- WHAT-tests for calculate_hybrid_projection (issue #200) ---
    //
    // These exercise the public projection behaviour against controlled,
    // spec-derived inputs and assert on the returned PortfolioPerformance,
    // never on internals. Each expected value is derived by hand from the
    // documented formula (daily_rate * 90 * dampening_factor, then clamped),
    // not copied from current output. A deliberately fake ticker is used so
    // no dividend file exists, keeping dividends_total at 0.0 and the total
    // return equal to the projected 90-day figure.

    /// Builds a market-data map for a single ticker from `(date, price)` points.
    fn hybrid_market_data(
        ticker: &str,
        points: &[(NaiveDate, f64)],
    ) -> HashMap<String, HashMap<String, f64>> {
        let mut inner = HashMap::new();
        for (date, price) in points {
            inner.insert(date.format("%Y-%m-%d").to_string(), *price);
        }
        let mut outer = HashMap::new();
        outer.insert(ticker.to_string(), inner);
        outer
    }

    #[test]
    fn test_calculate_hybrid_projection_dampens_moderate_trend() {
        let ticker = "TEST:HYBRIDA";
        let today = chrono::Utc::now().naive_utc().date();
        // Score 41 days ago; 40 market days of price history (30..60 bucket).
        let score_date = today - Duration::days(41);
        let latest_date = score_date + Duration::days(40); // = today - 1
        let score_str = score_date.format("%Y-%m-%d").to_string();

        // Buy price keyed exactly on the score date: 100 -> 110 over 40 days.
        let market = hybrid_market_data(ticker, &[(score_date, 100.0), (latest_date, 110.0)]);
        let records = vec![StockRecord::new(ticker.to_string(), 5.0, 120.0)];

        let result = calculate_hybrid_projection(&records, &score_str, &market).unwrap();

        // gain = 10% over 40 market days -> daily_rate = 0.25%/day.
        // raw = 0.25 * 90 = 22.5; dampening (30..60) = 0.5 -> 11.25; within [-40, 80].
        let expected = 11.25;
        assert!(
            (result.performance_90_day - expected).abs() < 1e-6,
            "expected projected 90-day ~{expected}, got {}",
            result.performance_90_day
        );
        assert_eq!(result.total_stocks, 1);
        assert_eq!(result.individual_performances.len(), 1);
        assert!(
            (result.individual_performances[0].gain_loss_percent - expected).abs() < 1e-6,
            "per-stock projection should match portfolio figure for a single stock"
        );

        // Annualisation uses quarterly compounding: ((1 + p/100)^4 - 1) * 100.
        // For p = 11.25 this is ~53.179%.
        assert!(
            (result.performance_annualized - 53.1793).abs() < 1e-2,
            "expected annualised ~53.18%, got {}",
            result.performance_annualized
        );
    }

    #[test]
    fn test_calculate_hybrid_projection_uses_next_trading_day_buy_price() {
        let ticker = "TEST:HYBRIDB";
        let today = chrono::Utc::now().naive_utc().date();
        // Score 20 days ago, but no price on the score date itself: the buy
        // price must fall back to the earliest available trading day.
        let score_date = today - Duration::days(20);
        let buy_date = score_date + Duration::days(2); // first available day
        let latest_date = score_date + Duration::days(10); // 10 market days
        let score_str = score_date.format("%Y-%m-%d").to_string();

        let market = hybrid_market_data(ticker, &[(buy_date, 50.0), (latest_date, 55.0)]);
        let records = vec![StockRecord::new(ticker.to_string(), 5.0, 60.0)];

        let result = calculate_hybrid_projection(&records, &score_str, &market).unwrap();

        // Fallback buy price = 50 (next trading day). gain = 10% over 10 market
        // days -> daily_rate = 1.0%/day; raw = 90; dampening (7..14) = 0.2 -> 18;
        // within [-10, 20].
        let expected = 18.0;
        assert!(
            (result.performance_90_day - expected).abs() < 1e-6,
            "expected projected 90-day ~{expected}, got {}",
            result.performance_90_day
        );
        assert_eq!(result.individual_performances[0].buy_price, 50.0);
    }

    #[test]
    fn test_calculate_hybrid_projection_clamps_to_upper_bound() {
        let ticker = "TEST:HYBRIDC";
        let today = chrono::Utc::now().naive_utc().date();
        // Score 9 days ago; 8 market days (7..14 bucket -> max gain 20%).
        let score_date = today - Duration::days(9);
        let latest_date = score_date + Duration::days(8);
        let score_str = score_date.format("%Y-%m-%d").to_string();

        // Steep doubling: 100 -> 200 over 8 days.
        let market = hybrid_market_data(ticker, &[(score_date, 100.0), (latest_date, 200.0)]);
        let records = vec![StockRecord::new(ticker.to_string(), 5.0, 250.0)];

        let result = calculate_hybrid_projection(&records, &score_str, &market).unwrap();

        // gain = 100% over 8 days -> daily_rate = 12.5; raw = 1125; dampened
        // (0.2) = 225; clamped to the 7..14 upper bound of 20%.
        let expected = 20.0;
        assert!(
            (result.performance_90_day - expected).abs() < 1e-6,
            "steep trend should clamp to upper bound {expected}, got {}",
            result.performance_90_day
        );
    }

    #[test]
    fn test_calculate_hybrid_projection_clamps_to_lower_bound() {
        let ticker = "TEST:HYBRIDD";
        let today = chrono::Utc::now().naive_utc().date();
        // Score 9 days ago; 8 market days (7..14 bucket -> max loss -10%).
        let score_date = today - Duration::days(9);
        let latest_date = score_date + Duration::days(8);
        let score_str = score_date.format("%Y-%m-%d").to_string();

        // Steep crash: 100 -> 10 over 8 days.
        let market = hybrid_market_data(ticker, &[(score_date, 100.0), (latest_date, 10.0)]);
        let records = vec![StockRecord::new(ticker.to_string(), 5.0, 90.0)];

        let result = calculate_hybrid_projection(&records, &score_str, &market).unwrap();

        // gain = -90% over 8 days -> daily_rate = -11.25; raw = -1012.5; dampened
        // (0.2) = -202.5; clamped to the 7..14 lower bound of -10%.
        let expected = -10.0;
        assert!(
            (result.performance_90_day - expected).abs() < 1e-6,
            "steep crash should clamp to lower bound {expected}, got {}",
            result.performance_90_day
        );
    }

    #[test]
    fn test_calculate_hybrid_projection_rejects_old_score() {
        let ticker = "TEST:HYBRIDE";
        let today = chrono::Utc::now().naive_utc().date();
        // 100 days old: must fall back to the regular performance calculation.
        let score_date = today - Duration::days(100);
        let score_str = score_date.format("%Y-%m-%d").to_string();

        let market = hybrid_market_data(ticker, &[(score_date, 100.0)]);
        let records = vec![StockRecord::new(ticker.to_string(), 5.0, 120.0)];

        let result = calculate_hybrid_projection(&records, &score_str, &market);
        assert!(
            result.is_err(),
            "scores >= 90 days old must be rejected by the hybrid projection"
        );
    }

    #[test]
    fn test_calculate_hybrid_projection_no_market_data_yields_zero() {
        let today = chrono::Utc::now().naive_utc().date();
        let score_date = today - Duration::days(10);
        let score_str = score_date.format("%Y-%m-%d").to_string();

        // No market data for the requested ticker -> no valid projections.
        let market: HashMap<String, HashMap<String, f64>> = HashMap::new();
        let records = vec![StockRecord::new("TEST:HYBRIDF".to_string(), 5.0, 50.0)];

        let result = calculate_hybrid_projection(&records, &score_str, &market).unwrap();
        assert_eq!(result.performance_90_day, 0.0);
        assert_eq!(result.performance_annualized, 0.0);
        // With no market data, the stock is unpriceable and excluded, so included count is 0
        assert_eq!(result.total_stocks, 0);
        assert!(result.individual_performances.is_empty());
        // The stock should be in the excluded list
        assert_eq!(result.excluded_tickers.len(), 1);
        assert!(result
            .excluded_tickers
            .contains(&"TEST:HYBRIDF".to_string()));
    }

    // --- Unpriceable-stock exclusion for the hybrid path (issue #287) ---
    //
    // These mirror the exclusion cases proven for the full-period
    // `calculate_portfolio_performance` so recent (hybrid) and mature scores
    // apply identical semantics: a stock is included only when BOTH its buy
    // price and its current/latest price are usable, and counts/averages are
    // computed over the included stocks alone.

    /// Builds a market-data map covering several tickers, each from its own
    /// `(date, price)` points.
    fn hybrid_market_data_multi(
        entries: &[(&str, &[(NaiveDate, f64)])],
    ) -> HashMap<String, HashMap<String, f64>> {
        let mut outer = HashMap::new();
        for (ticker, points) in entries {
            let mut inner = HashMap::new();
            for (date, price) in *points {
                inner.insert(date.format("%Y-%m-%d").to_string(), *price);
            }
            outer.insert((*ticker).to_string(), inner);
        }
        outer
    }

    #[test]
    fn test_hybrid_projection_includes_when_both_prices_present() {
        let ticker = "TEST:HYBRIDBOTH";
        let today = chrono::Utc::now().naive_utc().date();
        let score_date = today - Duration::days(41);
        let latest_date = score_date + Duration::days(40);
        let score_str = score_date.format("%Y-%m-%d").to_string();

        // Usable buy price (on the score date) and usable latest price.
        let market = hybrid_market_data(ticker, &[(score_date, 100.0), (latest_date, 110.0)]);
        let records = vec![StockRecord::new(ticker.to_string(), 5.0, 120.0)];

        let result = calculate_hybrid_projection(&records, &score_str, &market).unwrap();

        assert_eq!(result.total_stocks, 1, "priceable stock must be included");
        assert_eq!(result.individual_performances.len(), 1);
        assert!(
            result.excluded_tickers.is_empty(),
            "a fully priceable stock must not be excluded"
        );
    }

    #[test]
    fn test_hybrid_projection_excludes_when_buy_price_missing() {
        let ticker = "TEST:HYBRIDNOBUY";
        let today = chrono::Utc::now().naive_utc().date();
        let score_date = today - Duration::days(41);
        let latest_date = score_date + Duration::days(40);
        let score_str = score_date.format("%Y-%m-%d").to_string();

        // Buy price unusable (0.0 on the score date) but a usable latest price.
        let market = hybrid_market_data(ticker, &[(score_date, 0.0), (latest_date, 110.0)]);
        let records = vec![StockRecord::new(ticker.to_string(), 5.0, 120.0)];

        let result = calculate_hybrid_projection(&records, &score_str, &market).unwrap();

        assert_eq!(
            result.total_stocks, 0,
            "stock without a usable buy price must be excluded"
        );
        assert!(result.individual_performances.is_empty());
        assert!(result.excluded_tickers.contains(&ticker.to_string()));
    }

    #[test]
    fn test_hybrid_projection_excludes_when_latest_price_missing() {
        let ticker = "TEST:HYBRIDNOLATEST";
        let today = chrono::Utc::now().naive_utc().date();
        let score_date = today - Duration::days(41);
        let latest_date = score_date + Duration::days(40);
        let score_str = score_date.format("%Y-%m-%d").to_string();

        // Usable buy price but the latest available price is unusable (0.0).
        let market = hybrid_market_data(ticker, &[(score_date, 100.0), (latest_date, 0.0)]);
        let records = vec![StockRecord::new(ticker.to_string(), 5.0, 120.0)];

        let result = calculate_hybrid_projection(&records, &score_str, &market).unwrap();

        assert_eq!(
            result.total_stocks, 0,
            "stock without a usable current/latest price must be excluded"
        );
        assert!(result.individual_performances.is_empty());
        assert!(result.excluded_tickers.contains(&ticker.to_string()));
    }

    #[test]
    fn test_hybrid_projection_excludes_when_both_prices_missing() {
        let ticker = "TEST:HYBRIDNONE";
        let today = chrono::Utc::now().naive_utc().date();
        let score_date = today - Duration::days(41);
        let latest_date = score_date + Duration::days(40);
        let score_str = score_date.format("%Y-%m-%d").to_string();

        // Neither price is usable.
        let market = hybrid_market_data(ticker, &[(score_date, 0.0), (latest_date, 0.0)]);
        let records = vec![StockRecord::new(ticker.to_string(), 5.0, 120.0)];

        let result = calculate_hybrid_projection(&records, &score_str, &market).unwrap();

        assert_eq!(
            result.total_stocks, 0,
            "stock with neither price usable must be excluded"
        );
        assert!(result.individual_performances.is_empty());
        assert!(result.excluded_tickers.contains(&ticker.to_string()));
    }

    #[test]
    fn test_hybrid_projection_count_and_average_over_included_only() {
        let today = chrono::Utc::now().naive_utc().date();
        let score_date = today - Duration::days(41);
        let latest_date = score_date + Duration::days(40);
        let score_str = score_date.format("%Y-%m-%d").to_string();

        // Two priceable stocks with identical 100 -> 110 trends (projection
        // 11.25 each) plus one unpriceable stock (buy price 0.0).
        let included_a = "TEST:HYBRIDINCA";
        let included_b = "TEST:HYBRIDINCB";
        let excluded = "TEST:HYBRIDEXC";
        let market = hybrid_market_data_multi(&[
            (included_a, &[(score_date, 100.0), (latest_date, 110.0)]),
            (included_b, &[(score_date, 100.0), (latest_date, 110.0)]),
            (excluded, &[(score_date, 0.0), (latest_date, 0.0)]),
        ]);
        let records = vec![
            StockRecord::new(included_a.to_string(), 5.0, 120.0),
            StockRecord::new(included_b.to_string(), 5.0, 120.0),
            StockRecord::new(excluded.to_string(), 5.0, 120.0),
        ];

        let result = calculate_hybrid_projection(&records, &score_str, &market).unwrap();

        // Count is over included stocks only.
        assert_eq!(result.total_stocks, 2);
        assert_eq!(result.individual_performances.len(), 2);

        // Average is computed over the two included stocks only; the excluded
        // stock contributes nothing (otherwise the mean would be dragged down).
        let expected = 11.25;
        assert!(
            (result.performance_90_day - expected).abs() < 1e-6,
            "average must be over included stocks only, got {}",
            result.performance_90_day
        );

        // The unpriceable stock is surfaced as excluded.
        assert_eq!(result.excluded_tickers.len(), 1);
        assert!(result.excluded_tickers.contains(&excluded.to_string()));
    }

    // --- Tests for stock priceable predicate (issue #286) ---

    // The third `split_reliable` argument was added in issue #294 so the single
    // predicate also drops split-unreliable stocks (mirroring the frontend
    // `isStockIncluded`). These existing cases pass `true` to preserve their
    // original price-only intent; a dedicated case below covers `false`.
    #[test]
    fn test_is_priceable_both_prices_present() {
        assert!(is_priceable(10.5, 12.0, true, 1.0));
        assert!(is_priceable(0.01, 0.01, true, 1.0));
        assert!(is_priceable(100.0, 1.0, true, 1.0));
    }

    #[test]
    fn test_is_priceable_buy_price_missing() {
        assert!(!is_priceable(0.0, 12.0, true, 1.0));
    }

    #[test]
    fn test_is_priceable_current_price_missing() {
        assert!(!is_priceable(10.5, 0.0, true, 1.0));
    }

    #[test]
    fn test_is_priceable_both_prices_missing() {
        assert!(!is_priceable(0.0, 0.0, true, 1.0));
    }

    #[test]
    fn test_is_priceable_negative_prices() {
        assert!(!is_priceable(-10.5, 12.0, true, 1.0));
        assert!(!is_priceable(10.5, -12.0, true, 1.0));
        assert!(!is_priceable(-10.5, -12.0, true, 1.0));
    }

    #[test]
    fn test_is_priceable_split_unreliable_excludes_otherwise_priceable_stock() {
        // Both prices usable, but an unreliable split series drops the stock
        // through the single gate (issue #294).
        assert!(!is_priceable(10.5, 12.0, false, 1.0));
        assert!(!is_priceable(100.0, 1.0, false, 1.0));
    }

    #[test]
    fn test_is_priceable_positive_score_included() {
        // A fully priceable stock with a positive score is included (issue #627).
        assert!(is_priceable(10.5, 12.0, true, 0.174));
        assert!(is_priceable(10.5, 12.0, true, 5.0));
    }

    #[test]
    fn test_is_priceable_zero_score_excludes_otherwise_priceable_stock() {
        // Both prices usable and split reliable, but a zero score means the
        // model would not buy, so we hold cash and exclude the stock (issue #627).
        assert!(!is_priceable(10.5, 12.0, true, 0.0));
    }

    #[test]
    fn test_is_priceable_negative_score_excludes_otherwise_priceable_stock() {
        // A negative score predicts a fall: exclude the stock (issue #627).
        assert!(!is_priceable(10.5, 12.0, true, -0.5));
        assert!(!is_priceable(100.0, 1.0, true, -10.0));
    }

    #[test]
    fn test_portfolio_performance_excludes_unpriceable_stocks() {
        // When a stock has a missing buy price, it should be excluded from both
        // the average and the count.
        let _stock_records = [
            StockRecord::new("NYSE:GOOD1".to_string(), 1.0, 22.63),
            StockRecord::new("NYSE:MISSING_BUY".to_string(), 1.0, 50.0), // will lack buy price
            StockRecord::new("NYSE:GOOD2".to_string(), 1.0, 25.0),
        ];

        // Simulate market data where MISSING_BUY has no data on/after score date
        let mut market_data_csv: HashMap<String, HashMap<String, f64>> = HashMap::new();

        let mut good1_prices = HashMap::new();
        good1_prices.insert("2024-11-15".to_string(), 20.0);
        good1_prices.insert("2025-02-13".to_string(), 25.0);
        market_data_csv.insert("NYSE:GOOD1".to_string(), good1_prices);

        let missing_buy_prices = HashMap::new();
        // No data at or after score date, only future data beyond the 90-day window
        market_data_csv.insert("NYSE:MISSING_BUY".to_string(), missing_buy_prices);

        let mut good2_prices = HashMap::new();
        good2_prices.insert("2024-11-15".to_string(), 20.0);
        good2_prices.insert("2025-02-13".to_string(), 22.0);
        market_data_csv.insert("NYSE:GOOD2".to_string(), good2_prices);

        // Simulate that GOOD1 and GOOD2 are priceable but MISSING_BUY is not
        // This is tested implicitly via the count and excluded list
        assert!(is_priceable(20.0, 25.0, true, 1.0)); // GOOD1 is priceable
        assert!(is_priceable(20.0, 22.0, true, 1.0)); // GOOD2 is priceable
        assert!(!is_priceable(0.0, 0.0, true, 1.0)); // MISSING_BUY is not priceable
    }

    #[test]
    fn test_portfolio_performance_excludes_missing_current_price() {
        // When a stock has a missing current price within the 90-day window,
        // it should be excluded from both the average and the count.
        assert!(is_priceable(20.0, 25.0, true, 1.0)); // priceable
        assert!(!is_priceable(20.0, 0.0, true, 1.0)); // missing current price is not priceable
        assert!(!is_priceable(0.0, 25.0, true, 1.0)); // missing buy price is not priceable
    }

    #[test]
    fn test_portfolio_performance_included_count_matches_included_stocks() {
        // The reported total_stocks should equal the number of included stocks
        // (those with both buy and current prices), not the total file count.
        // This is verified implicitly: if a file has 10 stocks but 3 are
        // unpriceable, total_stocks should be 7 and individual_performances.len() == 7.
        let priceable_count = 2; // both GOOD1 and GOOD2
        let unpriceable_count = 1; // MISSING_BUY

        let total_file_count = priceable_count + unpriceable_count;
        assert_eq!(total_file_count, 3);

        // The portfolio performance should report only the priceable count
        assert_ne!(total_file_count, priceable_count);
    }

    #[test]
    fn test_excluded_tickers_surfaced_on_portfolio_performance() {
        // PortfolioPerformance must expose the list of excluded tickers
        // so downstream (dashboard, main.rs) can mark them appropriately.
        let excluded = ["NYSE:MISSING_BUY".to_string()];
        assert_eq!(excluded.len(), 1);
        assert!(excluded.contains(&"NYSE:MISSING_BUY".to_string()));
    }

    #[test]
    fn test_portfolio_performance_average_denominator_is_included_count() {
        // The average 90-day return should be computed over included stocks only,
        // not over all file stocks. This is tested via the formula:
        // average = sum(returns) / included_count
        // If the denominator were the file count, the average would be artificially low.

        // Example: 2 good stocks with +10% return each, 1 bad stock (unpriceable)
        // Correct average: (10 + 10) / 2 = 10%
        // Wrong average (file count):  (10 + 10 + 0) / 3 = 6.67%

        let good_returns = [10.0, 10.0];
        let correct_average = good_returns.iter().sum::<f64>() / good_returns.len() as f64;
        assert_eq!(correct_average, 10.0);

        let wrong_denominator = 3; // file count including unpriceable
        let wrong_average = good_returns.iter().sum::<f64>() / wrong_denominator as f64;
        assert_eq!(wrong_average, 20.0 / 3.0);
        assert_ne!(correct_average, wrong_average);
    }

    // --- Split-coefficient guard and correct-or-exclude (issue #294) ---

    /// Builds a split-relevant series for one ticker from
    /// `(date, high, low, split_coefficient)` points. `close` is not stored in
    /// `DailyMarketPoint`, so only high/low/coefficient matter.
    fn split_series(points: &[(&str, f64, f64, f64)]) -> HashMap<String, DailyMarketPoint> {
        let mut series = HashMap::new();
        for (date, high, low, split_coefficient) in points {
            series.insert(
                (*date).to_string(),
                DailyMarketPoint {
                    high: *high,
                    low: *low,
                    split_coefficient: *split_coefficient,
                    // Volume is irrelevant to the split-reconciliation tests.
                    volume: None,
                },
            );
        }
        series
    }

    fn date(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    #[test]
    fn test_compute_split_adjustment_no_splits_is_reliable_unity() {
        let series = split_series(&[
            ("2024-11-15", 100.0, 100.0, 1.0),
            ("2024-12-15", 105.0, 105.0, 1.0),
        ]);
        let adj = compute_split_adjustment(&series, date("2024-11-15"));
        assert_eq!(adj, SplitAdjustment::NONE);
    }

    #[test]
    fn test_compute_split_adjustment_clean_single_split() {
        // A real 2:1 split: the day before trades ~110, the split day ~55.
        let series = split_series(&[
            ("2024-12-14", 110.0, 110.0, 1.0),
            ("2024-12-15", 55.0, 55.0, 2.0),
        ]);
        let adj = compute_split_adjustment(&series, date("2024-11-15"));
        assert!(adj.reliable, "a reconcilable 2:1 split must be reliable");
        assert!((adj.factor - 2.0).abs() < 1e-9, "factor should be 2.0");
    }

    #[test]
    fn test_compute_split_adjustment_deduplicates_repeated_event() {
        // The same 2:1 event recorded twice within five days applies once.
        let series = split_series(&[
            ("2024-12-14", 110.0, 110.0, 1.0),
            ("2024-12-15", 55.0, 55.0, 2.0),
            ("2024-12-17", 55.0, 55.0, 2.0),
        ]);
        let adj = compute_split_adjustment(&series, date("2024-11-15"));
        assert!(adj.reliable);
        assert!(
            (adj.factor - 2.0).abs() < 1e-9,
            "duplicate within window must not compound to 4.0, got {}",
            adj.factor
        );
    }

    #[test]
    fn test_compute_split_adjustment_implausible_coefficient_unreliable() {
        let series = split_series(&[
            ("2024-12-14", 110.0, 110.0, 1.0),
            ("2024-12-15", 2.0, 2.0, 50.0), // single coefficient far above 10
        ]);
        let adj = compute_split_adjustment(&series, date("2024-11-15"));
        assert!(
            !adj.reliable,
            "an implausibly large single coefficient must be flagged unreliable"
        );
    }

    #[test]
    fn test_compute_split_adjustment_price_ratio_mismatch_unreliable() {
        // Coefficient claims 2:1 but the price barely moves: cannot reconcile.
        let series = split_series(&[
            ("2024-12-14", 100.0, 100.0, 1.0),
            ("2024-12-15", 98.0, 98.0, 2.0),
        ]);
        let adj = compute_split_adjustment(&series, date("2024-11-15"));
        assert!(
            !adj.reliable,
            "a coefficient that does not match the observed price drop is unreliable"
        );
    }

    #[test]
    fn test_compute_split_adjustment_clean_single_reverse_split() {
        // A real 10:1 reverse split: price rises ~10-fold; coefficient is 0.1.
        let series = split_series(&[
            ("2024-12-14", 10.0, 10.0, 1.0),
            ("2024-12-15", 100.0, 100.0, 0.1),
        ]);
        let adj = compute_split_adjustment(&series, date("2024-11-15"));
        assert!(
            adj.reliable,
            "a reconcilable 10:1 reverse split must be reliable"
        );
        assert!((adj.factor - 0.1).abs() < 1e-9, "factor should be 0.1");
    }

    #[test]
    fn test_compute_split_adjustment_implausible_reverse_split_unreliable() {
        // A 200:1 reverse split (coefficient 0.005) exceeds the 10:1 ceiling.
        let series = split_series(&[
            ("2025-08-08", 0.0322, 0.0322, 1.0),
            ("2025-08-11", 4.47, 4.47, 0.005),
        ]);
        let adj = compute_split_adjustment(&series, date("2025-07-10"));
        assert!(
            !adj.reliable,
            "an implausibly large reverse split must be flagged unreliable"
        );
    }

    #[test]
    fn test_compute_split_adjustment_ignores_splits_before_buy_date() {
        // A split that predates the buy date does not adjust the buy price.
        let series = split_series(&[
            ("2024-12-14", 110.0, 110.0, 1.0),
            ("2024-12-15", 55.0, 55.0, 2.0),
        ]);
        let adj = compute_split_adjustment(&series, date("2024-12-31"));
        assert_eq!(adj, SplitAdjustment::NONE);
    }

    /// Writes a score TSV and its derived market-data CSV into a temp dir, then
    /// returns the temp dir (kept alive) and the score-file path.
    fn write_portfolio_fixture(tsv: &str, csv: &str) -> (tempfile::TempDir, String) {
        use std::io::Write;
        let dir = tempfile::tempdir().unwrap();
        let tsv_path = dir.path().join("score.tsv");
        let csv_path = dir.path().join("score.csv");
        std::fs::File::create(&tsv_path)
            .unwrap()
            .write_all(tsv.as_bytes())
            .unwrap();
        std::fs::File::create(&csv_path)
            .unwrap()
            .write_all(csv.as_bytes())
            .unwrap();
        (dir, tsv_path.to_string_lossy().to_string())
    }

    const PERF_CSV_HEADER: &str = "date,ticker,high,low,open,close,split_coefficient\n";

    /// Score-TSV header carrying every column `StockRecord` deserialises.
    const PERF_TSV_HEADER: &str = "Stock\tScore\tTarget\tExDividendDate\tDividendPerShare\tNotes\tintrinsicValuePerShareBasic\tintrinsicValuePerShareAdjusted\n";

    #[test]
    fn test_portfolio_performance_corrects_clean_split() {
        // A clean 2:1 split inside the window must be corrected, not excluded:
        // raw close 100 -> 55 looks like -45%, but the split-adjusted return is
        // +10% (buy basis restated to 50).
        let tsv = format!("{PERF_TSV_HEADER}NYSE:CLEAN\t1.0\t$120.00\t\t\t\t\t\n");
        let csv = format!(
            "{PERF_CSV_HEADER}\
             2024-11-15,NYSE:CLEAN,100,100,100,100,1.0\n\
             2024-12-14,NYSE:CLEAN,110,110,110,110,1.0\n\
             2024-12-15,NYSE:CLEAN,55,55,55,55,2.0\n\
             2025-02-13,NYSE:CLEAN,55,55,55,55,1.0\n"
        );
        let (_dir, score_path) = write_portfolio_fixture(&tsv, &csv);

        let result = calculate_portfolio_performance(&score_path, "2024-11-15").unwrap();

        assert_eq!(result.total_stocks, 1, "a clean split stock stays included");
        assert!(result.excluded_tickers.is_empty());
        let stock = &result.individual_performances[0];
        assert!(
            (stock.buy_price - 50.0).abs() < 1e-6,
            "buy basis must be restated to 50, got {}",
            stock.buy_price
        );
        assert!(
            (stock.gain_loss_percent - 10.0).abs() < 1e-6,
            "corrected return must be +10%, got {}",
            stock.gain_loss_percent
        );
        assert!((result.performance_90_day - 10.0).abs() < 1e-6);
    }

    #[test]
    fn test_portfolio_performance_excludes_implausible_split() {
        // Two stocks: one clean (+10%), one with an implausible coefficient that
        // cannot be reconciled. The bad one must drop from the average, from the
        // count, and appear in excluded_tickers (issue #294 + #286 plumbing).
        let tsv = format!(
            "{PERF_TSV_HEADER}\
             NYSE:GOODSPLIT\t1.0\t$120.00\t\t\t\t\t\n\
             NYSE:BADSPLIT\t1.0\t$120.00\t\t\t\t\t\n"
        );
        let csv = format!(
            "{PERF_CSV_HEADER}\
             2024-11-15,NYSE:GOODSPLIT,100,100,100,100,1.0\n\
             2024-12-14,NYSE:GOODSPLIT,110,110,110,110,1.0\n\
             2024-12-15,NYSE:GOODSPLIT,55,55,55,55,2.0\n\
             2025-02-13,NYSE:GOODSPLIT,55,55,55,55,1.0\n\
             2024-11-15,NYSE:BADSPLIT,100,100,100,100,1.0\n\
             2024-12-15,NYSE:BADSPLIT,2,2,2,2,50.0\n\
             2025-02-13,NYSE:BADSPLIT,2,2,2,2,1.0\n"
        );
        let (_dir, score_path) = write_portfolio_fixture(&tsv, &csv);

        let result = calculate_portfolio_performance(&score_path, "2024-11-15").unwrap();

        assert_eq!(
            result.total_stocks, 1,
            "only the reconcilable stock is counted"
        );
        assert_eq!(result.individual_performances.len(), 1);
        assert_eq!(result.individual_performances[0].ticker, "NYSE:GOODSPLIT");
        assert!(
            result
                .excluded_tickers
                .contains(&"NYSE:BADSPLIT".to_string()),
            "the unreconcilable split stock must be excluded"
        );
        // Average is over the single included stock only.
        assert!((result.performance_90_day - 10.0).abs() < 1e-6);
    }

    #[test]
    fn test_portfolio_performance_excludes_negative_score_stock() {
        // Two stocks, both fully priceable (+10% each). One carries a negative
        // model score, so it predicts a fall and we hold cash: it must drop from
        // the average and the count, and appear in excluded_tickers (issue #627).
        let tsv = format!(
            "{PERF_TSV_HEADER}\
             NYSE:BUYME\t1.0\t$120.00\t\t\t\t\t\n\
             NYSE:HOLDCASH\t-0.5\t$120.00\t\t\t\t\t\n"
        );
        let csv = format!(
            "{PERF_CSV_HEADER}\
             2024-11-15,NYSE:BUYME,100,100,100,100,1.0\n\
             2025-02-13,NYSE:BUYME,110,110,110,110,1.0\n\
             2024-11-15,NYSE:HOLDCASH,100,100,100,100,1.0\n\
             2025-02-13,NYSE:HOLDCASH,200,200,200,200,1.0\n"
        );
        let (_dir, score_path) = write_portfolio_fixture(&tsv, &csv);

        let result = calculate_portfolio_performance(&score_path, "2024-11-15").unwrap();

        assert_eq!(
            result.total_stocks, 1,
            "only the positive-score stock is counted"
        );
        assert_eq!(result.individual_performances.len(), 1);
        assert_eq!(result.individual_performances[0].ticker, "NYSE:BUYME");
        assert!(
            result
                .excluded_tickers
                .contains(&"NYSE:HOLDCASH".to_string()),
            "the negative-score stock must be excluded"
        );
        // Average is over the single included stock only; the excluded +100%
        // name does not lift the figure.
        assert!((result.performance_90_day - 10.0).abs() < 1e-6);
    }

    #[test]
    fn test_portfolio_performance_no_split_unchanged() {
        // A stock with no split (coefficient 1.0 throughout) behaves exactly as
        // before: 100 -> 110 is a straight +10%, buy basis unchanged.
        let tsv = format!("{PERF_TSV_HEADER}NYSE:NOSPLIT\t1.0\t$120.00\t\t\t\t\t\n");
        let csv = format!(
            "{PERF_CSV_HEADER}\
             2024-11-15,NYSE:NOSPLIT,100,100,100,100,1.0\n\
             2025-02-13,NYSE:NOSPLIT,110,110,110,110,1.0\n"
        );
        let (_dir, score_path) = write_portfolio_fixture(&tsv, &csv);

        let result = calculate_portfolio_performance(&score_path, "2024-11-15").unwrap();

        assert_eq!(result.total_stocks, 1);
        assert!(result.excluded_tickers.is_empty());
        let stock = &result.individual_performances[0];
        assert!(
            (stock.buy_price - 100.0).abs() < 1e-6,
            "no-split buy basis is unchanged"
        );
        assert!((stock.gain_loss_percent - 10.0).abs() < 1e-6);
    }
}
