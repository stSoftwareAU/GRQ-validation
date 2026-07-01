//! Behaviour tests for `create_market_data_long_csv` (issue #634).
//!
//! The long-format market-data writer previously had no unconditional test:
//! its only test-adjacent reference (`create_market_data_long_csv_for_score_file`
//! in `tests/market_data_tests.rs`) early-returns unless an external
//! `MARKET_DATA_BASE_PATH` repository exists, so on CI and most machines it
//! never runs. These tests drop a small, fully controlled market-data fixture
//! at the location the function reads from and assert the observable contract —
//! the 8-column `date,ticker,high,low,open,close,split_coefficient,volume`
//! output and the "no rows written → error" guard — without caring how the
//! writer is implemented. They mirror `tests/create_market_data_csv_test.rs`.

use anyhow::Result;
use grq_validation::utils::{create_market_data_long_csv, MARKET_DATA_BASE_PATH};
use std::path::{Path, PathBuf};

/// Clearly-synthetic symbol so a fixture can never collide with a real symbol
/// in an existing `MARKET_DATA_BASE_PATH` data repository.
const FIXTURE_SYMBOL: &str = "GRQVTEST634A";

/// Full ticker code as it appears in a scores file. The long writer keeps the
/// whole code (exchange prefix included) in the `ticker` column.
const FIXTURE_TICKER: &str = "NYSE:GRQVTEST634A";

/// Score-file date used by the happy-path test; the 180-day window therefore
/// runs from `2025-04-15` to `2025-10-12` inclusive.
const SCORE_DATE: &str = "2025-04-15";

/// RAII guard that installs a market-data fixture for a given symbol under
/// `MARKET_DATA_BASE_PATH` and removes exactly what it created on drop, so the
/// test leaves no trace whether or not the external data repository pre-exists.
struct MarketDataFixture {
    json_path: PathBuf,
    /// The outermost directory this guard created (and must remove on drop), or
    /// `None` when the whole tree already existed.
    created_root: Option<PathBuf>,
}

impl MarketDataFixture {
    /// Writes a fixture for `symbol` whose daily series contains one row inside
    /// the 180-day window, one row before it, and one row after it, so a test
    /// can assert both inclusion and exclusion.
    fn install(symbol: &str) -> Result<Self> {
        let base = Path::new(MARKET_DATA_BASE_PATH);
        let first_letter = symbol.chars().next().unwrap().to_string();
        let symbol_dir = base.join("data").join(&first_letter);

        let created_root = first_missing_ancestor(&symbol_dir);
        std::fs::create_dir_all(&symbol_dir)?;

        let json_path = symbol_dir.join(format!("{symbol}.json"));
        std::fs::write(&json_path, fixture_json(symbol))?;

        Ok(Self {
            json_path,
            created_root,
        })
    }
}

impl Drop for MarketDataFixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.json_path);

        // Prune the directories we created, bottom-up, removing each only when
        // it is empty. `remove_dir` (not `remove_dir_all`) means a directory
        // shared with a concurrently-running test's fixture is left intact
        // until that test has cleaned up too, so cleanup never races.
        if let Some(root) = &self.created_root {
            let mut dir = self.json_path.parent().map(Path::to_path_buf);
            while let Some(current) = dir {
                if std::fs::remove_dir(&current).is_err() {
                    break; // non-empty (another fixture present) or already gone
                }
                if current == *root {
                    break;
                }
                dir = current.parent().map(Path::to_path_buf);
            }
        }
    }
}

/// Returns the shallowest ancestor of `dir` (including `dir` itself) that does
/// not yet exist, i.e. the outermost directory `create_dir_all` would create.
/// Returns `None` when `dir` already exists.
fn first_missing_ancestor(dir: &Path) -> Option<PathBuf> {
    if dir.exists() {
        return None;
    }
    let mut candidate = dir.to_path_buf();
    while let Some(parent) = candidate.parent() {
        if parent.exists() {
            return Some(candidate);
        }
        candidate = parent.to_path_buf();
    }
    Some(candidate)
}

/// Builds an Alpha Vantage-shaped market-data JSON document with three dated
/// rows: before, inside, and after the 180-day window from [`SCORE_DATE`]. The
/// in-window row uses distinct open/high/low/close/volume/split values so a
/// test can verify each long-format column is mapped to the right field.
fn fixture_json(symbol: &str) -> String {
    fn daily(
        open: &str,
        high: &str,
        low: &str,
        close: &str,
        volume: &str,
        split: &str,
    ) -> serde_json::Value {
        serde_json::json!({
            "1. open": open,
            "2. high": high,
            "3. low": low,
            "4. close": close,
            "5. adjusted close": close,
            "6. volume": volume,
            "7. dividend amount": "0.0",
            "8. split coefficient": split,
        })
    }

    serde_json::json!({
        "Meta Data": {
            "1. Information": "Daily Prices (fixture)",
            "2. Symbol": symbol,
            "3. Last Refreshed": "2025-10-12",
            "4. Output Size": "Full size",
            "5. Time Zone": "US/Eastern",
        },
        "Time Series (Daily)": {
            // before the window -> excluded
            "2024-01-01": daily("1.0", "1.0", "1.0", "1.0", "10", "1.0"),
            // window start (inclusive) -> included, with distinct columns
            "2025-04-15": daily("100.5", "105.25", "98.75", "102.0", "123456", "1.0"),
            // after the window -> excluded
            "2025-12-01": daily("9.0", "9.0", "9.0", "9.0", "20", "1.0"),
        },
    })
    .to_string()
}

