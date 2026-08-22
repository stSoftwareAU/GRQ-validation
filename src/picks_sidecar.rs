//! The per-score-date pick-details sidecar (issue #838, sub-issue of #835).
//!
//! Three of the details a picker reads off the dashboard are *as at the score
//! date* and therefore need price history from **before** it: the 52-week range
//! position, the 5-day return, and the trailing dollar ADV. The committed
//! `<date>.csv` deliberately starts on the score date and only looks forward,
//! and widening it backwards would add a year of rows per ticker to every
//! per-date CSV for data that is only ever read as a handful of summary
//! numbers.
//!
//! So this module writes a *sidecar* instead — one row per ticker in
//! `<date>-picks.csv`, beside the existing `<date>.csv`,
//! `<date>-analysis.csv` and `<date>-dividends.csv`:
//!
//! ```text
//! ticker,week52_low,week52_high,close_score_date,close_5d_prior,adv_dollar_10d
//! ```
//!
//! Two rules govern the values:
//!
//! - **Raw inputs only.** No thresholds, no lots, no traffic light — those live
//!   in `docs/pick_details.js` so they stay tunable in one place.
//! - **Blank, never zero**, for anything that cannot be computed. A blank cell
//!   reads as "unknown"; a `0` would read as a real, terrible number and wrongly
//!   turn a traffic light red.
//!
//! `adv_dollar_10d` reuses the definition of `averageDollarVolume` in
//! `docs/volume_recommend.js` (the issue #576 single source of truth) rather
//! than inventing a second one; `tests/fixtures/adv_dollar_10d_parity.json`
//! pins both sides to the same window so they cannot drift apart.

use crate::models::MarketData;
use crate::utils::{
    extract_symbol_from_ticker, is_market_data_csv_empty, read_market_data, write_atomically,
};
use anyhow::{anyhow, Result};
use chrono::{Duration, NaiveDate};
use std::path::Path;

/// Trailing weekday window used for dollar ADV — the `WEEKDAY_WINDOW` of
/// `docs/volume_recommend.js`. Daily market-data rows are already weekdays, so
/// the trailing ten rows on or before the score date *are* the last ten
/// weekdays.
pub const ADV_WINDOW_ROWS: usize = 10;

/// How many trading rows back the "five-day-prior" close is taken from. Trading
/// rows, not calendar days, so the 5-day return is comparable across weekends
/// and holidays.
pub const FIVE_DAY_ROWS: usize = 5;

/// Length of the look-back window, in calendar days: one year up to and
/// including the score date.
const LOOKBACK_DAYS: i64 = 365;

/// The sidecar's column header — the raw inputs, in order.
const SIDECAR_HEADER: [&str; 6] = [
    "ticker",
    "week52_low",
    "week52_high",
    "close_score_date",
    "close_5d_prior",
    "adv_dollar_10d",
];

/// One day's dollar-volume inputs, already parsed. `None` marks a value the
/// upstream data could not supply (missing, blank, non-numeric or non-positive).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DollarVolumeDay {
    /// Volume traded on the day.
    pub volume: Option<f64>,
    /// The day's low price.
    pub low: Option<f64>,
}

/// Coerces a raw upstream value to a finite, strictly-positive number.
///
/// Mirrors `toFinitePositive` in `docs/volume_recommend.js`: a blank, a
/// non-numeric string, a zero or a negative is "unknown", never a usable
/// figure.
fn finite_positive(raw: &str) -> Option<f64> {
    match raw.trim().parse::<f64>() {
        Ok(value) if value.is_finite() && value > 0.0 => Some(value),
        _ => None,
    }
}

/// Mean of `volume × low` over `window`, or `None` when no day in it carries
/// both a usable volume and a usable low.
///
/// This is the Rust half of the single dollar-ADV definition: it mirrors
/// `averageDollarVolume` in `docs/volume_recommend.js` exactly — unusable days
/// are *skipped* and the mean divides by the days that remain, so a day with no
/// volume never drags the average towards zero, and a window with nothing
/// usable is unknown rather than `0.0`.
pub fn average_dollar_volume(window: &[DollarVolumeDay]) -> Option<f64> {
    let mut sum = 0.0;
    let mut days = 0u32;

    for day in window {
        if let (Some(volume), Some(low)) = (day.volume, day.low) {
            sum += volume * low;
            days += 1;
        }
    }

    (days > 0).then(|| sum / f64::from(days))
}

/// The sidecar path for a score file: `docs/scores/2026/July/19.tsv` →
/// `docs/scores/2026/July/19-picks.csv`.
pub fn derive_picks_csv_output_path(score_file_path: &str) -> String {
    let path = Path::new(score_file_path);
    if let Some((parent, stem)) = path.parent().zip(path.file_stem()) {
        return parent
            .join(format!("{}-picks.csv", stem.to_string_lossy()))
            .to_string_lossy()
            .into_owned();
    }
    // Fallback: just replace the extension.
    score_file_path.replace(".tsv", "-picks.csv")
}

