//! Backfill of the pick-details sidecar across every historical score date
//! (issue #839, sub-issue of #835).
//!
//! [`crate::picks_sidecar`] writes `<date>-picks.csv` for the dates a normal
//! processor run selects — recent ones. The dashboard exists to review *past*
//! picks, and `docs/scores/index.json` reaches back to 2024-10-15, so without a
//! pass over the whole index every historical date would keep blank pick-detail
//! columns and the feature would only work for whatever is scored from now on.
//!
//! This module is that pass. It iterates **every** entry in the index —
//! including dates far older than the 180-day cut-off `--process-all` exists to
//! bypass — and rebuilds only the sidecar, touching no other derived file.
//!
//! Two rules make a partial backfill impossible to miss:
//!
//! - **Nothing is abandoned quietly.** An upstream gap (no market data before
//!   the score date, a symbol missing upstream, a score file the scorer never
//!   committed) leaves blank cells and is recorded as a *skip with a reason*
//!   rather than aborting the remaining dates.
//! - **Every considered date is accounted for.** The run fails loud if a date is
//!   neither written nor skipped, because a date in neither list is a bug in the
//!   iteration rather than a benign outcome.

use crate::models::ScoreEntry;
use crate::picks_sidecar::create_picks_sidecar_csv_for_score_file;
use crate::utils::{build_score_file_path, extract_ticker_codes_from_score_file, read_index_json};
use anyhow::{anyhow, Result};
use std::path::Path;

/// A sidecar the run wrote.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WrittenSidecar {
    /// Score date in `YYYY-MM-DD` form.
    pub date: String,
    /// Path of the sidecar written for it.
    pub path: String,
}

/// A score date that produced no populated sidecar, and why.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SkippedDate {
    /// Score date in `YYYY-MM-DD` form.
    pub date: String,
    /// Operator-facing reason, e.g. the upstream gap that left it blank.
    pub reason: String,
}

/// What one backfill run did, date by date.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct BackfillSummary {
    /// Every date the run selected from the index, in the order visited.
    pub considered: Vec<String>,
    /// The sidecars written.
    pub written: Vec<WrittenSidecar>,
    /// The dates that produced none, each with its reason.
    pub skipped: Vec<SkippedDate>,
}

impl BackfillSummary {
    /// The operator-facing end-of-run report: the counts, then every skipped
    /// date with its reason. A silent partial backfill is the failure mode this
    /// exists to prevent, so no skip is ever summarised as a bare count.
    #[must_use]
    pub fn render(&self) -> String {
        let mut report = format!(
            "Pick-details sidecar backfill\n  dates considered: {}\n  sidecars written: {}\n  \
             dates skipped:    {}",
            self.considered.len(),
            self.written.len(),
            self.skipped.len()
        );

        for skip in &self.skipped {
            report.push_str(&format!("\n    {} — {}", skip.date, skip.reason));
        }

        report
    }

    /// The considered dates that appear in neither the written nor the skipped
    /// list — always empty in a correct run.
    #[must_use]
    pub fn unaccounted(&self) -> Vec<String> {
        self.considered
            .iter()
            .filter(|date| {
                !self.written.iter().any(|written| &&written.date == date)
                    && !self.skipped.iter().any(|skip| &&skip.date == date)
            })
            .cloned()
            .collect()
    }

    /// Fails loud when a considered date is in neither list.
    ///
    /// # Errors
    ///
    /// Returns an error naming every unaccounted date.
    pub fn verify_accounted(&self) -> Result<()> {
        let unaccounted = self.unaccounted();
        if unaccounted.is_empty() {
            return Ok(());
        }

        Err(anyhow!(
            "{} score date(s) were neither written nor skipped — the backfill's \
             iteration over the index is incomplete:\n  {}",
            unaccounted.len(),
            unaccounted.join("\n  ")
        ))
    }

    /// Records a date the run could not write a populated sidecar for.
    fn skip(&mut self, date: &str, reason: String) {
        log::warn!("Skipping pick-details backfill for {date}: {reason}");
        self.skipped.push(SkippedDate {
            date: date.to_string(),
            reason,
        });
    }
}

