//! Regression test for issue #672: the 2026 market-data CSVs were committed as
//! header-only files (present but empty of data rows), which forced the
//! dashboard into "Limited data mode" for every 2026 date.
//!
//! These tests pin the restored state of the committed data: the named symptom
//! date `2026-03-30` (and a second 2026 date) must carry real OHLC rows, not a
//! lone header line. They read the files exactly as the frontend
//! (`docs/app.js loadMarketData()`) and the backend
//! (`read_market_data_from_csv`) do, so they fail against the unfixed,
//! header-only data and pass once the rows are restored.
//!
//! Scope: this is the fix half of #671 — restoring the data. The broader
//! data-presence quality gate that scans every score file is tracked
//! separately under #671 and is intentionally not implemented here.

use grq_validation::utils::{is_market_data_csv_empty, read_market_data_from_csv};

/// The exact symptom date from the issue, plus one more 2026 date to show the
/// restoration is not limited to a single file.
const RESTORED_CSVS: &[(&str, &str)] = &[
    ("docs/scores/2026/March/30.csv", "NYSE:SITC"),
    ("docs/scores/2026/January/15.csv", ""),
    // Issue #685: the reported symptom date. A recurring external "Auto commit
    // models" push had re-wiped every 2026 CSV back to a lone header line,
    // breaking https://stsoftwareau.github.io/GRQ-validation/?date=2026-04-02
    ("docs/scores/2026/April/02.csv", "NASDAQ:ADI"),
];

#[test]
fn symptom_date_csv_is_not_header_only() {
    let path = "docs/scores/2026/March/30.csv";
    assert!(
        !is_market_data_csv_empty(path),
        "{path} must contain market-data rows, not just a header (issue #672)"
    );
}

#[test]
fn restored_2026_csvs_have_real_ohlc_rows() {
    for (path, _) in RESTORED_CSVS {
        assert!(
            !is_market_data_csv_empty(path),
            "{path} is header-only — 2026 market data was not restored (issue #672)"
        );

        let market = read_market_data_from_csv(path)
            .unwrap_or_else(|error| panic!("failed to read {path}: {error}"));

        let row_count: usize = market
            .closes
            .values()
            .map(std::collections::HashMap::len)
            .sum();
        assert!(
            row_count > 0,
            "{path} parsed to zero close prices — the dashboard would show Limited data mode"
        );

        // Every retained close price must be a usable, positive number.
        for (ticker, by_date) in &market.closes {
            for (date, close) in by_date {
                assert!(
                    *close > 0.0,
                    "{path}: {ticker} on {date} has a non-positive close ({close})"
                );
            }
        }
    }
}

#[test]
fn symptom_date_csv_carries_the_expected_ticker() {
    let path = "docs/scores/2026/March/30.csv";
    let expected_ticker = "NYSE:SITC";

    let market = read_market_data_from_csv(path)
        .unwrap_or_else(|error| panic!("failed to read {path}: {error}"));

    let series = market.closes.get(expected_ticker).unwrap_or_else(|| {
        panic!("{path} is missing OHLC rows for {expected_ticker} (issue #672)")
    });
    assert!(
        !series.is_empty(),
        "{path}: {expected_ticker} has no close prices after restoration"
    );
}

/// Issue #685: the dashboard URL in the report is `?date=2026-04-02`. Pin that
/// exact date so a future re-wipe of `docs/scores/2026/April/02.csv` fails the
/// build instead of silently degrading the page to "Limited data mode".
#[test]
fn issue_685_symptom_date_csv_carries_real_ohlc_rows() {
    let path = "docs/scores/2026/April/02.csv";
    let expected_ticker = "NASDAQ:ADI";

    assert!(
        !is_market_data_csv_empty(path),
        "{path} is header-only — 2026-04-02 market data was re-wiped (issue #685)"
    );

    let market = read_market_data_from_csv(path)
        .unwrap_or_else(|error| panic!("failed to read {path}: {error}"));

    let series = market.closes.get(expected_ticker).unwrap_or_else(|| {
        panic!("{path} is missing OHLC rows for {expected_ticker} (issue #685)")
    });
    assert!(
        !series.is_empty(),
        "{path}: {expected_ticker} has no close prices after restoration (issue #685)"
    );
}