/// One upstream daily row inside the look-back window, borrowed from the
/// market-data document so nothing is copied to compute a handful of summaries.
struct WindowRow<'a> {
    date: NaiveDate,
    high: &'a str,
    low: &'a str,
    close: &'a str,
    volume: &'a str,
}

/// The six sidecar fields for one ticker; `None` renders as a blank cell.
struct PickDetails {
    week52_low: Option<String>,
    week52_high: Option<String>,
    close_score_date: Option<String>,
    close_5d_prior: Option<String>,
    adv_dollar_10d: Option<f64>,
}

impl PickDetails {
    /// The row as written, with every unknown value blank rather than zero.
    fn to_record(&self, ticker: &str) -> [String; 6] {
        let blank = String::new();
        [
            ticker.to_string(),
            self.week52_low.clone().unwrap_or_else(|| blank.clone()),
            self.week52_high.clone().unwrap_or_else(|| blank.clone()),
            self.close_score_date
                .clone()
                .unwrap_or_else(|| blank.clone()),
            self.close_5d_prior.clone().unwrap_or_else(|| blank.clone()),
            self.adv_dollar_10d.map_or(blank, |adv| format!("{adv:.2}")),
        ]
    }
}

/// Collects the rows in `score_date - 365 days ..= score_date`, oldest first.
fn window_rows(market_data: &MarketData, score_date: NaiveDate) -> Vec<WindowRow<'_>> {
    let start = score_date - Duration::days(LOOKBACK_DAYS);

    let mut rows: Vec<WindowRow<'_>> = market_data
        .time_series_daily
        .iter()
        .filter_map(|(raw_date, daily)| {
            let date = NaiveDate::parse_from_str(raw_date, "%Y-%m-%d").ok()?;
            (date >= start && date <= score_date).then_some(WindowRow {
                date,
                high: &daily.high,
                low: &daily.low,
                close: &daily.close,
                volume: &daily.volume,
            })
        })
        .collect();

    rows.sort_by_key(|row| row.date);
    rows
}

