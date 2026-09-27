//! Split-coefficient guard and correct-or-exclude adjustment (issue #294).
//!
//! Reconciles the `split_coefficient` column of a ticker's price series into
//! one cumulative factor since the buy date, and flags any series whose splits
//! cannot be trusted so the stock is excluded rather than mispriced.

use crate::models::DailyMarketPoint;
use chrono::NaiveDate;
use std::collections::HashMap;

/// Trustworthy split-adjustment thresholds, mirroring `docs/projection.js`
/// (issues #291/#292, parent #272). Agreed in the #291 investigation; the
/// thresholds are documented under _Split-reconciliation thresholds_ in the
/// README (the durable home after `docs/fixes/` was pruned in #759).
// A single split of <= 10:1 is plausible on its own; a LARGER one needs the
// observed pre/post price move to confirm it (issue #831) — MVIS's genuine
// 1-for-15 reverse split is real market data, so the cap alone must not condemn
// it.
const MAX_PLAUSIBLE_COEFFICIENT: f64 = 10.0;
const DUPLICATE_WINDOW_DAYS: i64 = 5; // splits within 5 days = the same event twice
const MAX_CUMULATIVE_FACTOR: f64 = 50.0; // cumulative factor cap over the window
const MIN_CUMULATIVE_FACTOR: f64 = 1.0 / MAX_CUMULATIVE_FACTOR; // reverse-split floor
const RECONCILE_TOLERANCE: f64 = 0.15; // +/-15% price-ratio cross-check

/// Effective N:1 split magnitude for forward (`c`) and reverse (`1/c`) events.
fn split_event_magnitude(c: f64) -> f64 {
    if c >= 1.0 {
        c
    } else {
        1.0 / c
    }
}

/// Returns `true` when `c` is a valid split coefficient (not 1.0, positive, finite).
fn is_split_coefficient(c: f64) -> bool {
    c.is_finite() && c > 0.0 && (c - 1.0).abs() > f64::EPSILON
}

/// Outcome of cross-checking one split event against the observed pre/post
/// price move (issue #831). `Unavailable` is NOT confirmation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SplitCrossCheck {
    Confirmed,
    Contradicted,
    Unavailable,
}

/// Cross-checks a split coefficient against the observed pre/post price move:
/// for a forward split (`c > 1`) the price falls `c`-fold, for a reverse split
/// (`c < 1`) it rises `1/c`-fold, so `prev_mid / split_mid` should match `c`
/// either way. Returns [`SplitCrossCheck::Unavailable`] when there is no usable
/// neighbouring price (missing previous row, or a non-finite / non-positive
/// midpoint) — the frontend mirror in `docs/projection.js`.
fn cross_check_split_event(
    prev: Option<&DailyMarketPoint>,
    point: &DailyMarketPoint,
    c: f64,
) -> SplitCrossCheck {
    let Some(prev) = prev else {
        return SplitCrossCheck::Unavailable;
    };
    let prev_mid = (prev.high + prev.low) / 2.0;
    let split_mid = (point.high + point.low) / 2.0;
    if !prev_mid.is_finite() || !split_mid.is_finite() || split_mid <= 0.0 {
        return SplitCrossCheck::Unavailable;
    }
    if ((prev_mid / split_mid) / c - 1.0).abs() <= RECONCILE_TOLERANCE {
        SplitCrossCheck::Confirmed
    } else {
        SplitCrossCheck::Contradicted
    }
}

/// Cumulative split adjustment for a window plus whether it can be trusted.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SplitAdjustment {
    /// De-duplicated, plausibility-checked cumulative split factor (kept for
    /// diagnostics even when `reliable` is `false`).
    pub factor: f64,
    /// `false` when the series cannot be reconciled; callers must then exclude
    /// the stock rather than silently apply `factor`.
    pub reliable: bool,
}

impl SplitAdjustment {
    /// A no-split, trivially-reliable adjustment (factor `1.0`).
    pub const NONE: SplitAdjustment = SplitAdjustment {
        factor: 1.0,
        reliable: true,
    };
}

