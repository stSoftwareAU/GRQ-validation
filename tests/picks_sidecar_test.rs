//! Behaviour tests for the per-score-date pick-details sidecar (issue #838,
//! sub-issue of #835).
//!
//! Each test builds a small, fully controlled market-data fixture inside its
//! own `tempfile::tempdir()` root and asserts the observable contract — the
//! six-column `ticker,week52_low,week52_high,close_score_date,close_5d_prior,
//! adv_dollar_10d` output, the blank-never-zero rule for values that cannot be
//! computed, and the non-destructive write posture — without caring how the
//! writer is implemented. They mirror
//! `tests/create_market_data_long_csv_test.rs`.
//!
//! The fixtures are synthetic and hermetic (issue #804): every read and write
//! stays inside the test's temporary directory, so the tests run identically on
//! CI and on a maintainer's machine and never touch a configured data root. The
//! one committed input is `tests/fixtures/adv_dollar_10d_parity.json`, the
//! shared window the Rust and JavaScript dollar-ADV definitions are pinned to.

mod common;

use anyhow::{anyhow, Result};
use chrono::{Datelike, Duration, NaiveDate};
use common::{write_market_data, PricePoint};
use grq_validation::picks_sidecar::{create_picks_sidecar_csv, derive_picks_csv_output_path};
use serde_json::Value;
use std::path::Path;

/// The header every sidecar must carry — the raw inputs only, no thresholds.
const HEADER: &str = "ticker,week52_low,week52_high,close_score_date,close_5d_prior,adv_dollar_10d";

/// Score date shared by the history fixtures: a Monday, so "five trading rows
/// back" lands on the previous Monday rather than five calendar days earlier.
const SCORE_DATE: &str = "2026-03-16";

/// One synthetic daily row, owned so a whole year of them can be generated.
struct OwnedPoint {
    date: String,
    open: String,
    high: String,
    low: String,
    close: String,
    volume: String,
}

impl OwnedPoint {
    fn new(date: NaiveDate) -> Self {
        Self {
            date: date.format("%Y-%m-%d").to_string(),
            open: "45.00".to_string(),
            high: "50.00".to_string(),
            low: "40.00".to_string(),
            close: "45.50".to_string(),
            volume: "1000".to_string(),
        }
    }
}

/// Borrows the owned rows as the `PricePoint`s the fixture writer takes.
fn as_points(owned: &[OwnedPoint]) -> Vec<PricePoint<'_>> {
    owned
        .iter()
        .map(|point| {
            PricePoint::detailed(
                &point.date,
                &point.open,
                &point.high,
                &point.low,
                &point.close,
                &point.volume,
            )
        })
        .collect()
}

/// Every weekday in `days_back .. score_date` inclusive, oldest first.
fn weekday_rows(score_date: NaiveDate, days_back: i64) -> Vec<OwnedPoint> {
    let mut rows = Vec::new();
    let mut date = score_date - Duration::days(days_back);
    while date <= score_date {
        if date.weekday().num_days_from_monday() < 5 {
            rows.push(OwnedPoint::new(date));
        }
        date += Duration::days(1);
    }
    rows
}

/// Index of the row dated `date`, so a fixture override reads by date rather
/// than by a brittle offset.
fn index_of(rows: &[OwnedPoint], date: &str) -> usize {
    rows.iter()
        .position(|row| row.date == date)
        .unwrap_or_else(|| panic!("fixture is missing a row for {date}"))
}

/// Reads the sidecar and returns the single data row's six fields.
fn read_row(path: &Path, ticker: &str) -> Result<Vec<String>> {
    let csv = std::fs::read_to_string(path)?;
    assert_eq!(
        csv.lines().next().unwrap_or_default(),
        HEADER,
        "unexpected sidecar header in:\n{csv}"
    );
    let row = csv
        .lines()
        .skip(1)
        .find(|line| line.starts_with(&format!("{ticker},")))
        .ok_or_else(|| anyhow!("no row for {ticker} in:\n{csv}"))?;
    Ok(row.split(',').map(str::to_string).collect())
}

#[test]
fn derive_picks_csv_output_path_names_the_sidecar_beside_the_score_file() {
    assert_eq!(
        derive_picks_csv_output_path("docs/scores/2026/July/19.tsv"),
        "docs/scores/2026/July/19-picks.csv"
    );
}

