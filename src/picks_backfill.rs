//! Backfill of the pick-details sidecar across the whole score history
//! (issue #839, sub-issue of #835).
//!
//! [`crate::picks_sidecar`] emits `<date>-picks.csv` for the dates a normal run
//! selects — recent ones. The dashboard's whole point is reviewing *past*
//! picks, and `docs/scores/index.json` lists dates back to 2024, so without a
//! backfill every historical date would show blank pick-detail columns.
//!
//! This module is that backfill: it walks **every** entry in the index —
//! including dates far older than the 180-day cutoff `--process-all` exists to
//! bypass — and rewrites only the sidecar, touching neither the market-data CSV
//! nor the dividend CSV nor the computed performance figures.
//!
//! Two rules shape it:
//!
//! - **An upstream gap is a skip, never an abort.** An old date whose symbols
//!   have no pre-score-date history yields a sidecar with no rows (blank cells
//!   on the dashboard) and the run carries on to the next date.
//! - **Every date is accounted for.** A silent partial backfill is the failure
//!   mode to avoid, so each date lands in the summary as either written or
//!   skipped-with-a-reason, and a run that writes nothing at all fails loud
//!   rather than reporting a clean, empty success.

use crate::models::ScoreEntry;
use crate::picks_sidecar::create_picks_sidecar_csv_for_score_file;
use crate::utils::{build_score_file_path, extract_ticker_codes_from_score_file, read_index_json};
use anyhow::{anyhow, Result};
use std::path::Path;

/// What the backfill did with one score date.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DateOutcome {
    /// The sidecar was rewritten at this path.
    Written(String),
    /// No sidecar rows were produced; the reason is reported verbatim.
    Skipped(String),
}

/// One score date and its outcome.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DateResult {
    /// Score date in `YYYY-MM-DD` form, as listed in the index.
    pub date: String,
    /// What the backfill did with it.
    pub outcome: DateOutcome,
}

/// Every date the backfill visited, in index order.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct BackfillSummary {
    /// One entry per date processed.
    pub results: Vec<DateResult>,
}

impl BackfillSummary {
    /// Dates visited.
    #[must_use]
    pub fn processed(&self) -> usize {
        self.results.len()
    }

    /// Dates whose sidecar was rewritten.
    #[must_use]
    pub fn written(&self) -> usize {
        self.results
            .iter()
            .filter(|result| matches!(result.outcome, DateOutcome::Written(_)))
            .count()
    }

    /// Dates that produced no sidecar rows, each with its reason.
    #[must_use]
    pub fn skipped(&self) -> Vec<&DateResult> {
        self.results
            .iter()
            .filter(|result| matches!(result.outcome, DateOutcome::Skipped(_)))
            .collect()
    }

    /// The operator-visible end-of-run report: the counts, then every skipped
    /// date and why. A date missing from both halves means the walk over the
    /// index itself is broken.
    #[must_use]
    pub fn render(&self) -> String {
        let skipped = self.skipped();
        let mut report = format!(
            "Pick-details backfill: {processed} date(s) processed, {written} sidecar(s) written, \
             {skipped_count} skipped",
            processed = self.processed(),
            written = self.written(),
            skipped_count = skipped.len()
        );

        if skipped.is_empty() {
            return report;
        }

        report.push_str("\nSkipped dates (no sidecar rows written):");
        for result in skipped {
            if let DateOutcome::Skipped(reason) = &result.outcome {
                report.push_str(&format!("\n  {date} — {reason}", date = result.date));
            }
        }
        report
    }

    /// Confirms the backfill actually did something.
    ///
    /// # Errors
    ///
    /// Returns an error when dates were processed but not one sidecar was
    /// written — a whole-history run that produced nothing is a broken data
    /// root, not a clean pass.
    pub fn ensure_progress(&self) -> Result<()> {
        if self.processed() > 0 && self.written() == 0 {
            return Err(anyhow!(
                "No pick-details sidecars were written for any of the {processed} date(s) \
                 processed — is the market-data root available and up to date?",
                processed = self.processed()
            ));
        }
        Ok(())
    }
}