#[test]
fn create_market_data_long_csv_writes_eight_column_rows() -> Result<()> {
    let _fixture = MarketDataFixture::install(FIXTURE_SYMBOL)?;

    let out_dir = tempfile::tempdir()?;
    let out_path = out_dir.path().join("long.csv");
    let out = out_path.to_str().expect("temp path is valid UTF-8");

    create_market_data_long_csv(&[FIXTURE_TICKER.to_string()], SCORE_DATE, out)?;

    let csv = std::fs::read_to_string(&out_path)?;

    // 8-column header contract.
    assert_eq!(
        csv.lines().next().unwrap(),
        "date,ticker,high,low,open,close,split_coefficient,volume",
        "unexpected long-format CSV header in:\n{csv}"
    );

    // In-window row present with each column mapped to its field. The ticker
    // column keeps the full code (exchange prefix included).
    assert!(
        csv.contains(&format!(
            "2025-04-15,{FIXTURE_TICKER},105.25,98.75,100.5,102.0,1.0,123456"
        )),
        "expected the fully-mapped window-start row in:\n{csv}"
    );

    // Out-of-window rows excluded (both before and after the 180-day window).
    assert!(
        !csv.contains("2024-01-01"),
        "row before the window must be excluded in:\n{csv}"
    );
    assert!(
        !csv.contains("2025-12-01"),
        "row after the window must be excluded in:\n{csv}"
    );

    Ok(())
}

#[test]
fn create_market_data_long_csv_errors_when_all_tickers_skipped() -> Result<()> {
    // No fixture installed: the symbol has no market-data file, so the only
    // ticker is skipped and no data rows are written. The documented guard at
    // `src/utils.rs` must turn this into an error rather than a silent
    // header-only CSV. A synthetic symbol guarantees no real data file exists.
    let out_dir = tempfile::tempdir()?;
    let out_path = out_dir.path().join("empty.csv");
    let out = out_path.to_str().expect("temp path is valid UTF-8");

    let result =
        create_market_data_long_csv(&["NYSE:GRQVTEST634MISSING".to_string()], SCORE_DATE, out);

    assert!(
        result.is_err(),
        "expected an error when every ticker is skipped and no rows are written"
    );

    Ok(())
}

#[test]
fn create_market_data_long_csv_preserves_existing_rows_when_no_fresh_data() -> Result<()> {
    // Regression for issue #687 (recurrences #672/#674/#685): when the upstream
    // share-price data is unavailable for a date, the writer must NOT clobber an
    // already-populated CSV with a bare header row. The external scorer pipeline
    // runs this generator and commits its output straight to `main`, so a
    // destructive truncation here wipes the dashboard's market data and forces
    // "Limited data mode".
    let out_dir = tempfile::tempdir()?;
    let out_path = out_dir.path().join("populated.csv");
    let out = out_path.to_str().expect("temp path is valid UTF-8");

    // A pre-existing, populated market-data CSV (as produced by an earlier run).
    let existing = "date,ticker,high,low,open,close,split_coefficient,volume\n\
        2026-04-02,NYSE:GRQVTEST687,10.0,9.0,9.5,9.8,1.0,1000\n";
    std::fs::write(&out_path, existing)?;

    // No fixture installed -> the only ticker is skipped -> zero rows written.
    let result =
        create_market_data_long_csv(&["NYSE:GRQVTEST687MISSING".to_string()], SCORE_DATE, out);

    // The writer still signals that no fresh data was available...
    assert!(
        result.is_err(),
        "expected an error when no fresh rows are written and data is unavailable"
    );

    // ...but the existing populated CSV must be left completely untouched.
    let after = std::fs::read_to_string(&out_path)?;
    assert_eq!(
        after, existing,
        "existing market-data rows must be preserved when no fresh data is available"
    );

    // No stray temporary file must be left behind next to the destination.
    assert!(
        !Path::new(&format!("{out}.tmp")).exists(),
        "the atomic-write temp file must not linger after a preserve"
    );

    Ok(())
}

#[test]
fn create_market_data_long_csv_replaces_existing_when_fresh_data_available() -> Result<()> {
    // Complement to the preservation test: when fresh data IS available, the
    // destination is replaced atomically with the new content — no stale rows
    // and no leftover temp file (issue #687).
    let _fixture = MarketDataFixture::install(FIXTURE_SYMBOL)?;

    let out_dir = tempfile::tempdir()?;
    let out_path = out_dir.path().join("replace.csv");
    let out = out_path.to_str().expect("temp path is valid UTF-8");

    // Stale content that must be fully replaced by the fresh write.
    std::fs::write(&out_path, "stale,garbage\n1,2\n")?;

    create_market_data_long_csv(&[FIXTURE_TICKER.to_string()], SCORE_DATE, out)?;

    let csv = std::fs::read_to_string(&out_path)?;
    assert_eq!(
        csv.lines().next().unwrap(),
        "date,ticker,high,low,open,close,split_coefficient,volume",
        "unexpected header after replacement in:\n{csv}"
    );
    assert!(
        csv.contains(&format!("2025-04-15,{FIXTURE_TICKER}")),
        "expected the fresh window-start row after replacement in:\n{csv}"
    );
    assert!(
        !csv.contains("stale,garbage"),
        "stale content must be fully replaced in:\n{csv}"
    );
    assert!(
        !Path::new(&format!("{out}.tmp")).exists(),
        "the atomic-write temp file must not linger after a successful write"
    );

    Ok(())
}