/// The raw value of the row holding the extreme of `field`, or `None` when no
/// row in the window carries a usable one.
fn extreme<'a>(
    rows: &[WindowRow<'a>],
    field: fn(&WindowRow<'a>) -> &'a str,
    keep_larger: bool,
) -> Option<String> {
    rows.iter()
        .filter_map(|row| {
            let raw = field(row);
            finite_positive(raw).map(|value| (value, raw))
        })
        .reduce(|best, candidate| {
            let take_candidate = if keep_larger {
                candidate.0 > best.0
            } else {
                candidate.0 < best.0
            };
            if take_candidate {
                candidate
            } else {
                best
            }
        })
        .map(|(_, raw)| raw.to_string())
}

/// Computes the sidecar figures for one ticker over its look-back window.
///
/// The window is oldest-first, so its last row is the as-at row: the latest
/// trading row on or before the score date.
fn pick_details(rows: &[WindowRow<'_>]) -> PickDetails {
    let usable_close = |index: usize| {
        rows.get(index)
            .filter(|row| finite_positive(row.close).is_some())
            .map(|row| row.close.to_string())
    };

    // The five-day-prior close is five TRADING rows back from the as-at row, so
    // it needs six rows in hand; anything shorter stays blank.
    let close_5d_prior = rows
        .len()
        .checked_sub(FIVE_DAY_ROWS + 1)
        .and_then(usable_close);

    // The dollar ADV is a *ten-weekday* mean: a shorter history cannot produce
    // one, and reporting a mean over three days as if it were ten would be a
    // wrong number rather than an unknown one.
    let adv_dollar_10d = (rows.len() >= ADV_WINDOW_ROWS)
        .then(|| {
            let window: Vec<DollarVolumeDay> = rows[rows.len() - ADV_WINDOW_ROWS..]
                .iter()
                .map(|row| DollarVolumeDay {
                    volume: finite_positive(row.volume),
                    low: finite_positive(row.low),
                })
                .collect();
            average_dollar_volume(&window)
        })
        .flatten();

    PickDetails {
        week52_low: extreme(rows, |row| row.low, false),
        week52_high: extreme(rows, |row| row.high, true),
        close_score_date: rows.len().checked_sub(1).and_then(usable_close),
        close_5d_prior,
        adv_dollar_10d,
    }
}

/// Writes the pick-details sidecar for `tickers` as at `score_file_date`.
///
/// One row per ticker whose upstream market data holds at least one row in the
/// look-back window. A ticker whose symbol is missing upstream, or that has no
/// rows in the window, is skipped with a warning rather than failing the run —
/// the same posture as the long-format market-data writer.
///
/// The CSV is buffered in memory and only written once the run knows it has
/// rows, so a run that finds nothing upstream can never truncate an
/// already-populated sidecar to a header-only file (the issue #687 class).
///
/// # Errors
///
/// Returns an error if `score_file_date` is not a valid `%Y-%m-%d` date, the
/// CSV cannot be serialised or written, or every ticker was skipped so no rows
/// were written — a run that produced nothing must fail loud rather than report
/// a silent success.
pub fn create_picks_sidecar_csv(
    market_root: &Path,
    tickers: &[String],
    score_file_date: &str,
    output_path: &str,
) -> Result<()> {
    let score_date = NaiveDate::parse_from_str(score_file_date, "%Y-%m-%d")?;
    let start_date = score_date - Duration::days(LOOKBACK_DAYS);
    let root_display = market_root.display();

    let mut writer = csv::Writer::from_writer(Vec::new());
    writer.write_record(SIDECAR_HEADER)?;
    let mut rows_written = 0u64;

    for ticker in tickers {
        // The symbol is attacker-influenceable, so the upstream path is built
        // through the traversal-guarded reader (issue #182) rather than by
        // string interpolation.
        let symbol = extract_symbol_from_ticker(ticker);
        let market_data = match read_market_data(market_root, &symbol) {
            Ok(data) => data,
            Err(error) => {
                log::warn!("Skipping {ticker} ({symbol}): {error}");
                continue;
            }
        };

        let rows = window_rows(&market_data, score_date);
        if rows.is_empty() {
            log::warn!(
                "Skipping {ticker} ({symbol}): no market data between {start} and {score_file_date}",
                start = start_date.format("%Y-%m-%d")
            );
            continue;
        }

        writer.write_record(pick_details(&rows).to_record(ticker))?;
        rows_written += 1;
    }

    writer.flush()?;
    let csv_bytes = writer
        .into_inner()
        .map_err(|error| anyhow!("failed to finalise pick-details CSV buffer: {error}"))?;

    if rows_written == 0 {
        // Nothing fresh for this date. Never replace an already-populated
        // sidecar with a header-only file (issue #687): leave the existing rows
        // in place and still surface the upstream gap.
        if !is_market_data_csv_empty(output_path) {
            log::warn!(
                "Preserving existing pick details at {output_path}: no fresh rows for {score_file_date}"
            );
            if !tickers.is_empty() {
                return Err(anyhow!(
                    "No pick-details rows written for {score_file_date} — existing sidecar at \
                     {output_path} preserved; is {root_display} available and up to date?"
                ));
            }
            return Ok(());
        }

        // Nothing worth preserving: write the header-only placeholder so a
        // genuinely-new date still gets a file, then surface the same error.
        write_atomically(output_path, &csv_bytes)?;
        if !tickers.is_empty() {
            return Err(anyhow!(
                "No pick-details rows written for {score_file_date} — \
                 is {root_display} available and up to date?"
            ));
        }
        return Ok(());
    }

    write_atomically(output_path, &csv_bytes)?;

    Ok(())
}

/// Writes the pick-details sidecar beside `score_file_path` and returns the
/// path written.
///
/// # Errors
///
/// Returns an error if the sidecar cannot be built or written (see
/// [`create_picks_sidecar_csv`]).
pub fn create_picks_sidecar_csv_for_score_file(
    market_root: &Path,
    score_file_path: &str,
    tickers: &[String],
    score_file_date: &str,
) -> Result<String> {
    let output_path = derive_picks_csv_output_path(score_file_path);
    create_picks_sidecar_csv(market_root, tickers, score_file_date, &output_path)?;
    Ok(output_path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day(volume: Option<f64>, low: Option<f64>) -> DollarVolumeDay {
        DollarVolumeDay { volume, low }
    }

    #[test]
    fn average_dollar_volume_means_volume_times_low() {
        let window = [day(Some(1000.0), Some(10.0)), day(Some(2000.0), Some(20.0))];
        assert_eq!(average_dollar_volume(&window), Some(25_000.0));
    }

    #[test]
    fn average_dollar_volume_skips_unusable_days_instead_of_counting_zero() {
        // The unusable day must not drag the mean down: dividing by the usable
        // days is what keeps the backend and docs/volume_recommend.js in step.
        let window = [
            day(Some(1000.0), Some(10.0)),
            day(None, Some(20.0)),
            day(Some(2000.0), None),
        ];
        assert_eq!(average_dollar_volume(&window), Some(10_000.0));
    }

    #[test]
    fn average_dollar_volume_is_unknown_when_no_day_is_usable() {
        assert_eq!(average_dollar_volume(&[]), None);
        assert_eq!(average_dollar_volume(&[day(None, None)]), None);
    }

    #[test]
    fn finite_positive_rejects_blank_zero_and_rubbish() {
        assert_eq!(finite_positive("10.5"), Some(10.5));
        assert_eq!(finite_positive(" 10.5 "), Some(10.5));
        assert_eq!(finite_positive(""), None);
        assert_eq!(finite_positive("0"), None);
        assert_eq!(finite_positive("-3"), None);
        assert_eq!(finite_positive("not-a-number"), None);
        assert_eq!(finite_positive("inf"), None);
    }

    #[test]
    fn derive_picks_csv_output_path_appends_the_picks_suffix() {
        assert_eq!(
            derive_picks_csv_output_path("docs/scores/2026/July/19.tsv"),
            "docs/scores/2026/July/19-picks.csv"
        );
        assert_eq!(derive_picks_csv_output_path("19.tsv"), "19-picks.csv");
    }
}
