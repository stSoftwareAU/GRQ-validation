//! Behaviour ("WHAT") tests for `update_index_with_performance` (issue #203).
//!
//! `update_index_with_performance` is the write path that persists every
//! performance and projection figure into `docs/scores/index.json`. These
//! tests run the real function against a temporary `docs` fixture and assert
//! on the **persisted output** (the rewritten index JSON), not on internals,
//! so they keep working when the orchestration is refactored.
//!
//! Expected values are derived from the spec:
//!   * a settled (>= 90 day old) score with a single stock that closes 10%
//!     above its buy price persists `performance_90_day == 10.0` (no dividends
//!     for the synthetic ticker, so total return equals the price gain), and
//!   * a still-open (< 90 day old) score whose source data is absent keeps
//!     `performance_90_day == null` rather than fabricating a figure.

use chrono::{Duration, Utc};
use grq_validation::utils::{read_index_json, update_index_with_performance};
use std::fs;
use std::path::Path;

/// Writes `contents` to `path`, creating parent directories as needed.
fn write_file(path: &Path, contents: &str) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("create parent directories");
    }
    fs::write(path, contents).expect("write fixture file");
}

/// A `YYYY-MM-DD` date string `days` before today (UTC).
fn date_days_ago(days: i64) -> String {
    let date = Utc::now().naive_utc().date() - Duration::days(days);
    date.format("%Y-%m-%d").to_string()
}

#[test]
fn update_index_with_performance_writes_settled_and_open_entries() {
    let dir = tempfile::tempdir().expect("create temp docs dir");
    let docs = dir.path();
    let scores = docs.join("scores");

    // --- Settled entry: 2025-01-15 is far more than 90 days old, so it takes
    // the regular performance branch which reads the co-located TSV + CSV. ---
    let settled_file = "2025/January/15.tsv";
    write_file(
        &scores.join(settled_file),
        "Stock\tScore\tTarget\tExDividendDate\tDividendPerShare\tNotes\t\
         intrinsicValuePerShareBasic\tintrinsicValuePerShareAdjusted\n\
         NYSE:TEST\t1.0\t150.00\t\t\t\t\t\n",
    );
    // Long-format market CSV (date,ticker,high,low,open,close) read by the
    // performance calculation. Buy on the score date at 100, sell on the exact
    // 90-day end date (2025-04-15) at 110 => a clean 10% price gain.
    write_file(
        &scores.join("2025/January/15.csv"),
        "date,ticker,high,low,open,close\n\
         2025-01-15,NYSE:TEST,0,0,0,100.0\n\
         2025-04-15,NYSE:TEST,0,0,0,110.0\n",
    );

    // --- Still-open entry: dated 10 days ago, so it always takes the hybrid
    // branch. Its source files are deliberately absent, so no projection can
    // be computed and the persisted figure must stay null. ---
    let open_date = date_days_ago(10);
    let open_file = "open/score.tsv";

    let index_json = format!(
        r#"{{
  "scores": [
    {{
      "year": "2025",
      "month": "January",
      "day": "15",
      "file": "{settled_file}",
      "date": "2025-01-15"
    }},
    {{
      "year": "2026",
      "month": "Open",
      "day": "01",
      "file": "{open_file}",
      "date": "{open_date}"
    }}
  ]
}}"#
    );
    write_file(&scores.join("index.json"), &index_json);

    // Act: run the real write path against the fixture.
    update_index_with_performance(docs.to_str().unwrap())
        .expect("update_index_with_performance should succeed");

    // Assert on the persisted output, located by `file` rather than position.
    let updated = read_index_json(docs.to_str().unwrap()).expect("re-read rewritten index");

    let settled = updated
        .scores
        .iter()
        .find(|e| e.file == settled_file)
        .expect("settled entry persisted");
    let perf = settled
        .performance_90_day
        .expect("settled entry carries a 90-day performance figure");
    assert!(
        (perf - 10.0).abs() < 1e-6,
        "expected spec-derived 10.0% 90-day performance, got {perf}"
    );
    assert_eq!(
        settled.total_stocks,
        Some(1),
        "settled entry records the single contributing stock"
    );
    // Annualised return compounds the 10% over the full 90-day window and so
    // must be a positive figure larger than the 90-day return.
    let annualised = settled
        .performance_annualized
        .expect("settled entry carries an annualised figure");
    assert!(
        annualised > perf,
        "annualised return {annualised} should exceed the 90-day return {perf}"
    );

    let open = updated
        .scores
        .iter()
        .find(|e| e.file == open_file)
        .expect("still-open entry persisted");
    assert!(
        open.performance_90_day.is_none(),
        "still-open score with no source data must keep performance_90_day = null, got {:?}",
        open.performance_90_day
    );
    assert!(
        open.performance_annualized.is_none(),
        "still-open score must keep performance_annualized = null"
    );
}
