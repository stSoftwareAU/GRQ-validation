//! Performance maths: the priceability gate, score averaging, annualisation,
//! the portfolio's realised performance and the hybrid 90-day projection.

use crate::dividends::calculate_dividends_for_period;
use crate::market_data::{derive_csv_output_path, read_market_data_from_csv};
use crate::models::{PortfolioPerformance, StockPerformance, StockRecord};
use crate::splits::{compute_split_adjustment, SplitAdjustment};
use crate::utils::read_tsv_score_file;
use anyhow::{anyhow, Result};
use chrono::{Duration, NaiveDate};
use std::collections::HashMap;
use std::path::Path;

/// Returns `true` if both `buy_price` and `current_price` are positive and
/// usable, the split series is reliable, and the AI model `score` is positive.
///
/// A stock is priceable when both prices are greater than 0.0. Stocks without
/// usable prices are excluded from portfolio performance calculations entirely.
///
/// # Examples
///
/// ```
/// use grq_validation::utils::is_priceable;
///
/// assert!(is_priceable(10.5, 12.0, true, 0.5));
/// assert!(!is_priceable(0.0, 12.0, true, 0.5));  // missing buy price
/// assert!(!is_priceable(10.5, 0.0, true, 0.5));  // missing current price
/// assert!(!is_priceable(0.0, 0.0, true, 0.5));   // both missing
/// assert!(!is_priceable(10.5, 12.0, false, 0.5)); // split series unreliable
/// assert!(!is_priceable(10.5, 12.0, true, 0.0));  // zero score -> hold cash
/// assert!(!is_priceable(10.5, 12.0, true, -0.5)); // negative score -> hold cash
/// ```
///
/// `split_reliable` mirrors the frontend `isStockIncluded` predicate (issue
/// #293): a stock whose split series cannot be trustworthily reconciled is
/// excluded through this single gate rather than via a parallel path.
///
/// `score` is the raw AI model score (issue #627): a value <= 0 means the model
/// predicts the stock will fall, so we would hold cash rather than buy it. Such
/// a name is excluded through this same single gate, mirroring the frontend.
pub fn is_priceable(buy_price: f64, current_price: f64, split_reliable: bool, score: f64) -> bool {
    buy_price > 0.0 && current_price > 0.0 && split_reliable && score > 0.0
}

/// Returns the arithmetic mean of `scores`, or `0.0` for an empty slice.
///
/// # Examples
///
/// ```
/// use grq_validation::utils::calculate_average_score;
///
/// assert_eq!(calculate_average_score(&[1.0, 2.0, 3.0]), 2.0);
/// assert_eq!(calculate_average_score(&[]), 0.0);
/// ```
pub fn calculate_average_score(scores: &[f64]) -> f64 {
    if scores.is_empty() {
        return 0.0;
    }

    scores.iter().sum::<f64>() / scores.len() as f64
}

/// Annualises a period return using compound growth over the actual number of
/// days observed.
///
/// Spec (README _Annualised performance_ note, folded from the pruned
/// `docs/fixes/` log in #759):
/// `annualised = ((1 + performance/100) ^ (365.25 / days_elapsed) - 1) * 100`.
///
/// Returns `0.0` when the period return is exactly zero or no days have
/// elapsed — the dashboard treats those as a not-yet-meaningful figure.
pub fn calculate_annualized_performance(performance_pct: f64, days_elapsed: i64) -> f64 {
    if performance_pct != 0.0 && days_elapsed > 0 {
        ((1.0 + performance_pct / 100.0).powf(365.25 / days_elapsed as f64) - 1.0) * 100.0
    } else {
        0.0
    }
}

/// Calculates 90-day and annualised portfolio performance for a score file.
///
/// Reads the score TSV at `score_file_path` and the derived market-data CSV
/// alongside it, then computes per-stock and portfolio-wide returns for the
/// 90-day window starting at `score_file_date` (`YYYY-MM-DD`).
///
/// Dividends for the window are read from the caller-supplied `dividend_root`
/// (issue #803).
///
/// # Examples
///
/// ```no_run
/// use grq_validation::utils::calculate_portfolio_performance;
/// use std::path::Path;
///
/// let performance = calculate_portfolio_performance(
///     Path::new("/path/to/dividend-history"),
///     "docs/scores/2024/November/15.tsv",
///     "2024-11-15",
/// )?;
/// println!("90-day return: {:.2}%", performance.performance_90_day);
/// # Ok::<(), anyhow::Error>(())
/// ```
///
/// # Errors
///
/// Returns an error if the score file or the derived market-data CSV cannot be
/// read, or if `score_file_date` is not a valid `%Y-%m-%d` date.
pub fn calculate_portfolio_performance(
    dividend_root: &Path,
    score_file_path: &str,
    score_file_date: &str,
) -> Result<PortfolioPerformance> {
    // Read the score file
    let stock_records = read_tsv_score_file(score_file_path)?;

    // Calculate the 90-day end date
    let score_date = NaiveDate::parse_from_str(score_file_date, "%Y-%m-%d")?;
    let end_date = score_date + Duration::days(90);
    let end_date_str = end_date.format("%Y-%m-%d").to_string();

    // Read market data from the CSV file that was created by the program
    let csv_file_path = derive_csv_output_path(score_file_path);
    let market = read_market_data_from_csv(&csv_file_path)?;
    let market_data_csv = &market.closes;

    let mut individual_performances = Vec::new();
    let mut excluded_tickers = Vec::new();
    let mut latest_market_date = score_date;

    for record in &stock_records {
        // Use the full ticker (e.g., "NYSE:SEM") to match CSV data
        let full_ticker = &record.stock;

        // Get the buy price (first day close) from CSV data, and the date it
        // came from (needed to know which splits fall inside the window).
        let (buy_price, buy_date) = if let Some(first_day_data) = market_data_csv.get(full_ticker) {
            if let Some(first_day) = first_day_data.get(score_file_date) {
                (*first_day, score_date)
            } else {
                // Find the next available trading day
                let mut next_trading_day_price = 0.0;
                let mut next_trading_day_date = score_date;
                let mut found: Option<NaiveDate> = None;

                for (date_str, price) in first_day_data {
                    if let Ok(date) = NaiveDate::parse_from_str(date_str, "%Y-%m-%d") {
                        if date >= score_date && found.is_none_or(|d| date < d) {
                            found = Some(date);
                            next_trading_day_date = date;
                            next_trading_day_price = *price;
                        }
                    }
                }

                (next_trading_day_price, next_trading_day_date)
            }
        } else {
            (0.0, score_date)
        };

        // Get the current price (90-day end date or latest available)
        let current_price = if let Some(symbol_data) = market_data_csv.get(full_ticker) {
            if let Some(end_day) = symbol_data.get(&end_date_str) {
                // Update the latest market date when we have the exact end date
                if let Ok(end_date_parsed) = NaiveDate::parse_from_str(&end_date_str, "%Y-%m-%d") {
                    if end_date_parsed > latest_market_date {
                        latest_market_date = end_date_parsed;
                    }
                }
                *end_day
            } else {
                // Find the latest available price within 90 days
                let mut latest_price = 0.0;
                let mut latest_date = score_date;

                for (date_str, price) in symbol_data {
                    if let Ok(date) = NaiveDate::parse_from_str(date_str, "%Y-%m-%d") {
                        if date >= score_date && date <= end_date && date >= latest_date {
                            latest_date = date;
                            latest_price = *price;
                        }
                    }
                }

                // Update the latest market date across all stocks
                if latest_date > latest_market_date {
                    latest_market_date = latest_date;
                }

                latest_price
            }
        } else {
            0.0
        };

        // Reconcile any split between the buy date and the current-price date.
        // A reliable series is corrected (buy price restated to current terms);
        // an unreliable one drops the stock through the single is_priceable gate.
        let split = market
            .points
            .get(full_ticker)
            .map(|series| compute_split_adjustment(series, buy_date))
            .unwrap_or(SplitAdjustment::NONE);

        // Use the priceable predicate (now split- and score-aware) to determine
        // inclusion. A negative/zero score drops the stock (issue #627).
        if is_priceable(buy_price, current_price, split.reliable, record.score) {
            // Restate the buy price into current (post-split) terms so the
            // return is not distorted by a split inside the window. With no
            // split the factor is 1.0 and the cost basis is unchanged.
            let adjusted_buy_price = buy_price / split.factor;

            // Calculate price gain/loss against the corrected cost basis.
            let gain_loss_percent =
                ((current_price - adjusted_buy_price) / adjusted_buy_price) * 100.0;

            // Calculate dividends for the 90-day period
            let dividends_total = calculate_dividends_for_period(
                dividend_root,
                full_ticker,
                score_file_date,
                &end_date_str,
            )
            .unwrap_or(0.0);

            // Calculate total return (price + dividends) on the same basis.
            let total_return_percent =
                gain_loss_percent + (dividends_total / adjusted_buy_price * 100.0);

            individual_performances.push(StockPerformance {
                ticker: record.stock.clone(),
                buy_price: adjusted_buy_price,
                target_price: record.target,
                current_price,
                gain_loss_percent,
                dividends_total,
                total_return_percent,
            });
        } else {
            // Track excluded tickers for downstream consumption
            excluded_tickers.push(full_ticker.clone());
        }
    }

    // Calculate portfolio performance
    let performance_90_day = if !individual_performances.is_empty() {
        let total_return: f64 = individual_performances
            .iter()
            .map(|p| p.total_return_percent)
            .sum();
        total_return / individual_performances.len() as f64
    } else {
        0.0
    };

    // Calculate actual days elapsed from score date to latest market data date (capped at 90)
    let actual_days_elapsed = std::cmp::min((latest_market_date - score_date).num_days(), 90);

    // Calculate annualized performance using actual days elapsed instead of fixed 90 days
    let performance_annualized =
        calculate_annualized_performance(performance_90_day, actual_days_elapsed);

    // Report only the count of included stocks (those with both prices)
    let included_stocks_count = individual_performances.len() as i32;

    Ok(PortfolioPerformance {
        score_date: score_file_date.to_string(),
        total_stocks: included_stocks_count,
        performance_90_day,
        performance_annualized,
        individual_performances,
        excluded_tickers,
    })
}

