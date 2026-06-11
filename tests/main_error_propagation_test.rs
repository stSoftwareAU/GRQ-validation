//! Integration tests for error propagation in the single-date branch of `main`.
//!
//! These exercise the real binary end-to-end. The refactor in issue #95
//! replaces nested `match { Err(e) => { log::error!(..); return Err(e) } }`
//! ladders with `?` propagation plus `anyhow` context. We assert on the
//! resulting error chain so the tests track observable behaviour (non-zero
//! exit and a contextualised error message), not the implementation.

use chrono::{Duration, Utc};
use std::process::Command;

/// Build a `YYYY-MM-DD` date string `days` before today (UTC).
fn date_days_ago(days: i64) -> String {
    let date = Utc::now().naive_utc().date() - Duration::days(days);
    date.format("%Y-%m-%d").to_string()
}

/// Run the binary for a single date against an empty docs directory.
fn run_for_date(date: &str) -> std::process::Output {
    let docs_dir = tempfile::tempdir().expect("create temp docs dir");
    Command::new(env!("CARGO_BIN_EXE_grq-validation"))
        .args([
            "--date",
            date,
            "--docs-path",
            docs_dir.path().to_str().unwrap(),
        ])
        .output()
        .expect("run grq-validation binary")
}

#[test]
fn hybrid_branch_missing_tsv_propagates_with_context() {
    // A date less than 90 days old takes the hybrid-projection branch, which
    // first reads the TSV score file. The file is absent, so the error must
    // propagate with the "reading TSV file" context and a non-zero exit.
    let output = run_for_date(&date_days_ago(10));
    let stderr = String::from_utf8_lossy(&output.stderr);

    assert!(
        !output.status.success(),
        "expected non-zero exit, stderr: {stderr}"
    );
    assert!(
        stderr.contains("reading TSV file"),
        "expected TSV context in error chain, stderr: {stderr}"
    );
}

#[test]
fn regular_branch_missing_file_propagates_with_context() {
    // A date at least 90 days old takes the regular performance branch. With
    // no score file present the calculation fails and must propagate with the
    // "calculating performance" context and a non-zero exit.
    let output = run_for_date(&date_days_ago(200));
    let stderr = String::from_utf8_lossy(&output.stderr);

    assert!(
        !output.status.success(),
        "expected non-zero exit, stderr: {stderr}"
    );
    assert!(
        stderr.contains("calculating performance"),
        "expected performance context in error chain, stderr: {stderr}"
    );
}

#[test]
fn invalid_date_format_is_rejected() {
    // Behaviour preserved by the refactor: a malformed date is rejected before
    // any file access.
    let output = run_for_date("2026-06");
    let stderr = String::from_utf8_lossy(&output.stderr);

    assert!(
        !output.status.success(),
        "expected non-zero exit, stderr: {stderr}"
    );
    assert!(
        stderr.contains("Invalid date format"),
        "expected invalid-date-format error, stderr: {stderr}"
    );
}
