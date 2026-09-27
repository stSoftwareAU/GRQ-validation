//! Pins the one-concern-per-module layout split out of `src/utils.rs` (issue
//! #882), and that `utils` still re-exports every moved item so existing call
//! sites keep compiling during the transition.

use chrono::NaiveDate;
use grq_validation::models::DailyMarketPoint;
use grq_validation::{data_roots, dividends, index, market_data, performance, splits, utils};
use std::collections::HashMap;
use std::path::Path;

fn point(high: f64, split_coefficient: f64) -> DailyMarketPoint {
    DailyMarketPoint {
        high,
        low: high,
        split_coefficient,
        volume: None,
    }
}

#[test]
fn splits_module_computes_a_clean_two_for_one_split() {
    let mut series = HashMap::new();
    series.insert("2024-12-14".to_string(), point(110.0, 1.0));
    series.insert("2024-12-15".to_string(), point(55.0, 2.0));
    let from = NaiveDate::from_ymd_opt(2024, 11, 15).unwrap();

    let adjustment = splits::compute_split_adjustment(&series, from);

    assert!(adjustment.reliable);
    assert!((adjustment.factor - 2.0).abs() < 1e-9);
    assert_eq!(utils::compute_split_adjustment(&series, from), adjustment);
}

#[test]
fn splits_module_treats_an_empty_series_as_no_split() {
    let from = NaiveDate::from_ymd_opt(2024, 11, 15).unwrap();
    assert_eq!(
        splits::compute_split_adjustment(&HashMap::new(), from),
        splits::SplitAdjustment::NONE
    );
}

#[test]
fn market_data_module_derives_the_csv_path_and_rejects_traversal() {
    let score = "docs/scores/2025/June/20.tsv";
    assert_eq!(
        market_data::derive_csv_output_path(score),
        "docs/scores/2025/June/20.csv"
    );
    assert_eq!(
        utils::derive_csv_output_path(score),
        market_data::derive_csv_output_path(score)
    );
    assert!(market_data::get_market_data_path_in(Path::new("/root"), "../etc").is_err());
}

#[test]
fn dividends_module_derives_the_csv_path_and_rejects_traversal() {
    let score = "docs/scores/2025/June/20.tsv";
    assert_eq!(
        dividends::derive_dividend_csv_output_path(score),
        "docs/scores/2025/June/20-dividends.csv"
    );
    assert_eq!(
        utils::derive_dividend_csv_output_path(score),
        dividends::derive_dividend_csv_output_path(score)
    );
    assert!(dividends::get_dividend_data_path_in(Path::new("/root"), "/etc/hosts").is_err());
}

#[test]
fn performance_module_annualises_and_gates_priceability() {
    assert_eq!(performance::calculate_annualized_performance(10.0, 0), 0.0);
    let annualised = performance::calculate_annualized_performance(10.0, 365);
    assert!((annualised - utils::calculate_annualized_performance(10.0, 365)).abs() < 1e-12);
    assert!(annualised > 9.9 && annualised < 10.1);

    assert!(performance::is_priceable(10.0, 11.0, true, 0.5));
    assert!(!performance::is_priceable(10.0, 11.0, false, 0.5));
    assert!(!performance::is_priceable(0.0, 11.0, true, 0.5));
}

#[test]
fn index_module_builds_score_paths_inside_the_scores_root() {
    assert_eq!(
        index::build_score_file_path("docs", "2025/June/20.tsv").unwrap(),
        "docs/scores/2025/June/20.tsv"
    );
    assert!(index::build_score_file_path("docs", "../secret.tsv").is_err());
    assert!(utils::build_score_file_path("docs", "").is_err());
}

#[test]
fn index_module_fails_loud_on_a_missing_index() {
    let dir = tempfile::tempdir().unwrap();
    assert!(index::read_index_json(dir.path().to_str().unwrap()).is_err());
}

#[test]
fn data_roots_module_owns_the_root_environment_variables() {
    assert_eq!(
        data_roots::MARKET_DATA_ROOT_ENV,
        utils::MARKET_DATA_ROOT_ENV
    );
    assert_eq!(data_roots::DIVIDEND_DATA_ROOT_ENV, "GRQ_DIVIDEND_DATA_PATH");

    let dir = tempfile::tempdir().unwrap();
    assert!(data_roots::ensure_market_data_repository_at(dir.path()).is_err());
    std::fs::create_dir(dir.path().join("data")).unwrap();
    assert!(data_roots::ensure_market_data_repository_at(dir.path()).is_ok());
}
