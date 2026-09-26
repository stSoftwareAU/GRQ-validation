//! The `docs/index.json` score index: reading it, resolving score-file paths
//! safely inside the scores root, and writing performance metrics back.

use crate::market_data::{derive_csv_output_path, read_market_data_from_csv};
use crate::models::{IndexData, PortfolioPerformance};
use crate::performance::{calculate_hybrid_projection, calculate_portfolio_performance};
use crate::utils::read_tsv_score_file;
use anyhow::{anyhow, Result};
use chrono::NaiveDate;
use std::path::Path;

/// Reads `<docs_path>/scores/index.json` and returns its entries sorted by date.
///
/// # Errors
///
/// Returns an error if the index file cannot be read or does not contain valid
/// JSON matching [`IndexData`].
pub fn read_index_json(docs_path: &str) -> Result<IndexData> {
    use std::fs;
    use std::path::Path;

    let index_path = Path::new(docs_path).join("scores").join("index.json");
    let content = fs::read_to_string(index_path)?;
    let mut index_data: IndexData = serde_json::from_str(&content)?;

    // Sort the scores by date to ensure chronological order
    index_data.scores.sort_by(|a, b| {
        // Parse dates and compare them
        if let (Ok(date_a), Ok(date_b)) = (
            NaiveDate::parse_from_str(&a.date, "%Y-%m-%d"),
            NaiveDate::parse_from_str(&b.date, "%Y-%m-%d"),
        ) {
            date_a.cmp(&date_b)
        } else {
            // Fallback to string comparison if date parsing fails
            a.date.cmp(&b.date)
        }
    });

    Ok(index_data)
}

/// Builds the on-disk path for a score file, guarding against path traversal.
///
/// The `file` field originates from `docs/scores/index.json`, which can be
/// influenced by contributors or upstream tooling. To stop a crafted entry
/// such as `"../../../tmp/evil"` escaping the intended `docs/scores/`
/// directory, this rejects any `file` value that is absolute or that contains
/// a parent-directory (`..`) segment before joining. With neither present, the
/// joined path is lexically guaranteed to stay within `<docs_path>/scores`.
/// Mirrors the containment guard in `helpers/server.ts::getFilePath`.
///
/// # Errors
///
/// Returns an error if `file` is empty, absolute, or contains a
/// parent-directory (`..`) segment.
pub fn build_score_file_path(docs_path: &str, file: &str) -> Result<String> {
    use std::path::Component;

    if file.trim().is_empty() {
        return Err(anyhow!("Refusing empty score file path"));
    }

    let candidate = Path::new(file);

    // Build within the scores root via join rather than string concatenation,
    // keeping only normal segments. Any `..`, root, or prefix component is a
    // traversal attempt and is rejected.
    let mut full_path = Path::new(docs_path).join("scores");
    for component in candidate.components() {
        match component {
            Component::ParentDir => {
                return Err(anyhow!(
                    "Refusing score file path with parent-directory segment: {file:?}"
                ));
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err(anyhow!("Refusing absolute score file path: {file:?}"));
            }
            // `.` adds nothing; normal segments extend the path.
            Component::CurDir => {}
            Component::Normal(segment) => full_path.push(segment),
        }
    }

    Ok(full_path.to_string_lossy().into_owned())
}