#[test]
fn picks_sidecar_reports_52_week_range_and_five_trading_rows_back() -> Result<()> {
    let symbol = "GRQVTEST838FULL";
    let ticker = "NYSE:GRQVTEST838FULL";
    let score_date = NaiveDate::parse_from_str(SCORE_DATE, "%Y-%m-%d")?;

    // A little over a year of weekday history, so the writer has to drop the
    // rows that fall outside the 365-day look-back.
    let mut rows = weekday_rows(score_date, 400);

    // Extremes OUTSIDE the 52-week window: both must be ignored.
    let outside = index_of(&rows, "2025-02-10");
    rows[outside].high = "999.00".to_string();
    rows[outside].low = "1.00".to_string();

    // Extremes INSIDE the window: these are the answers.
    let high_row = index_of(&rows, "2025-08-15");
    rows[high_row].high = "150.00".to_string();
    let low_row = index_of(&rows, "2025-12-05");
    rows[low_row].low = "5.00".to_string();

    // Distinct closes over the final six trading rows, so the score-date close
    // and the five-trading-rows-back close are individually identifiable. The
    // final six weekdays are 2026-03-09 (Mon) .. 2026-03-16 (Mon), spanning a
    // weekend.
    for (offset, close) in ["61.00", "62.00", "63.00", "64.00", "65.00", "66.00"]
        .iter()
        .enumerate()
    {
        let index = rows.len() - 6 + offset;
        rows[index].close = (*close).to_string();
    }

    let root = tempfile::tempdir()?;
    write_market_data(root.path(), symbol, &as_points(&rows))?;

    let out_dir = tempfile::tempdir()?;
    let out_path = out_dir.path().join("16-picks.csv");
    let out = out_path.to_str().expect("temp path is valid UTF-8");

    create_picks_sidecar_csv(root.path(), &[ticker.to_string()], SCORE_DATE, out)?;

    let fields = read_row(&out_path, ticker)?;
    assert_eq!(fields[1], "5.00", "52-week low over the in-window rows");
    assert_eq!(fields[2], "150.00", "52-week high over the in-window rows");
    assert_eq!(fields[3], "66.00", "close on the score date");
    assert_eq!(
        fields[4], "61.00",
        "close_5d_prior must be five TRADING rows back (2026-03-09), \
         not five calendar days back (2026-03-11, close 64.00)"
    );
    assert_ne!(
        fields[4], "64.00",
        "five calendar days back is the wrong row across a weekend"
    );
    // Every one of the trailing ten rows carries volume 1000 at a low of 40.00.
    assert_eq!(fields[5], "40000.00", "mean of volume x low over ten rows");

    Ok(())
}

#[test]
fn picks_sidecar_blanks_values_it_cannot_compute_from_short_history() -> Result<()> {
    // Only four rows of history: the 52-week range is still computable over
    // what exists, but there are fewer than six rows (no five-trading-rows-back
    // close) and fewer than ten (no ten-weekday dollar ADV). Both must be
    // BLANK, never 0 — a zero would read as a real, terrible number.
    let symbol = "GRQVTEST838SHORT";
    let ticker = "NASDAQ:GRQVTEST838SHORT";

    let points = vec![
        PricePoint::detailed("2026-01-05", "20.00", "80.00", "7.00", "21.00", "1000"),
        PricePoint::detailed("2026-02-02", "22.00", "30.00", "19.00", "23.00", "1000"),
        PricePoint::detailed("2026-03-02", "24.00", "26.00", "23.00", "25.00", "1000"),
        PricePoint::detailed(SCORE_DATE, "26.00", "28.00", "25.00", "70.00", "1000"),
    ];

    let root = tempfile::tempdir()?;
    write_market_data(root.path(), symbol, &points)?;

    let out_dir = tempfile::tempdir()?;
    let out_path = out_dir.path().join("16-picks.csv");
    let out = out_path.to_str().expect("temp path is valid UTF-8");

    create_picks_sidecar_csv(root.path(), &[ticker.to_string()], SCORE_DATE, out)?;

    let fields = read_row(&out_path, ticker)?;
    assert_eq!(fields[1], "7.00", "52-week low over the months that exist");
    assert_eq!(
        fields[2], "80.00",
        "52-week high over the months that exist"
    );
    assert_eq!(fields[3], "70.00", "close on the score date");
    assert_eq!(
        fields[4], "",
        "close_5d_prior must be blank with fewer than six rows"
    );
    assert_eq!(
        fields[5], "",
        "adv_dollar_10d must be blank with fewer than ten rows"
    );

    Ok(())
}

