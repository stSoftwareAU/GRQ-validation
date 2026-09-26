//! Dividend history: resolving a ticker's dividend file inside the
//! caller-supplied dividend root, reading and filtering it, summing a period's
//! dividends, and writing the per-score dividend CSVs.

use crate::market_data::parse_financial_value;
use crate::models::DividendData;
use crate::utils::extract_symbol_from_ticker;
use anyhow::{anyhow, Result};
use chrono::{Duration, NaiveDate};
use std::path::Path;

/// Gets the dividend data path for a given ticker under the caller-supplied
/// `root` (issue #803: the root is threaded in, never resolved here).
///
/// For example: `"SEM"` -> `<dividend-root>/data/S/SEM.json`.
///
/// The `ticker` field of a score TSV is attacker-influenceable (a contributor,
/// a compromised upstream data step, or a malicious pull request against the
/// data set), exactly like the `file` field guarded by [`build_score_file_path`](crate::index::build_score_file_path).
/// To stop a crafted ticker such as `"X/../../../../../../etc/some"` escaping
/// the intended `<dividend-root>/data/` tree, the path is built with
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
pub fn get_dividend_data_path_in(root: &Path, ticker: &str) -> Result<String> {
    use std::path::Component;

    let first_letter = ticker
        .chars()
        .next()
        .unwrap_or('X')
        .to_uppercase()
        .to_string();

    // Build within the dividend-data root via join rather than string
    // concatenation, keeping only normal segments.
    let mut full_path = root.join("data").join(&first_letter);

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

/// Reads dividend data for a given ticker under the caller-supplied
/// `dividend_root` (issue #803: the root is threaded in, never resolved per
/// call).
///
/// # Errors
///
/// Returns an error if the dividend file cannot be opened or does not contain
/// valid JSON matching [`DividendData`].
pub fn read_dividend_data(dividend_root: &Path, ticker: &str) -> Result<DividendData> {
    use std::fs::File;

    let dividend_data_path = get_dividend_data_path_in(dividend_root, ticker)?;
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
    dividend_root: &Path,
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

        match read_dividend_data(dividend_root, &symbol_only) {
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
    dividend_root: &Path,
    score_file_path: &str,
    symbols: &[String],
    score_file_date: &str,
) -> Result<()> {
    let output_path = derive_dividend_csv_output_path(score_file_path);
    create_dividend_csv(dividend_root, symbols, score_file_date, &output_path)
}

/// Calculates total dividends for a stock in a given date range, reading the
/// dividend history from the caller-supplied `dividend_root`.
pub(crate) fn calculate_dividends_for_period(
    dividend_root: &Path,
    symbol: &str,
    start_date: &str,
    end_date: &str,
) -> Result<f64> {
    match read_dividend_data(dividend_root, symbol) {
        Ok(dividend_data) => {
            let filtered_data =
                filter_dividend_data_by_date_range(&dividend_data, start_date, end_date)?;

            let total_dividends: f64 = filtered_data.iter().map(|(_, amount)| amount).sum();

            Ok(total_dividends)
        }
        Err(_) => Ok(0.0), // Return 0 if no dividend data available
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data_roots::test_fixtures::absent_data_root;

    #[test]
    fn test_get_dividend_data_path() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        assert_eq!(
            get_dividend_data_path_in(root, "SEM").unwrap(),
            root.join("data/S/SEM.json").to_string_lossy()
        );
        assert_eq!(
            get_dividend_data_path_in(root, "AAPL").unwrap(),
            root.join("data/A/AAPL.json").to_string_lossy()
        );
        assert_eq!(
            get_dividend_data_path_in(root, "").unwrap(),
            root.join("data/X/.json").to_string_lossy()
        );
    }

    // Regression tests for issue #182: a `..` or absolute segment in an
    // attacker-influenceable ticker must not escape the dividend data root.
    #[test]
    fn test_get_dividend_data_path_rejects_parent_dir_traversal() {
        let dir = tempfile::tempdir().unwrap();
        let result = get_dividend_data_path_in(dir.path(), "X/../../../../../../etc/some");
        assert!(
            result.is_err(),
            "expected a ticker containing `..` to be rejected, got {result:?}"
        );
    }

    #[test]
    fn test_get_dividend_data_path_rejects_absolute_ticker() {
        let dir = tempfile::tempdir().unwrap();
        let result = get_dividend_data_path_in(dir.path(), "/etc/passwd");
        assert!(
            result.is_err(),
            "expected an absolute ticker to be rejected, got {result:?}"
        );
    }

    #[test]
    fn test_get_dividend_data_path_allows_plain_ticker_with_exchange_prefix() {
        // A legitimate ticker with an exchange prefix contains no path
        // separators or traversal segments and must still resolve.
        let dir = tempfile::tempdir().unwrap();
        let path = get_dividend_data_path_in(dir.path(), "NYSE:SEM").unwrap();
        assert_eq!(
            path,
            dir.path().join("data/N/NYSE:SEM.json").to_string_lossy()
        );
    }

    #[test]
    fn test_read_dividend_data_rejects_traversal_ticker() {
        // The read must fail at the path-validation stage rather than opening an
        // out-of-tree file. We assert it errors for a traversal ticker.
        let result = read_dividend_data(absent_data_root(), "X/../../../../../../etc/some");
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
            absent_data_root(),
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
}
