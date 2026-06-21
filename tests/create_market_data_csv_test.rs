//! Behaviour tests for `create_market_data_csv` and its wrapper
//! `create_market_data_csv_for_score_file` (issue #265).
//!
//! These were previously the only market-data writers with no test exercising
//! them, directly or indirectly. Rather than depend on the external
//! `MARKET_DATA_BASE_PATH` data repository (which is absent in CI and makes the
//! sibling long-format test skip), each test drops a small, fully controlled
//! market-data fixture at the location the function reads from, asserts the
//! observable CSV output, then removes the fixture again. The assertions pin
//! the public contract — the `date,symbol,close` header and the inclusive
//! 180-day window filter — without caring how the function computes them.

use anyhow::Result;
use grq_validation::utils::{
    create_market_data_csv, create_market_data_csv_for_score_file, MARKET_DATA_BASE_PATH,
};
use std::path::{Path, PathBuf};

/// Clearly-synthetic symbols so a fixture can never collide with a real symbol
/// in an existing `MARKET_DATA_BASE_PATH` data repository. Each test uses a
/// distinct symbol so the fixtures live at distinct paths and never race when
/// the test harness runs them in parallel (one test's `Drop` must not delete a
/// fixture another test is still reading).
const FIXTURE_SYMBOL_DIRECT: &str = "GRQVTEST265A";
const FIXTURE_SYMBOL_WRAPPER: &str = "GRQVTEST265B";

/// Score-file date used by every test; the 180-day window therefore runs from
/// `2025-04-15` to `2025-10-12` inclusive.
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

        // Track the outermost component we create so cleanup removes no more
        // than the test added.
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
/// rows: before, inside, and after the 180-day window from [`SCORE_DATE`].
fn fixture_json(symbol: &str) -> String {
    fn daily(close: &str) -> serde_json::Value {
        serde_json::json!({
            "1. open": close,
            "2. high": close,
            "3. low": close,
            "4. close": close,
            "5. adjusted close": close,
            "6. volume": "1000",
            "7. dividend amount": "0.0",
            "8. split coefficient": "1.0",
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
            "2024-01-01": daily("11.11"), // before the window -> excluded
            "2025-04-15": daily("100.5"), // window start (inclusive) -> included
            "2025-12-01": daily("99.99"), // after the window -> excluded
        },
    })
    .to_string()
}

#[test]
fn create_market_data_csv_writes_windowed_rows() -> Result<()> {
    let _fixture = MarketDataFixture::install(FIXTURE_SYMBOL_DIRECT)?;

    let out_dir = tempfile::tempdir()?;
    let out_path = out_dir.path().join("md.csv");
    let out = out_path.to_str().expect("temp path is valid UTF-8");

    create_market_data_csv(&[FIXTURE_SYMBOL_DIRECT.to_string()], SCORE_DATE, out)?;

    let csv = std::fs::read_to_string(&out_path)?;

    // Header contract.
    assert_eq!(
        csv.lines().next().unwrap(),
        "date,symbol,close",
        "unexpected CSV header in:\n{csv}"
    );

    // In-window row present with its close price.
    assert!(
        csv.contains(&format!("2025-04-15,{FIXTURE_SYMBOL_DIRECT},100.5")),
        "expected the window-start row in:\n{csv}"
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
fn create_market_data_csv_for_score_file_writes_derived_csv() -> Result<()> {
    let _fixture = MarketDataFixture::install(FIXTURE_SYMBOL_WRAPPER)?;

    // The wrapper derives the output path by swapping the score file's
    // extension to `.csv` in the same directory.
    let dir = tempfile::tempdir()?;
    let score_file = dir.path().join("scores.tsv");
    std::fs::write(&score_file, "stock\n")?; // contents are irrelevant here
    let score_file_str = score_file.to_str().expect("temp path is valid UTF-8");

    create_market_data_csv_for_score_file(
        score_file_str,
        &[FIXTURE_SYMBOL_WRAPPER.to_string()],
        SCORE_DATE,
    )?;

    let derived = dir.path().join("scores.csv");
    assert!(
        derived.exists(),
        "wrapper should write the derived CSV at {derived:?}"
    );

    let csv = std::fs::read_to_string(&derived)?;
    assert_eq!(csv.lines().next().unwrap(), "date,symbol,close");
    assert!(csv.contains(&format!("2025-04-15,{FIXTURE_SYMBOL_WRAPPER},100.5")));

    Ok(())
}