#[test]
fn picks_sidecar_skips_a_missing_symbol_without_failing_the_run() -> Result<()> {
    // A ticker with no upstream JSON is skipped with a warning; the tickers
    // that DO have data still get their rows and the run succeeds.
    let symbol = "GRQVTEST838PRESENT";
    let present = "NYSE:GRQVTEST838PRESENT";
    let missing = "NYSE:GRQVTEST838MISSING";

    let points = vec![
        PricePoint::detailed("2026-03-02", "10.00", "12.00", "9.00", "11.00", "1000"),
        PricePoint::detailed(SCORE_DATE, "11.00", "13.00", "10.00", "12.00", "1000"),
    ];

    let root = tempfile::tempdir()?;
    write_market_data(root.path(), symbol, &points)?;

    let out_dir = tempfile::tempdir()?;
    let out_path = out_dir.path().join("16-picks.csv");
    let out = out_path.to_str().expect("temp path is valid UTF-8");

    create_picks_sidecar_csv(
        root.path(),
        &[missing.to_string(), present.to_string()],
        SCORE_DATE,
        out,
    )?;

    let csv = std::fs::read_to_string(&out_path)?;
    assert!(
        !csv.contains(missing),
        "the missing symbol must be skipped, not emitted, in:\n{csv}"
    );

    let fields = read_row(&out_path, present)?;
    assert_eq!(fields[1], "9.00");
    assert_eq!(fields[2], "13.00");
    assert_eq!(fields[3], "12.00");

    Ok(())
}

#[test]
fn picks_sidecar_preserves_an_existing_populated_file_when_no_rows_are_found() -> Result<()> {
    // Regression guard for the issue #687 class: a run that finds nothing
    // upstream must never truncate an already-populated sidecar to a bare
    // header row.
    let root = tempfile::tempdir()?;
    let out_dir = tempfile::tempdir()?;
    let out_path = out_dir.path().join("16-picks.csv");
    let out = out_path.to_str().expect("temp path is valid UTF-8");

    let existing = format!("{HEADER}\nNYSE:GRQVTEST838KEEP,9.00,15.00,12.00,11.50,250000.00\n");
    std::fs::write(&out_path, &existing)?;

    // Empty fixture root -> the only ticker is skipped -> zero rows written.
    let result = create_picks_sidecar_csv(
        root.path(),
        &["NYSE:GRQVTEST838GONE".to_string()],
        SCORE_DATE,
        out,
    );

    assert!(
        result.is_err(),
        "a run that writes no rows must fail loud rather than report success"
    );

    let after = std::fs::read_to_string(&out_path)?;
    assert_eq!(
        after, existing,
        "the existing populated sidecar must be left untouched"
    );
    assert!(
        !Path::new(&format!("{out}.tmp")).exists(),
        "the atomic-write temp file must not linger after a preserve"
    );

    Ok(())
}

#[test]
fn picks_sidecar_dollar_adv_matches_the_shared_parity_fixture() -> Result<()> {
    // Parity gate: the same committed window feeds this test and
    // tests/adv_dollar_volume_parity_test.ts, which runs it through
    // `averageDollarVolume` in docs/volume_recommend.js. If either side's
    // dollar-ADV definition drifts, one of the two tests fails.
    let fixture_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("adv_dollar_10d_parity.json");
    let fixture: Value = serde_json::from_str(&std::fs::read_to_string(&fixture_path)?)?;

    let symbol = fixture["symbol"].as_str().expect("fixture symbol");
    let ticker = fixture["ticker"].as_str().expect("fixture ticker");
    let score_date = fixture["score_date"].as_str().expect("fixture score_date");
    let expected = fixture["expected_adv_dollar_10d"]
        .as_f64()
        .expect("fixture expected_adv_dollar_10d");

    let rows = fixture["rows"].as_array().expect("fixture rows");
    let owned: Vec<OwnedPoint> = rows
        .iter()
        .map(|row| {
            let field = |name: &str| {
                row[name]
                    .as_str()
                    .unwrap_or_else(|| panic!("fixture row missing {name}"))
                    .to_string()
            };
            OwnedPoint {
                date: field("date"),
                open: field("open"),
                high: field("high"),
                low: field("low"),
                close: field("close"),
                volume: field("volume"),
            }
        })
        .collect();

    let root = tempfile::tempdir()?;
    write_market_data(root.path(), symbol, &as_points(&owned))?;

    let out_dir = tempfile::tempdir()?;
    let out_path = out_dir.path().join("parity-picks.csv");
    let out = out_path.to_str().expect("temp path is valid UTF-8");

    create_picks_sidecar_csv(root.path(), &[ticker.to_string()], score_date, out)?;

    let fields = read_row(&out_path, ticker)?;
    let actual: f64 = fields[5]
        .parse()
        .map_err(|error| anyhow!("adv_dollar_10d {:?} is not numeric: {error}", fields[5]))?;

    assert!(
        (actual - expected).abs() < 0.01,
        "adv_dollar_10d {actual} must match the shared parity fixture's {expected}"
    );

    Ok(())
}