/// Updates the index.json file with performance metrics, reading dividends from
/// the caller-supplied `dividend_root` (issue #803).
///
/// # Errors
///
/// Returns an error if the index file cannot be read, or if the updated index
/// cannot be serialised or written back to disk.
pub fn update_index_with_performance(dividend_root: &Path, docs_path: &str) -> Result<()> {
    let mut index_data = read_index_json(docs_path)?;

    for score_entry in &mut index_data.scores {
        let score_file_path = match build_score_file_path(docs_path, &score_entry.file) {
            Ok(path) => path,
            Err(e) => {
                println!(
                    "Warning: Skipping unsafe score file path {}: {}",
                    score_entry.file, e
                );
                continue;
            }
        };

        // Only calculate performance for files that are at least 90 days old
        let score_date = NaiveDate::parse_from_str(&score_entry.date, "%Y-%m-%d")?;
        let current_date = chrono::Utc::now().naive_utc().date();
        let days_since_score = (current_date - score_date).num_days();

        if days_since_score >= 90 {
            match calculate_portfolio_performance(
                dividend_root,
                &score_file_path,
                &score_entry.date,
            ) {
                Ok(performance) => {
                    score_entry.performance_90_day = Some(performance.performance_90_day);
                    score_entry.performance_annualized = Some(performance.performance_annualized);
                    score_entry.total_stocks = Some(performance.total_stocks);
                }
                Err(e) => {
                    println!(
                        "Warning: Could not calculate performance for {}: {}",
                        score_entry.file, e
                    );
                }
            }
        } else {
            // For scores less than 90 days old, use hybrid projection
            match read_tsv_score_file(&score_file_path) {
                Ok(stock_records) => {
                    match read_market_data_from_csv(&derive_csv_output_path(&score_file_path)) {
                        Ok(market) => {
                            match calculate_hybrid_projection(
                                dividend_root,
                                &stock_records,
                                &score_entry.date,
                                &market.closes,
                            ) {
                                Ok(performance) => {
                                    score_entry.performance_90_day =
                                        Some(performance.performance_90_day);
                                    score_entry.performance_annualized =
                                        Some(performance.performance_annualized);
                                    score_entry.total_stocks = Some(performance.total_stocks);
                                }
                                Err(e) => {
                                    println!(
                                        "Warning: Could not calculate hybrid projection for {}: {}",
                                        score_entry.file, e
                                    );
                                }
                            }
                        }
                        Err(e) => {
                            println!(
                                "Warning: Could not read market data CSV for {}: {}",
                                score_entry.file, e
                            );
                        }
                    }
                }
                Err(e) => {
                    println!(
                        "Warning: Could not read TSV file for {}: {}",
                        score_entry.file, e
                    );
                }
            }
        }
    }

    // Write updated index back to file
    let index_path = Path::new(docs_path).join("scores").join("index.json");
    let json_content = serde_json::to_string_pretty(&index_data)?;
    std::fs::write(index_path, json_content)?;

    Ok(())
}

