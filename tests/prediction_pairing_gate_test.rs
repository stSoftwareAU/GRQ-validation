//! Behaviour tests for the processor's end-of-run pairing gate (issue #833).
//!
//! `docs/scores/2026/July/19.tsv` reached `main` with no sibling `19.csv`, so
//! the CI data-presence gate went red on every PR cut from `main`. The
//! processor had produced that tree and still reported success: every failure
//! inside its per-score-file loop was logged with `log::error!` and stepped
//! over, and a score entry that never reached the loop at all was invisible.
//!
//! These tests pin the fix — a run that leaves a committed prediction date
//! without usable market data must fail loud, naming every offender, rather
//! than exiting zero over a tree CI rejects.
//!
//! The fixtures are synthetic and hermetic (issue #804): every read and write
//! stays inside the test's temporary directories and both data roots are passed
//! explicitly, so no test touches a configured data root.

mod common;

use anyhow::Result;
use common::write_score_file;
use grq_validation::utils::{collect_prediction_score_files, find_unpaired_prediction_dates};
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

const MARKET_DATA_ROOT_ENV: &str = "GRQ_MARKET_DATA_PATH";
const DIVIDEND_DATA_ROOT_ENV: &str = "GRQ_DIVIDEND_DATA_PATH";

/// A market-data CSV carrying one real price row.
const POPULATED_CSV: &str = "date,ticker,high,low,open,close,split_coefficient,volume\n\
     2025-01-20,NYSE:GRQVTEST833,46.07,44.75,44.76,45.72,1.0,1000\n";

/// A market-data CSV reduced to its header — the shape a run with no upstream
/// data leaves behind, and the shape the data-presence gate rejects.
const HEADER_ONLY_CSV: &str = "date,ticker,high,low,open,close,split_coefficient,volume\n";

/// A prediction date far enough in the past that the processor's default
/// 180-day filter always skips it, however long from now the suite is run.
/// This is deliberate: it reproduces the July 19 shape, where the offending
/// date never entered the per-score-file loop at all.
const SKIPPED_DATE: (&str, &str, &str) = ("2025", "January", "19");

/// Writes a day-numbered prediction TSV under `<docs>/scores/<year>/<month>/`.
fn write_prediction(docs: &Path, (year, month, day): (&str, &str, &str)) -> Result<PathBuf> {
    let dir = docs.join("scores").join(year).join(month);
    std::fs::create_dir_all(&dir)?;
    write_score_file(&dir.join(format!("{day}.tsv")), &["NYSE:GRQVTEST833"])
}

/// Writes the market-data CSV beside a prediction TSV.
fn write_market_csv(docs: &Path, (year, month, day): (&str, &str, &str), body: &str) -> Result<()> {
    let path = docs
        .join("scores")
        .join(year)
        .join(month)
        .join(format!("{day}.csv"));
    std::fs::write(path, body)?;
    Ok(())
}

/// Writes a scores index holding one entry for `date`.
fn write_index(docs: &Path, (year, month, day): (&str, &str, &str)) -> Result<()> {
    let month_number = match month {
        "January" => "01",
        "July" => "07",
        other => panic!("fixture month {other} not mapped"),
    };
    let index = serde_json::json!({
        "scores": [{
            "year": year,
            "month": month,
            "day": day,
            "file": format!("{year}/{month}/{day}.tsv"),
            "date": format!("{year}-{month_number}-{day}"),
        }]
    });
    std::fs::write(
        docs.join("scores").join("index.json"),
        serde_json::to_string_pretty(&index)?,
    )?;
    Ok(())
}

/// Creates a usable data root (an empty `data/` tree) named `name` inside `base`.
fn data_root_in(base: &Path, name: &str) -> Result<PathBuf> {
    let root = base.join(name);
    std::fs::create_dir_all(root.join("data"))?;
    Ok(root)
}

/// Runs the real processor over `docs`, with both data roots supplied as flags
/// and cleared from the environment so the result never depends on the host.
fn run_processor(base: &Path, docs: &Path) -> Result<Output> {
    let market = data_root_in(base, "market-data")?;
    let dividends = data_root_in(base, "dividend-data")?;
    let output = Command::new(env!("CARGO_BIN_EXE_grq-validation"))
        .env_remove(MARKET_DATA_ROOT_ENV)
        .env_remove(DIVIDEND_DATA_ROOT_ENV)
        .arg("--docs-path")
        .arg(docs)
        .arg("--market-data-path")
        .arg(&market)
        .arg("--dividend-data-path")
        .arg(&dividends)
        .output()?;
    Ok(output)
}

#[test]
fn no_offenders_when_every_prediction_date_is_paired() -> Result<()> {
    let base = tempfile::tempdir()?;
    let docs = base.path().join("docs");
    write_prediction(&docs, SKIPPED_DATE)?;
    write_market_csv(&docs, SKIPPED_DATE, POPULATED_CSV)?;

    let offenders = find_unpaired_prediction_dates(docs.to_str().expect("utf-8 temp path"))?;

    assert!(
        offenders.is_empty(),
        "a paired tree must report no offenders, got {offenders:?}"
    );
    Ok(())
}

