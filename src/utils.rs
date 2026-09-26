//! Score-file helpers: reading prediction TSVs, extracting their tickers, and
//! pairing prediction files with their market-data CSVs.
//!
//! The other concerns that used to live here each have their own module (issue
//! #882); they are re-exported below so existing `utils::` call sites keep
//! compiling.

pub use crate::data_roots::{
    dividend_data_root, ensure_market_data_repository_at, market_data_root, DIVIDEND_DATA_ROOT_ENV,
    MARKET_DATA_ROOT_ENV,
};
pub use crate::dividends::*;
pub use crate::index::*;
pub use crate::market_data::*;
pub use crate::performance::*;
pub use crate::splits::*;

use crate::models::StockRecord;
use anyhow::{anyhow, Result};
use std::path::Path;

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

/// Returns `true` when `path` names a day-numbered prediction TSV such as
/// `07.tsv` or `7.tsv`. Sibling helper files (`07-analysis.csv`,
/// `07-dividends.csv`) and any other TSV are not prediction files.
fn is_prediction_score_file(path: &Path) -> bool {
    if path.extension().and_then(|ext| ext.to_str()) != Some("tsv") {
        return false;
    }
    match path.file_stem().and_then(|stem| stem.to_str()) {
        Some(stem) => {
            (1..=2).contains(&stem.len())
                && stem.chars().all(|character| character.is_ascii_digit())
        }
        None => false,
    }
}

/// Recursively collects prediction TSVs beneath `dir` into `found`.
fn collect_prediction_score_files_into(dir: &Path, found: &mut Vec<String>) -> Result<()> {
    let entries = std::fs::read_dir(dir)
        .map_err(|error| anyhow!("Failed to read score directory {}: {error}", dir.display()))?;

    for entry in entries {
        let path = entry
            .map_err(|error| anyhow!("Failed to read entry in {}: {error}", dir.display()))?
            .path();
        if path.is_dir() {
            collect_prediction_score_files_into(&path, found)?;
        } else if is_prediction_score_file(&path) {
            found.push(path.to_string_lossy().into_owned());
        }
    }

    Ok(())
}

/// Collects every day-numbered prediction TSV under `<docs_path>/scores`, e.g.
/// `docs/scores/2026/July/19.tsv`. The result is sorted so reports are stable.
///
/// This mirrors the rule the CI data-presence gate and the promotion guard
/// (`scripts/check_score_data_pairing.ts`) already apply, so all three agree on
/// what counts as a committed prediction date.
///
/// # Errors
///
/// Returns an error if `<docs_path>/scores`, or any directory beneath it,
/// cannot be read — an unreadable tree is a fault, never an empty result.
pub fn collect_prediction_score_files(docs_path: &str) -> Result<Vec<String>> {
    let scores_dir = Path::new(docs_path).join("scores");
    let mut found = Vec::new();
    collect_prediction_score_files_into(&scores_dir, &mut found)?;
    found.sort();
    Ok(found)
}

/// Returns every committed prediction date left without usable market data: a
/// day-numbered score TSV whose sibling market-data CSV is missing or holds
/// nothing beyond the header row. Each entry reads `<path> (missing)` or
/// `<path> (header-only/empty)` so an operator can act on the report directly.
///
/// A processor run that leaves any of these behind has half-succeeded — the
/// tree it produced fails the CI data-presence gate — so the caller must treat
/// a non-empty result as a fault rather than logging it and exiting zero
/// (issue #833).
///
/// # Errors
///
/// Returns an error if the score tree cannot be read, or if it holds no
/// prediction files at all: an empty tree is a fault, never a vacuous pass.
pub fn find_unpaired_prediction_dates(docs_path: &str) -> Result<Vec<String>> {
    let score_files = collect_prediction_score_files(docs_path)?;
    if score_files.is_empty() {
        return Err(anyhow!(
            "No prediction files found under {docs_path}/scores — \
             refusing to report a vacuous pass"
        ));
    }

    Ok(score_files
        .iter()
        .map(|score_file| derive_csv_output_path(score_file))
        .filter(|csv_path| is_market_data_csv_empty(csv_path))
        .map(|csv_path| {
            let reason = if Path::new(&csv_path).exists() {
                "header-only/empty"
            } else {
                "missing"
            };
            format!("{csv_path} ({reason})")
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