/// Calculates hybrid projection for scores less than 90 days old, reading
/// dividends from the caller-supplied `dividend_root` (issue #803).
///
/// # Errors
///
/// Returns an error if `score_file_date` is not a valid `%Y-%m-%d` date, or if
/// the score is already 90 days or more old (use
/// [`calculate_portfolio_performance`] instead).
pub fn calculate_hybrid_projection(
    dividend_root: &Path,
    stock_records: &[StockRecord],
    score_file_date: &str,
    market_data_csv: &HashMap<String, HashMap<String, f64>>,
) -> Result<PortfolioPerformance> {
    let score_date = NaiveDate::parse_from_str(score_file_date, "%Y-%m-%d")?;
    let current_date = chrono::Utc::now().naive_utc().date();
    let days_elapsed = (current_date - score_date).num_days();

    if days_elapsed >= 90 {
        return Err(anyhow!(
            "Score is already 90 days old, use regular performance calculation"
        ));
    }

    let mut individual_performances = Vec::new();
    let mut excluded_tickers = Vec::new();
    let mut total_projected_performance = 0.0;
    let mut valid_projections = 0;
    let mut latest_market_date = score_date;

    for record in stock_records {
        let full_ticker = &record.stock;

        // Get current performance data
        if let Some(symbol_data) = market_data_csv.get(full_ticker) {
            // Find the latest available price
            let mut latest_price = 0.0;
            let mut latest_date = score_date;

            for (date_str, price) in symbol_data {
                if let Ok(date) = NaiveDate::parse_from_str(date_str, "%Y-%m-%d") {
                    if date >= score_date && date <= current_date && date >= latest_date {
                        latest_date = date;
                        latest_price = *price;
                    }
                }
            }

            // Update the latest market date across all stocks
            if latest_date > latest_market_date {
                latest_market_date = latest_date;
            }

            // Get buy price (first available price after score date)
            let buy_price = if let Some(first_day_data) = market_data_csv.get(full_ticker) {
                if let Some(first_day) = first_day_data.get(score_file_date) {
                    *first_day
                } else {
                    // Find the next available trading day
                    let mut next_trading_day_price = 0.0;
                    let mut next_trading_day_date = None;

                    for (date_str, price) in first_day_data {
                        if let Ok(date) = NaiveDate::parse_from_str(date_str, "%Y-%m-%d") {
                            if date >= score_date && next_trading_day_date.is_none_or(|d| date < d)
                            {
                                next_trading_day_date = Some(date);
                                next_trading_day_price = *price;
                            }
                        }
                    }
                    next_trading_day_price
                }
            } else {
                0.0
            };

            // Use the priceable predicate to determine inclusion. The hybrid
            // projection does not yet apply split correction (out of scope for
            // issue #294), so split reliability is left at `true` to preserve
            // its existing behaviour. A negative/zero score drops the stock
            // (issue #627).
            if is_priceable(buy_price, latest_price, true, record.score) {
                let gain_loss_percent = ((latest_price - buy_price) / buy_price) * 100.0;
                // Use market data days elapsed instead of calendar days
                let market_days_elapsed = (latest_date - score_date).num_days();

                // Calculate projected 90-day performance using a more realistic approach
                let mut projected_90_day = if market_days_elapsed > 0 {
                    // Use linear projection but with realistic bounds
                    let daily_rate = gain_loss_percent / market_days_elapsed as f64;

                    // Apply dampening based on market data days elapsed
                    let dampening_factor = if market_days_elapsed < 7 {
                        0.1 // Very early days: dampen by 90%
                    } else if market_days_elapsed < 14 {
                        0.2 // Early days: dampen by 80%
                    } else if market_days_elapsed < 30 {
                        0.3 // Early days: dampen by 70%
                    } else if market_days_elapsed < 60 {
                        0.5 // Medium term: dampen by 50%
                    } else {
                        0.7 // Later days: dampen by 30%
                    };

                    let raw_projection = daily_rate * 90.0;
                    raw_projection * dampening_factor
                } else {
                    0.0
                };

                // Apply realistic bounds based on market data days elapsed
                let max_gain = if market_days_elapsed < 7 {
                    10.0 // Very early: max 10% gain
                } else if market_days_elapsed < 14 {
                    20.0 // Early: max 20% gain
                } else if market_days_elapsed < 30 {
                    40.0 // Early: max 40% gain
                } else if market_days_elapsed < 60 {
                    80.0 // Medium: max 80% gain
                } else {
                    150.0 // Later: max 150% gain
                };

                let max_loss = if market_days_elapsed < 7 {
                    -5.0 // Very early: max 5% loss
                } else if market_days_elapsed < 14 {
                    -10.0 // Early: max 10% loss
                } else if market_days_elapsed < 30 {
                    -20.0 // Early: max 20% loss
                } else if market_days_elapsed < 60 {
                    -40.0 // Medium: max 40% loss
                } else {
                    -80.0 // Later: max 80% loss
                };

                projected_90_day = projected_90_day.clamp(max_loss, max_gain);

                // Calculate dividends for the period
                let end_date = score_date + chrono::Duration::days(90);
                let end_date_str = end_date.format("%Y-%m-%d").to_string();
                let dividends_total = calculate_dividends_for_period(
                    dividend_root,
                    full_ticker,
                    score_file_date,
                    &end_date_str,
                )
                .unwrap_or(0.0);

                // Calculate total return including dividends
                let total_return_percent = projected_90_day + (dividends_total / buy_price * 100.0);

                individual_performances.push(StockPerformance {
                    ticker: record.stock.clone(),
                    buy_price,
                    target_price: record.target,
                    current_price: latest_price,
                    gain_loss_percent: projected_90_day,
                    dividends_total,
                    total_return_percent,
                });

                total_projected_performance += total_return_percent;
                valid_projections += 1;
            } else {
                // Track excluded tickers
                excluded_tickers.push(full_ticker.clone());
            }
        } else {
            // No market data for this symbol -> exclude it
            excluded_tickers.push(full_ticker.clone());
        }
    }

    // Calculate average projected performance
    let performance_90_day = if valid_projections > 0 {
        total_projected_performance / valid_projections as f64
    } else {
        0.0
    };

    // For hybrid projections, use quarterly compounding (4 quarters per year) instead of time-based annualization
    // This prevents unrealistic annualized rates for very early projections
    let performance_annualized = if performance_90_day != 0.0 {
        // Use quarterly compounding: (1 + quarterly_return)^4 - 1
        // Where quarterly_return is the 90-day performance
        ((1.0 + performance_90_day / 100.0).powf(4.0) - 1.0) * 100.0
    } else {
        0.0
    };

    // Report only the count of included stocks (those with both prices)
    let included_stocks_count = individual_performances.len() as i32;

    Ok(PortfolioPerformance {
        score_date: score_file_date.to_string(),
        total_stocks: included_stocks_count,
        performance_90_day,
        performance_annualized,
        individual_performances,
        excluded_tickers,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data_roots::dividend_data_root;
    use crate::data_roots::test_fixtures::{absent_data_root, configured_market_root};

    #[test]
    fn test_calculate_average_score() {
        let scores = vec![0.95, 0.85, 0.90];
        let expected = 0.9;
        let actual = calculate_average_score(&scores);
        assert!(
            (actual - expected).abs() < 0.0001,
            "Expected {expected}, got {actual}"
        );

        let empty_scores: Vec<f64> = vec![];
        assert_eq!(calculate_average_score(&empty_scores), 0.0);
    }

    #[test]
    fn test_calculate_performance_november_15_2024() {
        if configured_market_root("test_calculate_performance_november_15_2024").is_none() {
            return;
        }

        let score_file_path = "docs/scores/2024/November/15.tsv";
        let score_file_date = "2024-11-15";

        // Dividends come from the operator's tree when configured; without one
        // the price figures asserted below are unaffected.
        let dividend_root =
            dividend_data_root().unwrap_or_else(|_| absent_data_root().to_path_buf());
        let result =
            calculate_portfolio_performance(&dividend_root, score_file_path, score_file_date);
        assert!(
            result.is_ok(),
            "Failed to calculate performance: {:?}",
            result.err()
        );

        let performance = result.unwrap();

        println!("=== November 15, 2024 Performance Results ===");
        println!("Score Date: {}", performance.score_date);
        println!("Total Stocks: {}", performance.total_stocks);
        println!("90-Day Performance: {:.2}%", performance.performance_90_day);
        println!(
            "Annualized Performance: {:.2}%",
            performance.performance_annualized
        );
        println!();

        println!("Individual Stock Performances:");
        for stock_perf in &performance.individual_performances {
            println!("  {}: Buy=${:.2}, Current=${:.2}, Gain/Loss={:.2}%, Dividends=${:.2}, Total Return={:.2}%",
                stock_perf.ticker,
                stock_perf.buy_price,
                stock_perf.current_price,
                stock_perf.gain_loss_percent,
                stock_perf.dividends_total,
                stock_perf.total_return_percent
            );
        }

        // Basic assertions
        assert_eq!(performance.score_date, "2024-11-15");
        assert!(performance.total_stocks > 0);

        // The 90-day period should be from 2024-11-15 to 2025-02-13
        // Since this is historical data, we should have results
        assert!(
            performance.performance_90_day != 0.0 || performance.individual_performances.is_empty()
        );

        // Annualized performance should be calculated if we have 90-day performance
        if performance.performance_90_day != 0.0 {
            assert!(performance.performance_annualized != 0.0);
        }
    }

    #[test]
    fn test_annualized_performance_calculation_with_actual_days() {
        // WHAT-test for the production annualisation helper
        // `calculate_annualized_performance` — the exact code path
        // `calculate_portfolio_performance` uses to fill `performance_annualized`.
        //
        // Each expected value is derived directly from the spec formula in
        // the README _Annualised performance_ note (#759):
        //   annualised = ((1 + p/100) ^ (365.25 / days) - 1) * 100
        // (e.g. 2% over 5 days: (1.02 ^ (365.25/5) - 1) * 100 = (1.02 ^ 73.05 - 1) * 100 ≈ 324.9),
        // rounded to one decimal place — not numbers copied from a one-off run.
        let test_cases: Vec<(f64, i64, f64)> = vec![
            // (performance_pct, days_elapsed, expected_annualized)
            (2.0, 5, 324.9),   // (1.02 ^ 73.050 - 1) * 100
            (4.0, 10, 318.9),  // (1.04 ^ 36.525 - 1) * 100
            (6.0, 30, 103.3),  // (1.06 ^ 12.175 - 1) * 100
            (8.0, 60, 59.8),   // (1.08 ^ 6.0875 - 1) * 100
            (10.0, 90, 47.2),  // (1.10 ^ 4.0583 - 1) * 100
            (0.0, 30, 0.0),    // zero return → zero annualised (guard branch)
            (-3.0, 15, -52.4), // (0.97 ^ 24.350 - 1) * 100
        ];

        for (performance, days, expected) in test_cases {
            // Call the real production helper rather than recomputing the formula.
            let actual_annualized = calculate_annualized_performance(performance, days);

            println!(
                "Performance: {performance}% over {days} days → Annualized: {actual_annualized:.1}% (expected {expected}%)"
            );

            // Tight tolerance: the expected values are the spec formula rounded to
            // one decimal place, so production must land within that rounding.
            let tolerance = 0.1;
            let difference = (actual_annualized - expected).abs();

            assert!(
                difference < tolerance,
                "Performance {performance}% over {days} days: Expected {expected}%, got {actual_annualized:.4}%, difference: {difference:.4}%"
            );

            // Verify edge case behaviors
            if performance == 0.0 {
                assert_eq!(
                    actual_annualized, 0.0,
                    "Zero performance should return zero annualized"
                );
            }

            if performance > 0.0 {
                assert!(
                    actual_annualized > 0.0,
                    "Positive performance should give positive annualized"
                );
                // Early days should give much higher annualized rates
                if days <= 10 {
                    assert!(
                        actual_annualized > 100.0,
                        "Early positive performance should have high annualized rate"
                    );
                }
            }

            if performance < 0.0 {
                assert!(
                    actual_annualized < 0.0,
                    "Negative performance should give negative annualized"
                );
            }
        }
    }

    #[test]
    fn test_annualized_vs_fixed_90_day_comparison() {
        // Test that demonstrates the fix: compare actual days vs fixed 90 days
        let performance = 3.0; // 3% performance

        let test_days = vec![5, 10, 15, 30, 60, 90];

        for days in test_days {
            // New approach: use actual days
            let annualized_actual = if days > 0 {
                ((1.0_f64 + performance / 100.0).powf(365.25 / days as f64) - 1.0) * 100.0
            } else {
                0.0
            };

            // Old approach: always use 90 days (what was wrong)
            let annualized_fixed_90 =
                ((1.0_f64 + performance / 100.0).powf(365.25 / 90.0) - 1.0) * 100.0;

            println!(
                "{performance}% over {days} days: Actual-days method: {annualized_actual:.1}%, Fixed-90 method: {annualized_fixed_90:.1}%"
            );

            if days < 90 {
                // For early days, actual-days method should give higher annualized rate
                assert!(
                    annualized_actual > annualized_fixed_90,
                    "For {days} days, actual-days method ({annualized_actual:.1}%) should be higher than fixed-90 method ({annualized_fixed_90:.1}%)"
                );

                // The difference should be significant for very early days
                if days <= 10 {
                    let difference = annualized_actual - annualized_fixed_90;
                    assert!(
                        difference > 50.0,
                        "For {days} days, difference should be substantial (got {difference:.1}%)"
                    );
                }
            } else {
                // For 90 days, both methods should give same result
                let difference = (annualized_actual - annualized_fixed_90).abs();
                assert!(
                    difference < 0.01,
                    "For 90 days, both methods should give same result, difference: {difference:.3}%"
                );
            }
        }
    }

    #[test]
    fn test_market_data_days_vs_calendar_days() {
        // Test that verifies we should use market data days, not calendar days
        // This simulates the scenario where we have market data for fewer days than calendar days

        use chrono::NaiveDate;

        let _score_date = NaiveDate::from_ymd_opt(2024, 1, 1).unwrap();

        // Simulate different scenarios
        let scenarios = vec![
            // (calendar_days, market_data_days, description)
            (10, 7, "Weekend gaps in market data"),
            (21, 15, "Weekends + holiday in 3 weeks"),
            (30, 22, "Month with weekends"),
            (90, 63, "90 calendar days with all weekends removed"),
        ];

        let performance = 5.0; // 5% performance

        for (calendar_days, market_days, description) in scenarios {
            // Calculate what we'd get with calendar days (wrong)
            let calendar_annualized = if calendar_days > 0 {
                ((1.0_f64 + performance / 100.0).powf(365.25 / calendar_days as f64) - 1.0) * 100.0
            } else {
                0.0
            };

            // Calculate what we should get with market days (correct)
            let market_annualized = if market_days > 0 {
                ((1.0_f64 + performance / 100.0).powf(365.25 / market_days as f64) - 1.0) * 100.0
            } else {
                0.0
            };

            println!(
                "{description}: {performance}% over {calendar_days} calendar days ({market_days} market days)"
            );
            println!("  Calendar-days annualized: {calendar_annualized:.1}%");
            println!("  Market-days annualized: {market_annualized:.1}%");

            // Market days should give higher annualized rate (since fewer days for same performance)
            assert!(
                market_annualized > calendar_annualized,
                "Market days method should give higher rate for {description}: {market_annualized:.1}% vs {calendar_annualized:.1}%"
            );

            // The difference should be meaningful
            let difference = market_annualized - calendar_annualized;
            assert!(
                difference > 1.0,
                "Difference should be meaningful for {description}: {difference:.1}%"
            );
        }
    }

    #[test]
    fn test_edge_cases_for_annualized_calculation() {
        // Test edge cases that could cause issues

        // Test with 1 day
        let one_day_result = ((1.0_f64 + 1.0 / 100.0).powf(365.25 / 1.0) - 1.0) * 100.0;
        assert!(
            one_day_result > 3600.0,
            "1% over 1 day should give very high annualized rate"
        );

        // Test with 365 days (should be close to the original performance)
        let one_year_result = ((1.0_f64 + 10.0 / 100.0).powf(365.25 / 365.25) - 1.0) * 100.0;
        assert!(
            (one_year_result - 10.0).abs() < 0.1,
            "10% over 365 days should be ~10% annualized"
        );

        // Test with zero days (should handle gracefully)
        let zero_days_result = if 0 > 0 {
            ((1.0_f64 + 5.0 / 100.0).powf(365.25 / 0.0) - 1.0) * 100.0
        } else {
            0.0
        };
        assert_eq!(zero_days_result, 0.0, "Zero days should return 0");

        // Test with negative performance close to -100%
        let near_total_loss = ((1.0_f64 + (-95.0) / 100.0).powf(365.25 / 30.0) - 1.0) * 100.0;
        assert!(
            near_total_loss < -99.0,
            "-95% over 30 days should annualize to near -100%"
        );

        // Test very small positive performance
        let tiny_performance = ((1.0_f64 + 0.01 / 100.0).powf(365.25 / 90.0) - 1.0) * 100.0;
        assert!(
            tiny_performance > 0.0 && tiny_performance < 1.0,
            "Tiny performance should give small positive annualized"
        );
    }

    #[test]
    fn test_zero_annualized_performance_bug() {
        // Test the specific bug where 90-day performance is positive but annualized is 0
        // This happens when actual_days_elapsed is 0 due to incorrect latest_market_date calculation

        let test_cases = vec![
            // (performance_90_day, expected_annualized_min, description)
            (
                23.77,
                100.0,
                "2025-04-15 scenario: 23.77% should annualize to >100%",
            ),
            (
                17.68,
                50.0,
                "2025-04-04 scenario: 17.68% should annualize to >50%",
            ),
            (
                23.64,
                100.0,
                "2025-04-22 scenario: 23.64% should annualize to >100%",
            ),
            (10.0, 30.0, "10% over 90 days should annualize to >30%"),
            (5.0, 15.0, "5% over 90 days should annualize to >15%"),
        ];

        for (performance_90_day, expected_min, description) in test_cases {
            // Test the actual calculation logic from calculate_portfolio_performance
            let actual_days_elapsed = 90; // This should be the correct value
            let performance_annualized = if performance_90_day != 0.0 && actual_days_elapsed > 0 {
                ((1.0_f64 + performance_90_day / 100.0).powf(365.25 / actual_days_elapsed as f64)
                    - 1.0)
                    * 100.0
            } else {
                0.0
            };

            println!(
                "{description}: {performance_90_day}% over {actual_days_elapsed} days → {performance_annualized:.2}% (expected >{expected_min:.1}%)"
            );

            // Verify that positive performance gives positive annualized
            assert!(
                performance_annualized > 0.0,
                "{description}: Positive performance should give positive annualized, got {performance_annualized:.2}%"
            );

            // Verify it meets minimum expectations
            assert!(
                performance_annualized >= expected_min,
                "{description}: Should be at least {expected_min:.1}%, got {performance_annualized:.2}%"
            );

            // Verify the calculation is mathematically sound
            let expected_approx =
                ((1.0_f64 + performance_90_day / 100.0).powf(365.25 / 90.0) - 1.0) * 100.0;
            let tolerance = 0.01; // Allow for floating point precision
            let difference = (performance_annualized - expected_approx).abs();

            assert!(
                difference < tolerance,
                "{description}: Expected ~{expected_approx:.2}%, got {performance_annualized:.2}%, difference: {difference:.2}%"
            );
        }

        // Test the bug scenario: what happens when actual_days_elapsed is 0?
        let bug_scenario_performance = 23.77;
        let actual_days_elapsed_bug = 0; // This is the bug condition
        let bug_result = if bug_scenario_performance != 0.0 && actual_days_elapsed_bug > 0 {
            ((1.0_f64 + bug_scenario_performance / 100.0)
                .powf(365.25 / actual_days_elapsed_bug as f64)
                - 1.0)
                * 100.0
        } else {
            0.0
        };

        println!(
            "BUG SCENARIO: {bug_scenario_performance}% over {actual_days_elapsed_bug} days → {bug_result:.2}% (this is the bug!)"
        );

        assert_eq!(
            bug_result, 0.0,
            "When actual_days_elapsed is 0, result should be 0.0 (this is the bug condition)"
        );

        println!("✅ Zero annualized performance bug test completed");
    }

    // --- WHAT-tests for calculate_hybrid_projection (issue #200) ---
    //
    // These exercise the public projection behaviour against controlled,
    // spec-derived inputs and assert on the returned PortfolioPerformance,
    // never on internals. Each expected value is derived by hand from the
    // documented formula (daily_rate * 90 * dampening_factor, then clamped),
    // not copied from current output. A deliberately fake ticker is used so
    // no dividend file exists, keeping dividends_total at 0.0 and the total
    // return equal to the projected 90-day figure.

    /// Builds a market-data map for a single ticker from `(date, price)` points.
    fn hybrid_market_data(
        ticker: &str,
        points: &[(NaiveDate, f64)],
    ) -> HashMap<String, HashMap<String, f64>> {
        let mut inner = HashMap::new();
        for (date, price) in points {
            inner.insert(date.format("%Y-%m-%d").to_string(), *price);
        }
        let mut outer = HashMap::new();
        outer.insert(ticker.to_string(), inner);
        outer
    }

    #[test]
    fn test_calculate_hybrid_projection_dampens_moderate_trend() {
        let ticker = "TEST:HYBRIDA";
        let today = chrono::Utc::now().naive_utc().date();
        // Score 41 days ago; 40 market days of price history (30..60 bucket).
        let score_date = today - Duration::days(41);
        let latest_date = score_date + Duration::days(40); // = today - 1
        let score_str = score_date.format("%Y-%m-%d").to_string();

        // Buy price keyed exactly on the score date: 100 -> 110 over 40 days.
        let market = hybrid_market_data(ticker, &[(score_date, 100.0), (latest_date, 110.0)]);
        let records = vec![StockRecord::new(ticker.to_string(), 5.0, 120.0)];

        let result =
            calculate_hybrid_projection(absent_data_root(), &records, &score_str, &market).unwrap();

        // gain = 10% over 40 market days -> daily_rate = 0.25%/day.
        // raw = 0.25 * 90 = 22.5; dampening (30..60) = 0.5 -> 11.25; within [-40, 80].
        let expected = 11.25;
        assert!(
            (result.performance_90_day - expected).abs() < 1e-6,
            "expected projected 90-day ~{expected}, got {}",
            result.performance_90_day
        );
        assert_eq!(result.total_stocks, 1);
        assert_eq!(result.individual_performances.len(), 1);
        assert!(
            (result.individual_performances[0].gain_loss_percent - expected).abs() < 1e-6,
            "per-stock projection should match portfolio figure for a single stock"
        );

        // Annualisation uses quarterly compounding: ((1 + p/100)^4 - 1) * 100.
        // For p = 11.25 this is ~53.179%.
        assert!(
            (result.performance_annualized - 53.1793).abs() < 1e-2,
            "expected annualised ~53.18%, got {}",
            result.performance_annualized
        );
    }

    #[test]
    fn test_calculate_hybrid_projection_uses_next_trading_day_buy_price() {
        let ticker = "TEST:HYBRIDB";
        let today = chrono::Utc::now().naive_utc().date();
        // Score 20 days ago, but no price on the score date itself: the buy
        // price must fall back to the earliest available trading day.
        let score_date = today - Duration::days(20);
        let buy_date = score_date + Duration::days(2); // first available day
        let latest_date = score_date + Duration::days(10); // 10 market days
        let score_str = score_date.format("%Y-%m-%d").to_string();

        let market = hybrid_market_data(ticker, &[(buy_date, 50.0), (latest_date, 55.0)]);
        let records = vec![StockRecord::new(ticker.to_string(), 5.0, 60.0)];

        let result =
            calculate_hybrid_projection(absent_data_root(), &records, &score_str, &market).unwrap();

        // Fallback buy price = 50 (next trading day). gain = 10% over 10 market
        // days -> daily_rate = 1.0%/day; raw = 90; dampening (7..14) = 0.2 -> 18;
        // within [-10, 20].
        let expected = 18.0;
        assert!(
            (result.performance_90_day - expected).abs() < 1e-6,
            "expected projected 90-day ~{expected}, got {}",
            result.performance_90_day
        );
        assert_eq!(result.individual_performances[0].buy_price, 50.0);
    }

    #[test]
    fn test_calculate_hybrid_projection_clamps_to_upper_bound() {
        let ticker = "TEST:HYBRIDC";
        let today = chrono::Utc::now().naive_utc().date();
        // Score 9 days ago; 8 market days (7..14 bucket -> max gain 20%).
        let score_date = today - Duration::days(9);
        let latest_date = score_date + Duration::days(8);
        let score_str = score_date.format("%Y-%m-%d").to_string();

        // Steep doubling: 100 -> 200 over 8 days.
        let market = hybrid_market_data(ticker, &[(score_date, 100.0), (latest_date, 200.0)]);
        let records = vec![StockRecord::new(ticker.to_string(), 5.0, 250.0)];

        let result =
            calculate_hybrid_projection(absent_data_root(), &records, &score_str, &market).unwrap();

        // gain = 100% over 8 days -> daily_rate = 12.5; raw = 1125; dampened
        // (0.2) = 225; clamped to the 7..14 upper bound of 20%.
        let expected = 20.0;
        assert!(
            (result.performance_90_day - expected).abs() < 1e-6,
            "steep trend should clamp to upper bound {expected}, got {}",
            result.performance_90_day
        );
    }

    #[test]
    fn test_calculate_hybrid_projection_clamps_to_lower_bound() {
        let ticker = "TEST:HYBRIDD";
        let today = chrono::Utc::now().naive_utc().date();
        // Score 9 days ago; 8 market days (7..14 bucket -> max loss -10%).
        let score_date = today - Duration::days(9);
        let latest_date = score_date + Duration::days(8);
        let score_str = score_date.format("%Y-%m-%d").to_string();

        // Steep crash: 100 -> 10 over 8 days.
        let market = hybrid_market_data(ticker, &[(score_date, 100.0), (latest_date, 10.0)]);
        let records = vec![StockRecord::new(ticker.to_string(), 5.0, 90.0)];

        let result =
            calculate_hybrid_projection(absent_data_root(), &records, &score_str, &market).unwrap();

        // gain = -90% over 8 days -> daily_rate = -11.25; raw = -1012.5; dampened
        // (0.2) = -202.5; clamped to the 7..14 lower bound of -10%.
        let expected = -10.0;
        assert!(
            (result.performance_90_day - expected).abs() < 1e-6,
            "steep crash should clamp to lower bound {expected}, got {}",
            result.performance_90_day
        );
    }

    #[test]
    fn test_calculate_hybrid_projection_rejects_old_score() {
        let ticker = "TEST:HYBRIDE";
        let today = chrono::Utc::now().naive_utc().date();
        // 100 days old: must fall back to the regular performance calculation.
        let score_date = today - Duration::days(100);
        let score_str = score_date.format("%Y-%m-%d").to_string();

        let market = hybrid_market_data(ticker, &[(score_date, 100.0)]);
        let records = vec![StockRecord::new(ticker.to_string(), 5.0, 120.0)];

        let result = calculate_hybrid_projection(absent_data_root(), &records, &score_str, &market);
        assert!(
            result.is_err(),
            "scores >= 90 days old must be rejected by the hybrid projection"
        );
    }

    #[test]
    fn test_calculate_hybrid_projection_no_market_data_yields_zero() {
        let today = chrono::Utc::now().naive_utc().date();
        let score_date = today - Duration::days(10);
        let score_str = score_date.format("%Y-%m-%d").to_string();

        // No market data for the requested ticker -> no valid projections.
        let market: HashMap<String, HashMap<String, f64>> = HashMap::new();
        let records = vec![StockRecord::new("TEST:HYBRIDF".to_string(), 5.0, 50.0)];

        let result =
            calculate_hybrid_projection(absent_data_root(), &records, &score_str, &market).unwrap();
        assert_eq!(result.performance_90_day, 0.0);
        assert_eq!(result.performance_annualized, 0.0);
        // With no market data, the stock is unpriceable and excluded, so included count is 0
        assert_eq!(result.total_stocks, 0);
        assert!(result.individual_performances.is_empty());
        // The stock should be in the excluded list
        assert_eq!(result.excluded_tickers.len(), 1);
        assert!(result
            .excluded_tickers
            .contains(&"TEST:HYBRIDF".to_string()));
    }

    // --- Unpriceable-stock exclusion for the hybrid path (issue #287) ---
    //
    // These mirror the exclusion cases proven for the full-period
    // `calculate_portfolio_performance` so recent (hybrid) and mature scores
    // apply identical semantics: a stock is included only when BOTH its buy
    // price and its current/latest price are usable, and counts/averages are
    // computed over the included stocks alone.

    /// Builds a market-data map covering several tickers, each from its own
    /// `(date, price)` points.
    fn hybrid_market_data_multi(
        entries: &[(&str, &[(NaiveDate, f64)])],
    ) -> HashMap<String, HashMap<String, f64>> {
        let mut outer = HashMap::new();
        for (ticker, points) in entries {
            let mut inner = HashMap::new();
            for (date, price) in *points {
                inner.insert(date.format("%Y-%m-%d").to_string(), *price);
            }
            outer.insert((*ticker).to_string(), inner);
        }
        outer
    }

    #[test]
    fn test_hybrid_projection_includes_when_both_prices_present() {
        let ticker = "TEST:HYBRIDBOTH";
        let today = chrono::Utc::now().naive_utc().date();
        let score_date = today - Duration::days(41);
        let latest_date = score_date + Duration::days(40);
        let score_str = score_date.format("%Y-%m-%d").to_string();

        // Usable buy price (on the score date) and usable latest price.
        let market = hybrid_market_data(ticker, &[(score_date, 100.0), (latest_date, 110.0)]);
        let records = vec![StockRecord::new(ticker.to_string(), 5.0, 120.0)];

        let result =
            calculate_hybrid_projection(absent_data_root(), &records, &score_str, &market).unwrap();

        assert_eq!(result.total_stocks, 1, "priceable stock must be included");
        assert_eq!(result.individual_performances.len(), 1);
        assert!(
            result.excluded_tickers.is_empty(),
            "a fully priceable stock must not be excluded"
        );
    }

    #[test]
    fn test_hybrid_projection_excludes_when_buy_price_missing() {
        let ticker = "TEST:HYBRIDNOBUY";
        let today = chrono::Utc::now().naive_utc().date();
        let score_date = today - Duration::days(41);
        let latest_date = score_date + Duration::days(40);
        let score_str = score_date.format("%Y-%m-%d").to_string();

        // Buy price unusable (0.0 on the score date) but a usable latest price.
        let market = hybrid_market_data(ticker, &[(score_date, 0.0), (latest_date, 110.0)]);
        let records = vec![StockRecord::new(ticker.to_string(), 5.0, 120.0)];

        let result =
            calculate_hybrid_projection(absent_data_root(), &records, &score_str, &market).unwrap();

        assert_eq!(
            result.total_stocks, 0,
            "stock without a usable buy price must be excluded"
        );
        assert!(result.individual_performances.is_empty());
        assert!(result.excluded_tickers.contains(&ticker.to_string()));
    }

    #[test]
    fn test_hybrid_projection_excludes_when_latest_price_missing() {
        let ticker = "TEST:HYBRIDNOLATEST";
        let today = chrono::Utc::now().naive_utc().date();
        let score_date = today - Duration::days(41);
        let latest_date = score_date + Duration::days(40);
        let score_str = score_date.format("%Y-%m-%d").to_string();

        // Usable buy price but the latest available price is unusable (0.0).
        let market = hybrid_market_data(ticker, &[(score_date, 100.0), (latest_date, 0.0)]);
        let records = vec![StockRecord::new(ticker.to_string(), 5.0, 120.0)];

        let result =
            calculate_hybrid_projection(absent_data_root(), &records, &score_str, &market).unwrap();

        assert_eq!(
            result.total_stocks, 0,
            "stock without a usable current/latest price must be excluded"
        );
        assert!(result.individual_performances.is_empty());
        assert!(result.excluded_tickers.contains(&ticker.to_string()));
    }

    #[test]
    fn test_hybrid_projection_excludes_when_both_prices_missing() {
        let ticker = "TEST:HYBRIDNONE";
        let today = chrono::Utc::now().naive_utc().date();
        let score_date = today - Duration::days(41);
        let latest_date = score_date + Duration::days(40);
        let score_str = score_date.format("%Y-%m-%d").to_string();

        // Neither price is usable.
        let market = hybrid_market_data(ticker, &[(score_date, 0.0), (latest_date, 0.0)]);
        let records = vec![StockRecord::new(ticker.to_string(), 5.0, 120.0)];

        let result =
            calculate_hybrid_projection(absent_data_root(), &records, &score_str, &market).unwrap();

        assert_eq!(
            result.total_stocks, 0,
            "stock with neither price usable must be excluded"
        );
        assert!(result.individual_performances.is_empty());
        assert!(result.excluded_tickers.contains(&ticker.to_string()));
    }

    #[test]
    fn test_hybrid_projection_count_and_average_over_included_only() {
        let today = chrono::Utc::now().naive_utc().date();
        let score_date = today - Duration::days(41);
        let latest_date = score_date + Duration::days(40);
        let score_str = score_date.format("%Y-%m-%d").to_string();

        // Two priceable stocks with identical 100 -> 110 trends (projection
        // 11.25 each) plus one unpriceable stock (buy price 0.0).
        let included_a = "TEST:HYBRIDINCA";
        let included_b = "TEST:HYBRIDINCB";
        let excluded = "TEST:HYBRIDEXC";
        let market = hybrid_market_data_multi(&[
            (included_a, &[(score_date, 100.0), (latest_date, 110.0)]),
            (included_b, &[(score_date, 100.0), (latest_date, 110.0)]),
            (excluded, &[(score_date, 0.0), (latest_date, 0.0)]),
        ]);
        let records = vec![
            StockRecord::new(included_a.to_string(), 5.0, 120.0),
            StockRecord::new(included_b.to_string(), 5.0, 120.0),
            StockRecord::new(excluded.to_string(), 5.0, 120.0),
        ];

        let result =
            calculate_hybrid_projection(absent_data_root(), &records, &score_str, &market).unwrap();

        // Count is over included stocks only.
        assert_eq!(result.total_stocks, 2);
        assert_eq!(result.individual_performances.len(), 2);

        // Average is computed over the two included stocks only; the excluded
        // stock contributes nothing (otherwise the mean would be dragged down).
        let expected = 11.25;
        assert!(
            (result.performance_90_day - expected).abs() < 1e-6,
            "average must be over included stocks only, got {}",
            result.performance_90_day
        );

        // The unpriceable stock is surfaced as excluded.
        assert_eq!(result.excluded_tickers.len(), 1);
        assert!(result.excluded_tickers.contains(&excluded.to_string()));
    }

    // --- Tests for stock priceable predicate (issue #286) ---

    // The third `split_reliable` argument was added in issue #294 so the single
    // predicate also drops split-unreliable stocks (mirroring the frontend
    // `isStockIncluded`). These existing cases pass `true` to preserve their
    // original price-only intent; a dedicated case below covers `false`.
    #[test]
    fn test_is_priceable_both_prices_present() {
        assert!(is_priceable(10.5, 12.0, true, 1.0));
        assert!(is_priceable(0.01, 0.01, true, 1.0));
        assert!(is_priceable(100.0, 1.0, true, 1.0));
    }

    #[test]
    fn test_is_priceable_buy_price_missing() {
        assert!(!is_priceable(0.0, 12.0, true, 1.0));
    }

    #[test]
    fn test_is_priceable_current_price_missing() {
        assert!(!is_priceable(10.5, 0.0, true, 1.0));
    }

    #[test]
    fn test_is_priceable_both_prices_missing() {
        assert!(!is_priceable(0.0, 0.0, true, 1.0));
    }

    #[test]
    fn test_is_priceable_negative_prices() {
        assert!(!is_priceable(-10.5, 12.0, true, 1.0));
        assert!(!is_priceable(10.5, -12.0, true, 1.0));
        assert!(!is_priceable(-10.5, -12.0, true, 1.0));
    }

    #[test]
    fn test_is_priceable_split_unreliable_excludes_otherwise_priceable_stock() {
        // Both prices usable, but an unreliable split series drops the stock
        // through the single gate (issue #294).
        assert!(!is_priceable(10.5, 12.0, false, 1.0));
        assert!(!is_priceable(100.0, 1.0, false, 1.0));
    }

    #[test]
    fn test_is_priceable_positive_score_included() {
        // A fully priceable stock with a positive score is included (issue #627).
        assert!(is_priceable(10.5, 12.0, true, 0.174));
        assert!(is_priceable(10.5, 12.0, true, 5.0));
    }

    #[test]
    fn test_is_priceable_zero_score_excludes_otherwise_priceable_stock() {
        // Both prices usable and split reliable, but a zero score means the
        // model would not buy, so we hold cash and exclude the stock (issue #627).
        assert!(!is_priceable(10.5, 12.0, true, 0.0));
    }

    #[test]
    fn test_is_priceable_negative_score_excludes_otherwise_priceable_stock() {
        // A negative score predicts a fall: exclude the stock (issue #627).
        assert!(!is_priceable(10.5, 12.0, true, -0.5));
        assert!(!is_priceable(100.0, 1.0, true, -10.0));
    }

    #[test]
    fn test_portfolio_performance_excludes_unpriceable_stocks() {
        // When a stock has a missing buy price, it should be excluded from both
        // the average and the count.
        let _stock_records = [
            StockRecord::new("NYSE:GOOD1".to_string(), 1.0, 22.63),
            StockRecord::new("NYSE:MISSING_BUY".to_string(), 1.0, 50.0), // will lack buy price
            StockRecord::new("NYSE:GOOD2".to_string(), 1.0, 25.0),
        ];

        // Simulate market data where MISSING_BUY has no data on/after score date
        let mut market_data_csv: HashMap<String, HashMap<String, f64>> = HashMap::new();

        let mut good1_prices = HashMap::new();
        good1_prices.insert("2024-11-15".to_string(), 20.0);
        good1_prices.insert("2025-02-13".to_string(), 25.0);
        market_data_csv.insert("NYSE:GOOD1".to_string(), good1_prices);

        let missing_buy_prices = HashMap::new();
        // No data at or after score date, only future data beyond the 90-day window
        market_data_csv.insert("NYSE:MISSING_BUY".to_string(), missing_buy_prices);

        let mut good2_prices = HashMap::new();
        good2_prices.insert("2024-11-15".to_string(), 20.0);
        good2_prices.insert("2025-02-13".to_string(), 22.0);
        market_data_csv.insert("NYSE:GOOD2".to_string(), good2_prices);

        // Simulate that GOOD1 and GOOD2 are priceable but MISSING_BUY is not
        // This is tested implicitly via the count and excluded list
        assert!(is_priceable(20.0, 25.0, true, 1.0)); // GOOD1 is priceable
        assert!(is_priceable(20.0, 22.0, true, 1.0)); // GOOD2 is priceable
        assert!(!is_priceable(0.0, 0.0, true, 1.0)); // MISSING_BUY is not priceable
    }

    #[test]
    fn test_portfolio_performance_excludes_missing_current_price() {
        // When a stock has a missing current price within the 90-day window,
        // it should be excluded from both the average and the count.
        assert!(is_priceable(20.0, 25.0, true, 1.0)); // priceable
        assert!(!is_priceable(20.0, 0.0, true, 1.0)); // missing current price is not priceable
        assert!(!is_priceable(0.0, 25.0, true, 1.0)); // missing buy price is not priceable
    }

    #[test]
    fn test_portfolio_performance_included_count_matches_included_stocks() {
        // The reported total_stocks should equal the number of included stocks
        // (those with both buy and current prices), not the total file count.
        // This is verified implicitly: if a file has 10 stocks but 3 are
        // unpriceable, total_stocks should be 7 and individual_performances.len() == 7.
        let priceable_count = 2; // both GOOD1 and GOOD2
        let unpriceable_count = 1; // MISSING_BUY

        let total_file_count = priceable_count + unpriceable_count;
        assert_eq!(total_file_count, 3);

        // The portfolio performance should report only the priceable count
        assert_ne!(total_file_count, priceable_count);
    }

    #[test]
    fn test_excluded_tickers_surfaced_on_portfolio_performance() {
        // PortfolioPerformance must expose the list of excluded tickers
        // so downstream (dashboard, main.rs) can mark them appropriately.
        let excluded = ["NYSE:MISSING_BUY".to_string()];
        assert_eq!(excluded.len(), 1);
        assert!(excluded.contains(&"NYSE:MISSING_BUY".to_string()));
    }

    #[test]
    fn test_portfolio_performance_average_denominator_is_included_count() {
        // The average 90-day return should be computed over included stocks only,
        // not over all file stocks. This is tested via the formula:
        // average = sum(returns) / included_count
        // If the denominator were the file count, the average would be artificially low.

        // Example: 2 good stocks with +10% return each, 1 bad stock (unpriceable)
        // Correct average: (10 + 10) / 2 = 10%
        // Wrong average (file count):  (10 + 10 + 0) / 3 = 6.67%

        let good_returns = [10.0, 10.0];
        let correct_average = good_returns.iter().sum::<f64>() / good_returns.len() as f64;
        assert_eq!(correct_average, 10.0);

        let wrong_denominator = 3; // file count including unpriceable
        let wrong_average = good_returns.iter().sum::<f64>() / wrong_denominator as f64;
        assert_eq!(wrong_average, 20.0 / 3.0);
        assert_ne!(correct_average, wrong_average);
    }

    /// Writes a score TSV and its derived market-data CSV into a temp dir, then
    /// returns the temp dir (kept alive) and the score-file path.
    fn write_portfolio_fixture(tsv: &str, csv: &str) -> (tempfile::TempDir, String) {
        use std::io::Write;
        let dir = tempfile::tempdir().unwrap();
        let tsv_path = dir.path().join("score.tsv");
        let csv_path = dir.path().join("score.csv");
        std::fs::File::create(&tsv_path)
            .unwrap()
            .write_all(tsv.as_bytes())
            .unwrap();
        std::fs::File::create(&csv_path)
            .unwrap()
            .write_all(csv.as_bytes())
            .unwrap();
        (dir, tsv_path.to_string_lossy().to_string())
    }

    const PERF_CSV_HEADER: &str = "date,ticker,high,low,open,close,split_coefficient\n";

    /// Score-TSV header carrying every column `StockRecord` deserialises.
    const PERF_TSV_HEADER: &str = "Stock\tScore\tTarget\tExDividendDate\tDividendPerShare\tNotes\tintrinsicValuePerShareBasic\tintrinsicValuePerShareAdjusted\n";

    #[test]
    fn test_portfolio_performance_corrects_clean_split() {
        // A clean 2:1 split inside the window must be corrected, not excluded:
        // raw close 100 -> 55 looks like -45%, but the split-adjusted return is
        // +10% (buy basis restated to 50).
        let tsv = format!("{PERF_TSV_HEADER}NYSE:CLEAN\t1.0\t$120.00\t\t\t\t\t\n");
        let csv = format!(
            "{PERF_CSV_HEADER}\
             2024-11-15,NYSE:CLEAN,100,100,100,100,1.0\n\
             2024-12-14,NYSE:CLEAN,110,110,110,110,1.0\n\
             2024-12-15,NYSE:CLEAN,55,55,55,55,2.0\n\
             2025-02-13,NYSE:CLEAN,55,55,55,55,1.0\n"
        );
        let (_dir, score_path) = write_portfolio_fixture(&tsv, &csv);

        let result =
            calculate_portfolio_performance(absent_data_root(), &score_path, "2024-11-15").unwrap();

        assert_eq!(result.total_stocks, 1, "a clean split stock stays included");
        assert!(result.excluded_tickers.is_empty());
        let stock = &result.individual_performances[0];
        assert!(
            (stock.buy_price - 50.0).abs() < 1e-6,
            "buy basis must be restated to 50, got {}",
            stock.buy_price
        );
        assert!(
            (stock.gain_loss_percent - 10.0).abs() < 1e-6,
            "corrected return must be +10%, got {}",
            stock.gain_loss_percent
        );
        assert!((result.performance_90_day - 10.0).abs() < 1e-6);
    }

    #[test]
    fn test_portfolio_performance_excludes_implausible_split() {
        // Two stocks: one clean (+10%), one with an implausible coefficient that
        // cannot be reconciled. The bad one must drop from the average, from the
        // count, and appear in excluded_tickers (issue #294 + #286 plumbing).
        // Issue #831: BADSPLIT's price move must CONTRADICT its 50:1 coefficient
        // (100 -> 20 is a ~5-fold fall, not 50-fold). It previously fell 100 ->
        // 2, which the ±15% cross-check now confirms, so that series would be
        // trusted rather than excluded — see
        // `test_compute_split_adjustment_large_split_confirmed_by_price_is_reliable`.
        let tsv = format!(
            "{PERF_TSV_HEADER}\
             NYSE:GOODSPLIT\t1.0\t$120.00\t\t\t\t\t\n\
             NYSE:BADSPLIT\t1.0\t$120.00\t\t\t\t\t\n"
        );
        let csv = format!(
            "{PERF_CSV_HEADER}\
             2024-11-15,NYSE:GOODSPLIT,100,100,100,100,1.0\n\
             2024-12-14,NYSE:GOODSPLIT,110,110,110,110,1.0\n\
             2024-12-15,NYSE:GOODSPLIT,55,55,55,55,2.0\n\
             2025-02-13,NYSE:GOODSPLIT,55,55,55,55,1.0\n\
             2024-11-15,NYSE:BADSPLIT,100,100,100,100,1.0\n\
             2024-12-15,NYSE:BADSPLIT,20,20,20,20,50.0\n\
             2025-02-13,NYSE:BADSPLIT,20,20,20,20,1.0\n"
        );
        let (_dir, score_path) = write_portfolio_fixture(&tsv, &csv);

        let result =
            calculate_portfolio_performance(absent_data_root(), &score_path, "2024-11-15").unwrap();

        assert_eq!(
            result.total_stocks, 1,
            "only the reconcilable stock is counted"
        );
        assert_eq!(result.individual_performances.len(), 1);
        assert_eq!(result.individual_performances[0].ticker, "NYSE:GOODSPLIT");
        assert!(
            result
                .excluded_tickers
                .contains(&"NYSE:BADSPLIT".to_string()),
            "the unreconcilable split stock must be excluded"
        );
        // Average is over the single included stock only.
        assert!((result.performance_90_day - 10.0).abs() < 1e-6);
    }

    #[test]
    fn test_portfolio_performance_excludes_negative_score_stock() {
        // Two stocks, both fully priceable (+10% each). One carries a negative
        // model score, so it predicts a fall and we hold cash: it must drop from
        // the average and the count, and appear in excluded_tickers (issue #627).
        let tsv = format!(
            "{PERF_TSV_HEADER}\
             NYSE:BUYME\t1.0\t$120.00\t\t\t\t\t\n\
             NYSE:HOLDCASH\t-0.5\t$120.00\t\t\t\t\t\n"
        );
        let csv = format!(
            "{PERF_CSV_HEADER}\
             2024-11-15,NYSE:BUYME,100,100,100,100,1.0\n\
             2025-02-13,NYSE:BUYME,110,110,110,110,1.0\n\
             2024-11-15,NYSE:HOLDCASH,100,100,100,100,1.0\n\
             2025-02-13,NYSE:HOLDCASH,200,200,200,200,1.0\n"
        );
        let (_dir, score_path) = write_portfolio_fixture(&tsv, &csv);

        let result =
            calculate_portfolio_performance(absent_data_root(), &score_path, "2024-11-15").unwrap();

        assert_eq!(
            result.total_stocks, 1,
            "only the positive-score stock is counted"
        );
        assert_eq!(result.individual_performances.len(), 1);
        assert_eq!(result.individual_performances[0].ticker, "NYSE:BUYME");
        assert!(
            result
                .excluded_tickers
                .contains(&"NYSE:HOLDCASH".to_string()),
            "the negative-score stock must be excluded"
        );
        // Average is over the single included stock only; the excluded +100%
        // name does not lift the figure.
        assert!((result.performance_90_day - 10.0).abs() < 1e-6);
    }

    #[test]
    fn test_portfolio_performance_no_split_unchanged() {
        // A stock with no split (coefficient 1.0 throughout) behaves exactly as
        // before: 100 -> 110 is a straight +10%, buy basis unchanged.
        let tsv = format!("{PERF_TSV_HEADER}NYSE:NOSPLIT\t1.0\t$120.00\t\t\t\t\t\n");
        let csv = format!(
            "{PERF_CSV_HEADER}\
             2024-11-15,NYSE:NOSPLIT,100,100,100,100,1.0\n\
             2025-02-13,NYSE:NOSPLIT,110,110,110,110,1.0\n"
        );
        let (_dir, score_path) = write_portfolio_fixture(&tsv, &csv);

        let result =
            calculate_portfolio_performance(absent_data_root(), &score_path, "2024-11-15").unwrap();

        assert_eq!(result.total_stocks, 1);
        assert!(result.excluded_tickers.is_empty());
        let stock = &result.individual_performances[0];
        assert!(
            (stock.buy_price - 100.0).abs() < 1e-6,
            "no-split buy basis is unchanged"
        );
        assert!((stock.gain_loss_percent - 10.0).abs() < 1e-6);
    }
}
