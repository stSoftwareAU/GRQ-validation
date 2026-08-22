//! Behaviour tests for the historical pick-details backfill (issue #839,
//! sub-issue of #835).
//!
//! The sidecar writer (issue #838) only runs for dates a normal processor run
//! selects, so without a backfill every historical score date in
//! `docs/scores/index.json` would keep blank pick-detail columns — the dates the
//! dashboard exists to review. These tests cover the backfill's observable
//! contract: every indexed date is either written or named as skipped with a
//! reason, an upstream gap never aborts the run, and a second run over unchanged
//! data reproduces byte-identical files.
//!
//! Every fixture is synthetic and hermetic (issue #804): the score tree, the
//! index and the market-data tree are all built inside the test's own
//! `tempfile::tempdir()`, so nothing reads or writes a configured data root.

mod common;

use chrono::{Datelike, Duration, NaiveDate};
use common::{write_market_data, write_score_file, PricePoint};
use grq_validation::picks_backfill::backfill_picks_sidecars;
use serde_json::json;
use std::path::{Path, PathBuf};

/// The header every sidecar carries, so a header-only file is recognisable.
const HEADER: &str = "ticker,week52_low,week52_high,close_score_date,close_5d_prior,adv_dollar_10d";

/// A Monday, so "five trading rows back" is not five calendar days.
const SCORE_DATE: &str = "2026-03-16";

/// The ticker every fixture scores.
const TICKER: &str = "NYSE:SEM";

/// Parses a fixture date, which is always a literal in these tests.
fn date_of(iso: &str) -> NaiveDate {
    NaiveDate::parse_from_str(iso, "%Y-%m-%d").expect("fixture date parses")
}

/// The `count` weekday dates ending at `end` inclusive, oldest first.
fn weekday_dates(end: NaiveDate, count: usize) -> Vec<String> {
    let mut dates = Vec::new();
    let mut date = end;
    while dates.len() < count {
        if date.weekday().num_days_from_monday() < 5 {
            dates.push(date.format("%Y-%m-%d").to_string());
        }
        date -= Duration::days(1);
    }
    dates.reverse();
    dates
}

/// Writes a market-data fixture for `TICKER` covering `dates`.
fn write_history(market_root: &Path, dates: &[String]) {
    let points: Vec<PricePoint<'_>> = dates
        .iter()
        .map(|date| PricePoint::detailed(date, "45.00", "50.00", "40.00", "45.50", "1000"))
        .collect();
    write_market_data(market_root, "SEM", &points).expect("write market data fixture");
}

/// One indexed score date: `(ISO date, year, month name, day)`.
struct IndexedDate {
    date: String,
    year: String,
    month: String,
    day: String,
}

impl IndexedDate {
    fn new(iso: &str) -> Self {
        let date = date_of(iso);
        const MONTHS: [&str; 12] = [
            "January",
            "February",
            "March",
            "April",
            "May",
            "June",
            "July",
            "August",
            "September",
            "October",
            "November",
            "December",
        ];
        Self {
            date: iso.to_string(),
            year: date.format("%Y").to_string(),
            month: MONTHS[date.month0() as usize].to_string(),
            day: date.format("%d").to_string(),
        }
    }

    fn file(&self) -> String {
        format!("{}/{}/{}.tsv", self.year, self.month, self.day)
    }

    fn score_path(&self, docs_path: &Path) -> PathBuf {
        docs_path.join("scores").join(self.file())
    }

    fn sidecar_path(&self, docs_path: &Path) -> PathBuf {
        docs_path
            .join("scores")
            .join(&self.year)
            .join(&self.month)
            .join(format!("{}-picks.csv", self.day))
    }
}

/// Writes `<docs>/scores/index.json` listing `dates`, in the shape the
/// processor's own reader expects.
fn write_index(docs_path: &Path, dates: &[IndexedDate]) {
    let scores: Vec<_> = dates
        .iter()
        .map(|entry| {
            json!({
                "year": entry.year,
                "month": entry.month,
                "day": entry.day,
                "file": entry.file(),
                "date": entry.date,
            })
        })
        .collect();

    let index_path = docs_path.join("scores").join("index.json");
    std::fs::create_dir_all(index_path.parent().expect("index has a parent"))
        .expect("create score tree");
    std::fs::write(&index_path, json!({ "scores": scores }).to_string())
        .expect("write index fixture");
}

/// A docs tree and a market-data root, both inside one temporary directory.
struct Fixture {
    _root: tempfile::TempDir,
    docs_path: PathBuf,
    market_root: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let root = tempfile::tempdir().expect("create temp root");
        let docs_path = root.path().join("docs");
        let market_root = root.path().join("market-data");
        std::fs::create_dir_all(market_root.join("data")).expect("create market tree");
        Self {
            _root: root,
            docs_path,
            market_root,
        }
    }

    fn docs(&self) -> &str {
        self.docs_path.to_str().expect("temp path is UTF-8")
    }
}