/// Computes the cumulative split adjustment for splits strictly after
/// `from_date`, judging whether the series can be trusted — the Rust mirror of
/// the frontend `computeSplitAdjustment` (issue #294, parent #272).
///
/// Rules: de-duplicate split events recorded within [`DUPLICATE_WINDOW_DAYS`];
/// cross-check each split against the observed pre/post price move within
/// [`RECONCILE_TOLERANCE`]; flag any single event whose effective ratio exceeds
/// [`MAX_PLAUSIBLE_COEFFICIENT`] (forward *or* reverse) UNLESS that price move
/// confirms it (issue #831); and bound the cumulative factor between
/// [`MIN_CUMULATIVE_FACTOR`] and [`MAX_CUMULATIVE_FACTOR`].
/// A missing or empty series means no known splits, so the factor is `1.0` and
/// the series is reliable.
pub fn compute_split_adjustment(
    series: &HashMap<String, DailyMarketPoint>,
    from_date: NaiveDate,
) -> SplitAdjustment {
    // Sort by date so "the price immediately before a split" is well-defined
    // regardless of map iteration order.
    let mut points: Vec<(NaiveDate, &DailyMarketPoint)> = series
        .iter()
        .filter_map(|(date_str, point)| {
            NaiveDate::parse_from_str(date_str, "%Y-%m-%d")
                .ok()
                .map(|date| (date, point))
        })
        .collect();
    points.sort_by_key(|(date, _)| *date);

    let mut factor = 1.0;
    let mut reliable = true;
    let mut last_event: Option<NaiveDate> = None;

    for (i, (date, point)) in points.iter().enumerate() {
        let date = *date;
        let c = point.split_coefficient;

        // Only splits strictly after the buy date adjust the buy price.
        if date <= from_date {
            continue;
        }
        // Invalid / unity coefficients mean "no adjustment" (treat as 1.0).
        if !is_split_coefficient(c) {
            continue;
        }
        // De-duplicate: a split within DUPLICATE_WINDOW_DAYS of the last kept
        // one is the same corporate event recorded twice — apply it once.
        if let Some(prev_event) = last_event {
            if (date - prev_event).num_days() <= DUPLICATE_WINDOW_DAYS {
                continue;
            }
        }
        last_event = Some(date);

        // Price-ratio cross-check against the observed pre/post price move.
        let verdict =
            cross_check_split_event(if i > 0 { Some(points[i - 1].1) } else { None }, point, c);
        if verdict == SplitCrossCheck::Contradicted {
            reliable = false;
        }

        // An implausibly large single event (forward or reverse) is trusted
        // only when the price move CONFIRMS it — a genuine 1-for-15 reverse
        // split reconciles, an unsupported one does not (issue #831).
        if split_event_magnitude(c) > MAX_PLAUSIBLE_COEFFICIENT
            && verdict != SplitCrossCheck::Confirmed
        {
            reliable = false;
        }

        factor *= c;
    }

    // Cumulative-factor plausibility bound (forward product too large, or reverse
    // product too small, almost certainly means duplicated/spurious coefficients).
    if !(MIN_CUMULATIVE_FACTOR..=MAX_CUMULATIVE_FACTOR).contains(&factor) {
        reliable = false;
    }

    SplitAdjustment { factor, reliable }
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- Split-coefficient guard and correct-or-exclude (issue #294) ---

    /// Builds a split-relevant series for one ticker from
    /// `(date, high, low, split_coefficient)` points. `close` is not stored in
    /// `DailyMarketPoint`, so only high/low/coefficient matter.
    fn split_series(points: &[(&str, f64, f64, f64)]) -> HashMap<String, DailyMarketPoint> {
        let mut series = HashMap::new();
        for (date, high, low, split_coefficient) in points {
            series.insert(
                (*date).to_string(),
                DailyMarketPoint {
                    high: *high,
                    low: *low,
                    split_coefficient: *split_coefficient,
                    // Volume is irrelevant to the split-reconciliation tests.
                    volume: None,
                },
            );
        }
        series
    }

    fn date(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    #[test]
    fn test_compute_split_adjustment_no_splits_is_reliable_unity() {
        let series = split_series(&[
            ("2024-11-15", 100.0, 100.0, 1.0),
            ("2024-12-15", 105.0, 105.0, 1.0),
        ]);
        let adj = compute_split_adjustment(&series, date("2024-11-15"));
        assert_eq!(adj, SplitAdjustment::NONE);
    }

    #[test]
    fn test_compute_split_adjustment_clean_single_split() {
        // A real 2:1 split: the day before trades ~110, the split day ~55.
        let series = split_series(&[
            ("2024-12-14", 110.0, 110.0, 1.0),
            ("2024-12-15", 55.0, 55.0, 2.0),
        ]);
        let adj = compute_split_adjustment(&series, date("2024-11-15"));
        assert!(adj.reliable, "a reconcilable 2:1 split must be reliable");
        assert!((adj.factor - 2.0).abs() < 1e-9, "factor should be 2.0");
    }

    #[test]
    fn test_compute_split_adjustment_deduplicates_repeated_event() {
        // The same 2:1 event recorded twice within five days applies once.
        let series = split_series(&[
            ("2024-12-14", 110.0, 110.0, 1.0),
            ("2024-12-15", 55.0, 55.0, 2.0),
            ("2024-12-17", 55.0, 55.0, 2.0),
        ]);
        let adj = compute_split_adjustment(&series, date("2024-11-15"));
        assert!(adj.reliable);
        assert!(
            (adj.factor - 2.0).abs() < 1e-9,
            "duplicate within window must not compound to 4.0, got {}",
            adj.factor
        );
    }

    /// Business-logic change (issue #831): the 10:1 magnitude cap alone no
    /// longer condemns a series — an above-cap event is rejected only when the
    /// observed price move fails to confirm it. This test previously paired the
    /// 50:1 coefficient with a matching ~50-fold drop (110 -> 2.0); that
    /// combination is now the trusted case covered by
    /// `test_compute_split_adjustment_large_split_confirmed_by_price_is_reliable`.
    #[test]
    fn test_compute_split_adjustment_implausible_coefficient_unreliable() {
        let series = split_series(&[
            ("2024-12-14", 110.0, 110.0, 1.0),
            // Coefficient far above 10 and the price only fell ~5-fold: nothing
            // corroborates it.
            ("2024-12-15", 22.0, 22.0, 50.0),
        ]);
        let adj = compute_split_adjustment(&series, date("2024-11-15"));
        assert!(
            !adj.reliable,
            "an unconfirmed, implausibly large single coefficient must be flagged unreliable"
        );
    }

    #[test]
    fn test_compute_split_adjustment_large_split_confirmed_by_price_is_reliable() {
        // A 1-for-15 reverse split (magnitude 15, above the 10:1 cap) whose
        // price move confirms it — MicroVision's real 2026-08-03 event.
        let series = split_series(&[
            ("2026-07-31", 0.266, 0.234, 1.0),
            ("2026-08-03", 4.2315, 3.62, 1.0 / 15.0),
        ]);
        let adj = compute_split_adjustment(&series, date("2026-02-19"));
        assert!(
            adj.reliable,
            "a large split confirmed by the observed price move is genuine market data"
        );
        assert!(
            (adj.factor - 1.0 / 15.0).abs() < 1e-9,
            "factor should be 1/15, got {}",
            adj.factor
        );
    }

    #[test]
    fn test_compute_split_adjustment_large_split_without_prior_price_unreliable() {
        // The split is the FIRST point, so there is no preceding price to
        // corroborate it. Absence of a contradiction is not confirmation.
        let series = split_series(&[
            ("2026-08-03", 4.2315, 3.62, 1.0 / 15.0),
            ("2026-08-04", 3.91, 3.6, 1.0),
        ]);
        let adj = compute_split_adjustment(&series, date("2026-02-19"));
        assert!(
            !adj.reliable,
            "an above-cap split with nothing to cross-check stays untrusted"
        );
    }

    #[test]
    fn test_compute_split_adjustment_price_ratio_mismatch_unreliable() {
        // Coefficient claims 2:1 but the price barely moves: cannot reconcile.
        let series = split_series(&[
            ("2024-12-14", 100.0, 100.0, 1.0),
            ("2024-12-15", 98.0, 98.0, 2.0),
        ]);
        let adj = compute_split_adjustment(&series, date("2024-11-15"));
        assert!(
            !adj.reliable,
            "a coefficient that does not match the observed price drop is unreliable"
        );
    }

    #[test]
    fn test_compute_split_adjustment_clean_single_reverse_split() {
        // A real 10:1 reverse split: price rises ~10-fold; coefficient is 0.1.
        let series = split_series(&[
            ("2024-12-14", 10.0, 10.0, 1.0),
            ("2024-12-15", 100.0, 100.0, 0.1),
        ]);
        let adj = compute_split_adjustment(&series, date("2024-11-15"));
        assert!(
            adj.reliable,
            "a reconcilable 10:1 reverse split must be reliable"
        );
        assert!((adj.factor - 0.1).abs() < 1e-9, "factor should be 0.1");
    }

    #[test]
    fn test_compute_split_adjustment_implausible_reverse_split_unreliable() {
        // A 200:1 reverse split (coefficient 0.005) exceeds the 10:1 ceiling.
        let series = split_series(&[
            ("2025-08-08", 0.0322, 0.0322, 1.0),
            ("2025-08-11", 4.47, 4.47, 0.005),
        ]);
        let adj = compute_split_adjustment(&series, date("2025-07-10"));
        assert!(
            !adj.reliable,
            "an implausibly large reverse split must be flagged unreliable"
        );
    }

    #[test]
    fn test_compute_split_adjustment_ignores_splits_before_buy_date() {
        // A split that predates the buy date does not adjust the buy price.
        let series = split_series(&[
            ("2024-12-14", 110.0, 110.0, 1.0),
            ("2024-12-15", 55.0, 55.0, 2.0),
        ]);
        let adj = compute_split_adjustment(&series, date("2024-12-31"));
        assert_eq!(adj, SplitAdjustment::NONE);
    }
}