#[test]
fn a_missing_market_data_csv_is_reported_as_missing() -> Result<()> {
    let base = tempfile::tempdir()?;
    let docs = base.path().join("docs");
    write_prediction(&docs, SKIPPED_DATE)?;

    let offenders = find_unpaired_prediction_dates(docs.to_str().expect("utf-8 temp path"))?;

    assert_eq!(
        offenders.len(),
        1,
        "expected one offender, got {offenders:?}"
    );
    assert!(
        offenders[0].ends_with("19.csv (missing)"),
        "offender should name the absent CSV: {offenders:?}"
    );
    Ok(())
}

#[test]
fn a_header_only_market_data_csv_is_reported_as_empty() -> Result<()> {
    let base = tempfile::tempdir()?;
    let docs = base.path().join("docs");
    write_prediction(&docs, SKIPPED_DATE)?;
    write_market_csv(&docs, SKIPPED_DATE, HEADER_ONLY_CSV)?;

    let offenders = find_unpaired_prediction_dates(docs.to_str().expect("utf-8 temp path"))?;

    assert_eq!(
        offenders.len(),
        1,
        "expected one offender, got {offenders:?}"
    );
    assert!(
        offenders[0].ends_with("19.csv (header-only/empty)"),
        "offender should name the header-only CSV: {offenders:?}"
    );
    Ok(())
}

#[test]
fn an_empty_score_tree_is_a_fault_not_a_pass() -> Result<()> {
    let base = tempfile::tempdir()?;
    let docs = base.path().join("docs");
    std::fs::create_dir_all(docs.join("scores"))?;

    let result = find_unpaired_prediction_dates(docs.to_str().expect("utf-8 temp path"));

    assert!(
        result.is_err(),
        "a score tree with no prediction files must fail loud, not pass vacuously"
    );
    Ok(())
}

#[test]
fn an_unreadable_score_tree_is_a_fault() -> Result<()> {
    let base = tempfile::tempdir()?;
    let docs = base.path().join("docs");
    std::fs::create_dir_all(&docs)?;

    let result = find_unpaired_prediction_dates(docs.to_str().expect("utf-8 temp path"));

    assert!(
        result.is_err(),
        "a missing scores directory must fail loud rather than report a clean tree"
    );
    Ok(())
}

#[test]
fn collect_prediction_score_files_recurses_and_ignores_helper_files() -> Result<()> {
    let base = tempfile::tempdir()?;
    let docs = base.path().join("docs");
    write_prediction(&docs, SKIPPED_DATE)?;
    write_prediction(&docs, ("2025", "July", "07"))?;
    let july = docs.join("scores").join("2025").join("July");
    std::fs::write(july.join("07-analysis.csv"), "a,b\n1,2\n")?;
    std::fs::write(july.join("07-dividends.csv"), "a,b\n1,2\n")?;
    std::fs::write(july.join("notes.tsv"), "irrelevant\n")?;

    let found = collect_prediction_score_files(docs.to_str().expect("utf-8 temp path"))?;

    assert_eq!(
        found.len(),
        2,
        "only day-numbered TSVs are prediction files: {found:?}"
    );
    assert!(
        found.iter().all(|path| path.ends_with(".tsv")),
        "helper CSVs must not be collected: {found:?}"
    );
    assert!(
        found
            .iter()
            .any(|path| path.ends_with("2025/January/19.tsv")),
        "the walk must recurse into every year/month directory: {found:?}"
    );
    Ok(())
}

#[test]
fn processor_fails_loud_when_a_promoted_date_has_no_market_data() -> Result<()> {
    let base = tempfile::tempdir()?;
    let docs = base.path().join("docs");
    write_prediction(&docs, SKIPPED_DATE)?;
    write_index(&docs, SKIPPED_DATE)?;

    let output = run_processor(base.path(), &docs)?;

    assert!(
        !output.status.success(),
        "a run leaving a prediction date unpaired must exit non-zero"
    );
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains("19.csv (missing)"),
        "the failure must name the offending path, got:\n{stderr}"
    );
    Ok(())
}

#[test]
fn processor_succeeds_when_every_promoted_date_is_paired() -> Result<()> {
    let base = tempfile::tempdir()?;
    let docs = base.path().join("docs");
    write_prediction(&docs, SKIPPED_DATE)?;
    write_market_csv(&docs, SKIPPED_DATE, POPULATED_CSV)?;
    write_index(&docs, SKIPPED_DATE)?;

    let output = run_processor(base.path(), &docs)?;

    assert!(
        output.status.success(),
        "a paired tree must exit zero, got:\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
    Ok(())
}