/// Rebuilds the pick-details sidecar for every date in
/// `<docs_path>/scores/index.json`, or for `only_date` alone.
///
/// Nothing else is regenerated: the market-data, analysis and dividend CSVs of
/// each date are left exactly as committed.
///
/// # Errors
///
/// Returns an error if the index cannot be read, lists no dates at all, does not
/// list `only_date`, or if a date the run considered ends up in neither the
/// written nor the skipped list. A per-date upstream gap is **not** an error: it
/// is reported as a skip in the returned summary.
pub fn backfill_picks_sidecars(
    market_root: &Path,
    docs_path: &str,
    only_date: Option<&str>,
) -> Result<BackfillSummary> {
    let index_data = read_index_json(docs_path)?;

    // An empty index means the tree moved or emptied — never a silent pass.
    if index_data.scores.is_empty() {
        return Err(anyhow!(
            "{docs_path}/scores/index.json lists no score dates — nothing to backfill"
        ));
    }

    let selected: Vec<&ScoreEntry> = match only_date {
        Some(date) => index_data
            .scores
            .iter()
            .filter(|entry| entry.date == date)
            .collect(),
        None => index_data.scores.iter().collect(),
    };

    // A requested date that the index does not list is a typo, not a no-op.
    if let (Some(date), true) = (only_date, selected.is_empty()) {
        return Err(anyhow!(
            "{docs_path}/scores/index.json does not list {date} — no sidecar to backfill"
        ));
    }

    let mut summary = BackfillSummary::default();

    for entry in selected {
        summary.considered.push(entry.date.clone());

        let score_file_path = match build_score_file_path(docs_path, &entry.file) {
            Ok(path) => path,
            Err(error) => {
                summary.skip(&entry.date, format!("unsafe score file path: {error}"));
                continue;
            }
        };

        let tickers = match extract_ticker_codes_from_score_file(&score_file_path) {
            Ok(tickers) => tickers,
            Err(error) => {
                summary.skip(
                    &entry.date,
                    format!("score file {score_file_path} unreadable: {error}"),
                );
                continue;
            }
        };

        if tickers.is_empty() {
            summary.skip(
                &entry.date,
                format!("score file {score_file_path} lists no tickers"),
            );
            continue;
        }

        match create_picks_sidecar_csv_for_score_file(
            market_root,
            &score_file_path,
            &tickers,
            &entry.date,
        ) {
            Ok(path) => {
                log::info!("Wrote pick-details sidecar {path}");
                summary.written.push(WrittenSidecar {
                    date: entry.date.clone(),
                    path,
                });
            }
            // The upstream tree may hold no pre-score-date history for an older
            // date at all. That leaves blank cells and a named skip; it must
            // never abandon the dates that follow.
            Err(error) => summary.skip(&entry.date, format!("{error:#}")),
        }
    }

    summary.verify_accounted()?;

    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn written(date: &str) -> WrittenSidecar {
        WrittenSidecar {
            date: date.to_string(),
            path: format!("docs/scores/{date}-picks.csv"),
        }
    }

    fn skipped(date: &str, reason: &str) -> SkippedDate {
        SkippedDate {
            date: date.to_string(),
            reason: reason.to_string(),
        }
    }

    #[test]
    fn render_reports_the_counts_and_names_every_skip_with_its_reason() {
        let summary = BackfillSummary {
            considered: vec!["2024-10-15".to_string(), "2024-10-16".to_string()],
            written: vec![written("2024-10-16")],
            skipped: vec![skipped(
                "2024-10-15",
                "no market data before the score date",
            )],
        };

        let report = summary.render();
        assert!(report.contains("dates considered: 2"), "{report}");
        assert!(report.contains("sidecars written: 1"), "{report}");
        assert!(report.contains("dates skipped:    1"), "{report}");
        assert!(report.contains("2024-10-15"), "{report}");
        assert!(
            report.contains("no market data before the score date"),
            "{report}"
        );
    }

    #[test]
    fn verify_accounted_passes_when_every_date_is_written_or_skipped() {
        let summary = BackfillSummary {
            considered: vec!["2024-10-15".to_string(), "2024-10-16".to_string()],
            written: vec![written("2024-10-16")],
            skipped: vec![skipped("2024-10-15", "no market data")],
        };

        assert!(summary.unaccounted().is_empty());
        assert!(summary.verify_accounted().is_ok());
    }

    #[test]
    fn verify_accounted_fails_loud_on_a_date_in_neither_list() {
        let summary = BackfillSummary {
            considered: vec!["2024-10-15".to_string(), "2024-10-16".to_string()],
            written: vec![written("2024-10-16")],
            skipped: Vec::new(),
        };

        assert_eq!(summary.unaccounted(), vec!["2024-10-15".to_string()]);
        let error = summary
            .verify_accounted()
            .expect_err("an unaccounted date must fail loud");
        assert!(
            error.to_string().contains("2024-10-15"),
            "the error must name the offender, got: {error}"
        );
    }
}