#[test]
fn backfill_writes_a_sidecar_for_every_indexed_date() {
    let fixture = Fixture::new();
    let score_date = date_of(SCORE_DATE);
    let earlier = IndexedDate::new("2026-03-09");
    let latest = IndexedDate::new(SCORE_DATE);

    write_index(&fixture.docs_path, &[earlier, latest]);
    for entry in [IndexedDate::new("2026-03-09"), IndexedDate::new(SCORE_DATE)] {
        write_score_file(&entry.score_path(&fixture.docs_path), &[TICKER])
            .expect("write score fixture");
    }
    // A full year of weekdays, so both dates have their whole look-back window.
    write_history(&fixture.market_root, &weekday_dates(score_date, 260));

    let summary = backfill_picks_sidecars(&fixture.market_root, fixture.docs(), None)
        .expect("backfill over complete history succeeds");

    assert_eq!(summary.written.len(), 2, "summary: {}", summary.render());
    assert!(summary.skipped.is_empty(), "summary: {}", summary.render());
    assert_eq!(summary.considered.len(), 2);

    for entry in [IndexedDate::new("2026-03-09"), IndexedDate::new(SCORE_DATE)] {
        let sidecar = entry.sidecar_path(&fixture.docs_path);
        let content = std::fs::read_to_string(&sidecar)
            .unwrap_or_else(|error| panic!("read {}: {error}", sidecar.display()));
        assert!(content.starts_with(HEADER), "unexpected header: {content}");
        assert!(
            content.contains(TICKER),
            "{} should carry a row for {TICKER}: {content}",
            sidecar.display()
        );
    }
}

#[test]
fn backfill_picks_missing_history() {
    // The upstream tree holds nothing before the score date — the state older
    // dates are in. The backfill must not abort: it leaves blank cells and names
    // the date, with a reason, in its summary.
    let fixture = Fixture::new();
    let entry = IndexedDate::new(SCORE_DATE);
    write_index(&fixture.docs_path, &[IndexedDate::new(SCORE_DATE)]);
    write_score_file(&entry.score_path(&fixture.docs_path), &[TICKER])
        .expect("write score fixture");

    // Every row is AFTER the score date, so the look-back window is empty.
    let after: Vec<String> = weekday_dates(date_of(SCORE_DATE) + Duration::days(40), 20)
        .into_iter()
        .filter(|date| date.as_str() > SCORE_DATE)
        .collect();
    write_history(&fixture.market_root, &after);

    let summary = backfill_picks_sidecars(&fixture.market_root, fixture.docs(), None)
        .expect("an upstream gap must not abort the backfill");

    assert!(summary.written.is_empty(), "summary: {}", summary.render());
    assert_eq!(summary.skipped.len(), 1, "summary: {}", summary.render());
    assert_eq!(summary.skipped[0].date, SCORE_DATE);
    assert!(
        !summary.skipped[0].reason.trim().is_empty(),
        "a skipped date must carry a reason"
    );
    assert!(
        summary.render().contains(SCORE_DATE),
        "the summary must name the skipped date: {}",
        summary.render()
    );

    // Blank cells, not a missing file and not a fabricated row.
    let sidecar = entry.sidecar_path(&fixture.docs_path);
    let content = std::fs::read_to_string(&sidecar)
        .unwrap_or_else(|error| panic!("read {}: {error}", sidecar.display()));
    assert_eq!(content.trim(), HEADER, "expected a header-only sidecar");
}

#[test]
fn backfill_skips_a_date_whose_score_file_was_never_written() {
    // docs/scores/index.json lists 10 dates whose TSV is not committed. They
    // must be named as skipped rather than abandoning the rest of the run.
    let fixture = Fixture::new();
    let missing = IndexedDate::new("2026-03-09");
    let present = IndexedDate::new(SCORE_DATE);
    write_index(
        &fixture.docs_path,
        &[IndexedDate::new("2026-03-09"), IndexedDate::new(SCORE_DATE)],
    );
    write_score_file(&present.score_path(&fixture.docs_path), &[TICKER])
        .expect("write score fixture");
    write_history(
        &fixture.market_root,
        &weekday_dates(date_of(SCORE_DATE), 260),
    );

    let summary = backfill_picks_sidecars(&fixture.market_root, fixture.docs(), None)
        .expect("a missing score file must not abort the backfill");

    assert_eq!(summary.written.len(), 1, "summary: {}", summary.render());
    assert_eq!(summary.written[0].date, present.date);
    assert_eq!(summary.skipped.len(), 1, "summary: {}", summary.render());
    assert_eq!(summary.skipped[0].date, missing.date);
    assert!(
        !missing.sidecar_path(&fixture.docs_path).exists(),
        "no sidecar may be invented for a date with no score file"
    );
}