/// Records `performance` against the index entry for `date` and writes
/// `<docs_path>/scores/index.json` back.
///
/// # Errors
///
/// Returns an error if the index cannot be read or written, or if no entry
/// matches `date` (the index is then left untouched).
pub fn write_score_performance(
    docs_path: &str,
    date: &str,
    performance: &PortfolioPerformance,
) -> Result<()> {
    let mut index_data = read_index_json(docs_path)?;
    let entry = index_data
        .scores
        .iter_mut()
        .find(|entry| entry.date == date)
        .ok_or_else(|| anyhow!("no index.json entry for score date {date}"))?;
    entry.performance_90_day = Some(performance.performance_90_day);
    entry.performance_annualized = Some(performance.performance_annualized);
    entry.total_stocks = Some(performance.total_stocks);

    let index_path = Path::new(docs_path).join("scores").join("index.json");
    std::fs::write(index_path, serde_json::to_string_pretty(&index_data)?)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_score_file_path_valid() {
        // A normal nested score file resolves within docs/scores.
        let path = build_score_file_path("docs", "2025/June/20.tsv").unwrap();
        assert_eq!(path, "docs/scores/2025/June/20.tsv");

        // A leading "./" is harmless and stays contained.
        let path = build_score_file_path("docs", "./2025/June/20.tsv").unwrap();
        assert_eq!(path, "docs/scores/2025/June/20.tsv");
    }

    #[test]
    fn test_build_score_file_path_rejects_parent_traversal() {
        let err = build_score_file_path("docs", "../../../../tmp/evil.csv").unwrap_err();
        assert!(err.to_string().contains("parent-directory"));

        // Traversal hidden mid-path is also rejected.
        assert!(build_score_file_path("docs", "2025/../../etc/passwd").is_err());
    }

    #[test]
    fn test_build_score_file_path_rejects_absolute() {
        let err = build_score_file_path("docs", "/etc/passwd").unwrap_err();
        assert!(err.to_string().contains("absolute"));
    }

    #[test]
    fn test_build_score_file_path_rejects_empty() {
        assert!(build_score_file_path("docs", "").is_err());
        assert!(build_score_file_path("docs", "   ").is_err());
    }

    /// Writes a two-entry index under `<tmp>/scores/index.json`.
    fn seed_index(docs: &Path) {
        let scores = docs.join("scores");
        std::fs::create_dir_all(&scores).unwrap();
        let json = r#"{"scores":[
            {"year":"2025","month":"June","day":"20","file":"2025/June/20.tsv","date":"2025-06-20"},
            {"year":"2025","month":"June","day":"21","file":"2025/June/21.tsv","date":"2025-06-21",
             "performance_90_day":1.5,"performance_annualized":6.0,"total_stocks":3}
        ]}"#;
        std::fs::write(scores.join("index.json"), json).unwrap();
    }

    fn sample_performance(date: &str) -> PortfolioPerformance {
        PortfolioPerformance {
            score_date: date.to_string(),
            total_stocks: 7,
            performance_90_day: 12.25,
            performance_annualized: 55.5,
            individual_performances: Vec::new(),
            excluded_tickers: Vec::new(),
        }
    }

    #[test]
    fn test_write_score_performance_updates_matching_entry_only() {
        let tmp = tempfile::tempdir().unwrap();
        seed_index(tmp.path());
        let docs = tmp.path().to_str().unwrap();

        write_score_performance(docs, "2025-06-20", &sample_performance("2025-06-20")).unwrap();

        let index = read_index_json(docs).unwrap();
        let updated = index
            .scores
            .iter()
            .find(|s| s.date == "2025-06-20")
            .unwrap();
        assert_eq!(updated.performance_90_day, Some(12.25));
        assert_eq!(updated.performance_annualized, Some(55.5));
        assert_eq!(updated.total_stocks, Some(7));

        // The neighbouring entry keeps its existing figures.
        let other = index
            .scores
            .iter()
            .find(|s| s.date == "2025-06-21")
            .unwrap();
        assert_eq!(other.performance_90_day, Some(1.5));
        assert_eq!(other.performance_annualized, Some(6.0));
        assert_eq!(other.total_stocks, Some(3));
    }

    #[test]
    fn test_write_score_performance_overwrites_existing_figures() {
        let tmp = tempfile::tempdir().unwrap();
        seed_index(tmp.path());
        let docs = tmp.path().to_str().unwrap();

        write_score_performance(docs, "2025-06-21", &sample_performance("2025-06-21")).unwrap();

        let index = read_index_json(docs).unwrap();
        let updated = index
            .scores
            .iter()
            .find(|s| s.date == "2025-06-21")
            .unwrap();
        assert_eq!(updated.performance_90_day, Some(12.25));
        assert_eq!(updated.total_stocks, Some(7));
    }

    #[test]
    fn test_write_score_performance_unknown_date_fails_loud_and_leaves_index() {
        let tmp = tempfile::tempdir().unwrap();
        seed_index(tmp.path());
        let docs = tmp.path().to_str().unwrap();
        let index_path = tmp.path().join("scores").join("index.json");
        let before = std::fs::read_to_string(&index_path).unwrap();

        let err = write_score_performance(docs, "1999-01-01", &sample_performance("1999-01-01"))
            .unwrap_err();
        assert!(err.to_string().contains("1999-01-01"), "got: {err}");

        assert_eq!(std::fs::read_to_string(&index_path).unwrap(), before);
    }

    #[test]
    fn test_write_score_performance_missing_index_errors() {
        let tmp = tempfile::tempdir().unwrap();
        let docs = tmp.path().to_str().unwrap();

        assert!(
            write_score_performance(docs, "2025-06-20", &sample_performance("2025-06-20")).is_err()
        );
    }

    #[test]
    fn test_read_index_json() {
        let result = read_index_json("docs");
        if result.is_err() {
            // If the file doesn't exist, that's okay for now
            println!("Index file not found, skipping test");
            return;
        }

        let index_data = result.unwrap();
        assert!(!index_data.scores.is_empty());

        // Check that we have the expected dates
        let dates: Vec<&str> = index_data.scores.iter().map(|s| s.date.as_str()).collect();
        assert!(dates.contains(&"2025-06-20"));
        assert!(dates.contains(&"2025-06-21"));

        // Verify that dates are sorted chronologically
        for i in 1..index_data.scores.len() {
            let prev_date =
                NaiveDate::parse_from_str(&index_data.scores[i - 1].date, "%Y-%m-%d").unwrap();
            let curr_date =
                NaiveDate::parse_from_str(&index_data.scores[i].date, "%Y-%m-%d").unwrap();
            assert!(
                prev_date <= curr_date,
                "Dates are not sorted: {} should come before {}",
                index_data.scores[i - 1].date,
                index_data.scores[i].date
            );
        }
    }
}