/// Rewrites the pick-details sidecar for every date in
/// `<docs_path>/scores/index.json`, or for `only_date` alone when one is given.
///
/// Nothing else is regenerated: the market-data CSV, the dividend CSV and the
/// index's performance figures are left exactly as committed.
///
/// # Errors
///
/// Returns an error if the index cannot be read, or if `only_date` names a date
/// the index does not list — a typo must never pass vacuously. A per-date fault
/// is recorded as a skip in the returned summary rather than aborting the run;
/// call [`BackfillSummary::ensure_progress`] to fail loud on a run that wrote
/// nothing at all.
pub fn backfill_picks_sidecars(
    market_root: &Path,
    docs_path: &str,
    only_date: Option<&str>,
) -> Result<BackfillSummary> {
    let index_data = read_index_json(docs_path)?;

    let entries: Vec<&ScoreEntry> = index_data
        .scores
        .iter()
        .filter(|entry| match only_date {
            Some(date) => entry.date == date,
            None => true,
        })
        .collect();

    if let Some(date) = only_date {
        if entries.is_empty() {
            return Err(anyhow!(
                "{date} is not listed in {docs_path}/scores/index.json"
            ));
        }
    }

    let results = entries
        .into_iter()
        .map(|entry| DateResult {
            date: entry.date.clone(),
            outcome: backfill_one_date(market_root, docs_path, entry),
        })
        .collect();

    Ok(BackfillSummary { results })
}

/// Rewrites one date's sidecar, turning every fault into a reported skip.
fn backfill_one_date(market_root: &Path, docs_path: &str, entry: &ScoreEntry) -> DateOutcome {
    let score_file_path = match build_score_file_path(docs_path, &entry.file) {
        Ok(path) => path,
        Err(error) => {
            return DateOutcome::Skipped(format!(
                "unusable score file path {file:?}: {error}",
                file = entry.file
            ))
        }
    };

    if !Path::new(&score_file_path).exists() {
        return DateOutcome::Skipped(format!("score file {score_file_path} is missing"));
    }

    let tickers = match extract_ticker_codes_from_score_file(&score_file_path) {
        Ok(tickers) => tickers,
        Err(error) => {
            return DateOutcome::Skipped(format!("cannot read {score_file_path}: {error}"))
        }
    };

    if tickers.is_empty() {
        return DateOutcome::Skipped(format!("{score_file_path} lists no tickers"));
    }

    match create_picks_sidecar_csv_for_score_file(
        market_root,
        &score_file_path,
        &tickers,
        &entry.date,
    ) {
        Ok(output_path) => DateOutcome::Written(output_path),
        // The sidecar writer already left blank cells (a rows-free file) where
        // it could; the run continues and the operator sees the date named.
        Err(error) => DateOutcome::Skipped(format!("{error}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn result(date: &str, outcome: DateOutcome) -> DateResult {
        DateResult {
            date: date.to_string(),
            outcome,
        }
    }

    #[test]
    fn render_counts_every_date_and_names_each_skip() {
        let summary = BackfillSummary {
            results: vec![
                result("2024-10-15", DateOutcome::Written("15-picks.csv".into())),
                result("2025-08-10", DateOutcome::Skipped("score file missing".into())),
            ],
        };

        let report = summary.render();
        assert!(report.contains("2 date(s) processed"), "{report}");
        assert!(report.contains("1 sidecar(s) written"), "{report}");
        assert!(report.contains("1 skipped"), "{report}");
        assert!(
            report.contains("2025-08-10 — score file missing"),
            "every skipped date must be named with its reason, got: {report}"
        );
    }

    #[test]
    fn render_omits_the_skip_list_when_nothing_was_skipped() {
        let summary = BackfillSummary {
            results: vec![result("2024-10-15", DateOutcome::Written("15-picks.csv".into()))],
        };

        assert!(!summary.render().contains("Skipped dates"));
    }

    #[test]
    fn ensure_progress_fails_loud_when_no_date_produced_a_sidecar() {
        let summary = BackfillSummary {
            results: vec![result("2024-10-15", DateOutcome::Skipped("no data".into()))],
        };

        assert!(
            summary.ensure_progress().is_err(),
            "a run that wrote nothing must not report success"
        );
    }

    #[test]
    fn ensure_progress_accepts_a_run_with_at_least_one_sidecar() {
        let summary = BackfillSummary {
            results: vec![
                result("2024-10-15", DateOutcome::Written("15-picks.csv".into())),
                result("2025-08-10", DateOutcome::Skipped("score file missing".into())),
            ],
        };

        assert!(summary.ensure_progress().is_ok());
        assert_eq!(summary.processed(), 2);
        assert_eq!(summary.written(), 1);
        assert_eq!(summary.skipped().len(), 1);
    }

    #[test]
    fn ensure_progress_accepts_an_empty_run() {
        assert!(BackfillSummary::default().ensure_progress().is_ok());
    }
}