#[test]
fn backfill_accounts_for_every_considered_date() {
    // A silent partial backfill is the failure mode to avoid: every date the run
    // considered must appear exactly once across written and skipped.
    let fixture = Fixture::new();
    let dates = ["2026-03-09", SCORE_DATE, "2026-03-17"];
    let entries: Vec<IndexedDate> = dates.iter().map(|date| IndexedDate::new(date)).collect();
    write_index(
        &fixture.docs_path,
        &dates
            .iter()
            .map(|date| IndexedDate::new(date))
            .collect::<Vec<_>>(),
    );
    // Only two of the three dates have a score file.
    for entry in entries.iter().take(2) {
        write_score_file(&entry.score_path(&fixture.docs_path), &[TICKER])
            .expect("write score fixture");
    }
    write_history(
        &fixture.market_root,
        &weekday_dates(date_of("2026-03-17"), 260),
    );

    let summary = backfill_picks_sidecars(&fixture.market_root, fixture.docs(), None)
        .expect("backfill completes");

    let mut accounted: Vec<String> = summary
        .written
        .iter()
        .map(|written| written.date.clone())
        .chain(summary.skipped.iter().map(|skip| skip.date.clone()))
        .collect();
    accounted.sort();
    let mut considered = summary.considered.clone();
    considered.sort();
    assert_eq!(accounted, considered, "summary: {}", summary.render());
}

#[test]
fn backfill_is_idempotent_over_unchanged_upstream_data() {
    let fixture = Fixture::new();
    let entry = IndexedDate::new(SCORE_DATE);
    write_index(&fixture.docs_path, &[IndexedDate::new(SCORE_DATE)]);
    write_score_file(&entry.score_path(&fixture.docs_path), &[TICKER])
        .expect("write score fixture");
    write_history(
        &fixture.market_root,
        &weekday_dates(date_of(SCORE_DATE), 260),
    );

    backfill_picks_sidecars(&fixture.market_root, fixture.docs(), None).expect("first run");
    let first = std::fs::read(entry.sidecar_path(&fixture.docs_path)).expect("read first run");
    backfill_picks_sidecars(&fixture.market_root, fixture.docs(), None).expect("second run");
    let second = std::fs::read(entry.sidecar_path(&fixture.docs_path)).expect("read second run");

    assert_eq!(
        first, second,
        "a second run over unchanged data must be byte-identical"
    );
}

#[test]
fn backfill_for_a_single_date_touches_only_that_date() {
    let fixture = Fixture::new();
    let other = IndexedDate::new("2026-03-09");
    let wanted = IndexedDate::new(SCORE_DATE);
    write_index(
        &fixture.docs_path,
        &[IndexedDate::new("2026-03-09"), IndexedDate::new(SCORE_DATE)],
    );
    for entry in [&other, &wanted] {
        write_score_file(&entry.score_path(&fixture.docs_path), &[TICKER])
            .expect("write score fixture");
    }
    write_history(
        &fixture.market_root,
        &weekday_dates(date_of(SCORE_DATE), 260),
    );

    let summary = backfill_picks_sidecars(&fixture.market_root, fixture.docs(), Some(SCORE_DATE))
        .expect("single-date backfill succeeds");

    assert_eq!(summary.considered, vec![SCORE_DATE.to_string()]);
    assert_eq!(summary.written.len(), 1);
    assert!(wanted.sidecar_path(&fixture.docs_path).exists());
    assert!(
        !other.sidecar_path(&fixture.docs_path).exists(),
        "a single-date run must not write other dates"
    );
}

#[test]
fn backfill_for_an_unindexed_date_fails_loud() {
    let fixture = Fixture::new();
    let entry = IndexedDate::new(SCORE_DATE);
    write_index(&fixture.docs_path, &[IndexedDate::new(SCORE_DATE)]);
    write_score_file(&entry.score_path(&fixture.docs_path), &[TICKER])
        .expect("write score fixture");

    let error = backfill_picks_sidecars(&fixture.market_root, fixture.docs(), Some("2019-01-02"))
        .expect_err("a date the index does not list must fail loud");

    assert!(
        error.to_string().contains("2019-01-02"),
        "the error must name the requested date, got: {error}"
    );
}

#[test]
fn backfill_over_an_empty_index_fails_loud() {
    let fixture = Fixture::new();
    write_index(&fixture.docs_path, &[]);

    let error = backfill_picks_sidecars(&fixture.market_root, fixture.docs(), None)
        .expect_err("an empty index must never pass vacuously");

    assert!(
        error.to_string().contains("index.json"),
        "the error must name the index, got: {error}"
    );
}
