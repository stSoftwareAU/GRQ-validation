//! Synthetic fixture builders shared by the Rust integration tests (issue #804).
//!
//! Every fixture is written under a caller-supplied root — in practice a
//! `tempfile::tempdir()` owned by the test — and every value is hand-written
//! here, so no test reads or writes the operator's live market-data or
//! dividend tree and none of them can skip for want of one.
//!
//! Paths are built through the crate's own `get_market_data_path_in` /
//! `get_dividend_data_path_in` cores, so a fixture always lands exactly where
//! the code under test looks for it.

// Each integration test uses only the builders it needs; the module is shared,
// so unused-in-this-binary helpers are expected rather than dead code.
#![allow(dead_code)]

use anyhow::Result;
use grq_validation::utils::{get_dividend_data_path_in, get_market_data_path_in};
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};

/// TSV header of a daily score file, matching `StockRecord` in `src/models.rs`.
const SCORE_FILE_HEADER: &str = "Stock\tScore\tTarget\tExDividendDate\tDividendPerShare\tNotes\tintrinsicValuePerShareBasic\tintrinsicValuePerShareAdjusted";

/// One synthetic daily price point, in the fields the long-format writer maps
/// onto its eight CSV columns.
pub struct PricePoint<'a> {
    pub date: &'a str,
    pub open: &'a str,
    pub high: &'a str,
    pub low: &'a str,
    pub close: &'a str,
    pub volume: &'a str,
    pub split: &'a str,
}

impl<'a> PricePoint<'a> {
    /// A point whose open/high/low/close all equal `close` — enough for the
    /// short-format writer, which reads only the close.
    pub fn flat(date: &'a str, close: &'a str) -> Self {
        Self {
            date,
            open: close,
            high: close,
            low: close,
            close,
            volume: "1000",
            split: "1.0",
        }
    }

    /// A point with a distinct value per column, so a test can prove each
    /// long-format column is mapped to the right field.
    pub fn detailed(
        date: &'a str,
        open: &'a str,
        high: &'a str,
        low: &'a str,
        close: &'a str,
        volume: &'a str,
    ) -> Self {
        Self {
            date,
            open,
            high,
            low,
            close,
            volume,
            split: "1.0",
        }
    }

    fn to_json(&self) -> Value {
        json!({
            "1. open": self.open,
            "2. high": self.high,
            "3. low": self.low,
            "4. close": self.close,
            "5. adjusted close": self.close,
            "6. volume": self.volume,
            "7. dividend amount": "0.0",
            "8. split coefficient": self.split,
        })
    }
}

/// Writes an Alpha Vantage-shaped market-data document for `symbol` at
/// `<root>/data/<LETTER>/<SYMBOL>.json` and returns that path.
///
/// # Errors
///
/// Returns an error if the path cannot be built (see `get_market_data_path_in`)
/// or the fixture cannot be written.
pub fn write_market_data(root: &Path, symbol: &str, points: &[PricePoint]) -> Result<PathBuf> {
    let series: Map<String, Value> = points
        .iter()
        .map(|point| (point.date.to_string(), point.to_json()))
        .collect();

    let document = json!({
        "Meta Data": {
            "1. Information": "Daily Prices (synthetic fixture)",
            "2. Symbol": symbol,
            "3. Last Refreshed": points.last().map_or("1970-01-01", |point| point.date),
            "4. Output Size": "Full size",
            "5. Time Zone": "US/Eastern",
        },
        "Time Series (Daily)": series,
    });

    write_json(&get_market_data_path_in(root, symbol)?, &document)
}

/// Writes a `DividendData`-shaped document for `symbol` at
/// `<root>/data/<LETTER>/<SYMBOL>.json` and returns that path. Each event is an
/// `(ex-dividend date, amount)` pair.
///
/// # Errors
///
/// Returns an error if the path cannot be built (see
/// `get_dividend_data_path_in`) or the fixture cannot be written.
pub fn write_dividend_data(root: &Path, symbol: &str, events: &[(&str, &str)]) -> Result<PathBuf> {
    let data: Vec<Value> = events
        .iter()
        .map(|(ex_dividend_date, amount)| {
            json!({
                "ex_dividend_date": ex_dividend_date,
                "declaration_date": Value::Null,
                "record_date": Value::Null,
                "payment_date": Value::Null,
                "amount": amount,
            })
        })
        .collect();

    let document = json!({ "symbol": symbol, "data": data });

    write_json(&get_dividend_data_path_in(root, symbol)?, &document)
}

/// Writes a minimal score TSV listing `tickers` at `path` and returns it, so a
/// test can exercise the score-file readers without touching `docs/`.
///
/// # Errors
///
/// Returns an error if the file cannot be written.
pub fn write_score_file(path: &Path, tickers: &[&str]) -> Result<PathBuf> {
    let mut tsv = String::from(SCORE_FILE_HEADER);
    for (index, ticker) in tickers.iter().enumerate() {
        // Scores descend from 0.9 so every row is distinct and priceable.
        let score = 0.9 - (index as f64) * 0.1;
        tsv.push_str(&format!("\n{ticker}\t{score}\t10.00\t\t\t\t9.00\t9.50"));
    }
    tsv.push('\n');

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, tsv)?;

    Ok(path.to_path_buf())
}

/// Writes `document` to `path`, creating the bucket directories beneath the
/// fixture root as needed.
fn write_json(path: &str, document: &Value) -> Result<PathBuf> {
    let path = PathBuf::from(path);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&path, document.to_string())?;

    Ok(path)
}
