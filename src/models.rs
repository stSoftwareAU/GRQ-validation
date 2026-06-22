use serde::{Deserialize, Serialize};

/// Custom serializer for currency values that formats them with dollar signs and commas
fn serialize_currency<S>(value: &f64, serializer: S) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    // Format with dollar sign and commas for thousands
    let formatted = format!("${value:.2}");
    serializer.serialize_str(&formatted)
}

/// Custom deserializer for currency values that may contain dollar signs and commas
fn deserialize_currency<'de, D>(deserializer: D) -> Result<f64, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let s: String = Deserialize::deserialize(deserializer)?;

    // Remove dollar sign and commas, then parse as float
    // Handle negative values with currency formatting like "-$45,749.70"
    let cleaned = s.replace(['$', ','], "");

    cleaned.parse::<f64>().map_err(|e| {
        serde::de::Error::custom(format!(
            "Failed to parse currency value '{s}' as float: {e}"
        ))
    })
}

/// Custom serializer for optional currency values
fn serialize_optional_currency<S>(value: &Option<f64>, serializer: S) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    match value {
        Some(v) => {
            // Format with dollar sign and commas for thousands
            let formatted = format!("${v:.2}");
            serializer.serialize_str(&formatted)
        }
        None => serializer.serialize_none(),
    }
}

/// Custom deserializer for optional currency values
fn deserialize_optional_currency<'de, D>(deserializer: D) -> Result<Option<f64>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let s: Option<String> = Deserialize::deserialize(deserializer)?;

    match s {
        Some(s) => {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                Ok(None)
            } else {
                // Remove dollar sign and commas, then parse as float
                // Handle negative values with currency formatting like "-$45,749.70"
                let cleaned = trimmed.replace(['$', ','], "");
                cleaned.parse::<f64>().map(Some).map_err(|e| {
                    serde::de::Error::custom(format!(
                        "Failed to parse currency value '{trimmed}' as float: {e}"
                    ))
                })
            }
        }
        None => Ok(None),
    }
}

/// A single row from a daily score TSV file describing one stock.
#[derive(Debug, Serialize, Deserialize)]
pub struct StockRecord {
    /// Full ticker symbol, e.g. `"NYSE:SEM"`.
    #[serde(rename = "Stock")]
    pub stock: String,
    /// Analyst score for the stock.
    #[serde(rename = "Score")]
    pub score: f64,
    /// Target price (parsed from currency-formatted text such as `"$22.63"`).
    #[serde(
        rename = "Target",
        serialize_with = "serialize_currency",
        deserialize_with = "deserialize_currency"
    )]
    pub target: f64,
    /// Ex-dividend date, when supplied by the source file.
    #[serde(rename = "ExDividendDate")]
    pub ex_dividend_date: Option<String>,
    /// Dividend paid per share, when supplied.
    #[serde(rename = "DividendPerShare")]
    pub dividend_per_share: Option<f64>,
    /// Free-text notes from the source file.
    #[serde(rename = "Notes")]
    pub notes: Option<String>,
    /// Basic intrinsic value per share (parsed from currency text).
    #[serde(
        rename = "intrinsicValuePerShareBasic",
        serialize_with = "serialize_optional_currency",
        deserialize_with = "deserialize_optional_currency"
    )]
    pub intrinsic_value_per_share_basic: Option<f64>,
    /// Adjusted intrinsic value per share (parsed from currency text).
    #[serde(
        rename = "intrinsicValuePerShareAdjusted",
        serialize_with = "serialize_optional_currency",
        deserialize_with = "deserialize_optional_currency"
    )]
    pub intrinsic_value_per_share_adjusted: Option<f64>,
}

impl StockRecord {
    /// Creates a `StockRecord` with the given `stock`, `score` and `target`,
    /// leaving the optional fields unset.
    pub fn new(stock: String, score: f64, target: f64) -> Self {
        Self {
            stock,
            score,
            target,
            ex_dividend_date: None,
            dividend_per_share: None,
            notes: None,
            intrinsic_value_per_share_basic: None,
            intrinsic_value_per_share_adjusted: None,
        }
    }
}

/// Metadata block of an Alpha Vantage daily time-series JSON file.
#[derive(Debug, Serialize, Deserialize)]
pub struct MarketDataMeta {
    /// Human-readable description of the series.
    #[serde(rename = "1. Information")]
    pub information: String,
    /// Ticker symbol the series belongs to.
    #[serde(rename = "2. Symbol")]
    pub symbol: String,
    /// Timestamp of the most recent refresh.
    #[serde(rename = "3. Last Refreshed")]
    pub last_refreshed: String,
    /// Output size (e.g. `"Compact"` or `"Full size"`).
    #[serde(rename = "4. Output Size")]
    pub output_size: String,
    /// Time zone the timestamps are expressed in.
    #[serde(rename = "5. Time Zone")]
    pub time_zone: String,
}

/// One day's adjusted OHLCV figures from a market-data time series.
#[derive(Debug, Serialize, Deserialize)]
pub struct DailyData {
    /// Opening price.
    #[serde(rename = "1. open")]
    pub open: String,
    /// Highest traded price.
    #[serde(rename = "2. high")]
    pub high: String,
    /// Lowest traded price.
    #[serde(rename = "3. low")]
    pub low: String,
    /// Closing price.
    #[serde(rename = "4. close")]
    pub close: String,
    /// Split/dividend-adjusted closing price.
    #[serde(rename = "5. adjusted close")]
    pub adjusted_close: String,
    /// Traded volume.
    #[serde(rename = "6. volume")]
    pub volume: String,
    /// Dividend amount paid on this date.
    #[serde(rename = "7. dividend amount")]
    pub dividend_amount: String,
    /// Split coefficient applied on this date.
    #[serde(rename = "8. split coefficient")]
    pub split_coefficient: String,
}

/// Split-relevant daily figures parsed from the derived market-data CSV.
///
/// `high`/`low` feed the price-ratio reconciliation cross-check used to judge
/// whether a split series can be trusted (issue #294). The close price is held
/// separately in [`MarketDataCsv::closes`] and is not duplicated here.
#[derive(Debug, Clone, PartialEq)]
pub struct DailyMarketPoint {
    /// Highest traded price for the day.
    pub high: f64,
    /// Lowest traded price for the day.
    pub low: f64,
    /// Split coefficient applied on this date (`1.0` means no split).
    pub split_coefficient: f64,
}

/// Result of parsing a derived market-data CSV.
///
/// `closes` preserves the original `ticker -> date -> close` shape consumed by
/// existing callers; `points` carries the split-relevant figures used to
/// correct-or-exclude split-distorted stocks (issue #294).
#[derive(Debug, Default)]
pub struct MarketDataCsv {
    /// `ticker -> date -> close price`.
    pub closes: std::collections::HashMap<String, std::collections::HashMap<String, f64>>,
    /// `ticker -> date -> split-relevant daily figures`.
    pub points:
        std::collections::HashMap<String, std::collections::HashMap<String, DailyMarketPoint>>,
}

/// A full market-data file: metadata plus the daily time series keyed by date.
#[derive(Debug, Serialize, Deserialize)]
pub struct MarketData {
    /// Series metadata.
    #[serde(rename = "Meta Data")]
    pub meta_data: MarketDataMeta,
    /// Daily figures keyed by `YYYY-MM-DD` date string.
    #[serde(rename = "Time Series (Daily)")]
    pub time_series_daily: std::collections::HashMap<String, DailyData>,
}

/// Top-level structure of `docs/scores/index.json`.
#[derive(Debug, Serialize, Deserialize)]
pub struct IndexData {
    /// All known score entries, one per daily score file.
    pub scores: Vec<ScoreEntry>,
}

/// A single entry in the scores index, describing one daily score file and its
/// computed performance.
#[derive(Debug, Serialize, Deserialize)]
pub struct ScoreEntry {
    /// Year component of the score date.
    #[serde(rename = "year")]
    pub year: String,
    /// Month component (full name, e.g. `"June"`).
    #[serde(rename = "month")]
    pub month: String,
    /// Day-of-month component.
    #[serde(rename = "day")]
    pub day: String,
    /// Relative path to the score file under `docs/scores/`.
    #[serde(rename = "file")]
    pub file: String,
    /// Score date in `YYYY-MM-DD` form.
    #[serde(rename = "date")]
    pub date: String,
    /// 90-day portfolio performance, once calculated.
    #[serde(rename = "performance_90_day", skip_serializing_if = "Option::is_none")]
    pub performance_90_day: Option<f64>,
    /// Annualised portfolio performance, once calculated.
    #[serde(
        rename = "performance_annualized",
        skip_serializing_if = "Option::is_none"
    )]
    pub performance_annualized: Option<f64>,
    /// Number of stocks contributing to the performance figures.
    #[serde(rename = "total_stocks", skip_serializing_if = "Option::is_none")]
    pub total_stocks: Option<i32>,
}

/// A single dividend event for a stock.
#[derive(Debug, Serialize, Deserialize)]
pub struct DividendRecord {
    /// Ex-dividend date in `YYYY-MM-DD` form.
    #[serde(rename = "ex_dividend_date")]
    pub ex_dividend_date: String,
    /// Declaration date, when known.
    #[serde(rename = "declaration_date")]
    pub declaration_date: Option<String>,
    /// Record date, when known.
    #[serde(rename = "record_date")]
    pub record_date: Option<String>,
    /// Payment date, when known.
    #[serde(rename = "payment_date")]
    pub payment_date: Option<String>,
    /// Dividend amount per share, as raw text.
    #[serde(rename = "amount")]
    pub amount: String,
}

/// All dividend events for a single stock.
#[derive(Debug, Serialize, Deserialize)]
pub struct DividendData {
    /// Ticker symbol the dividends belong to.
    pub symbol: String,
    /// The dividend events, in source order.
    pub data: Vec<DividendRecord>,
}

/// Computed 90-day performance for a single stock within a portfolio.
#[derive(Debug, Clone)]
pub struct StockPerformance {
    /// Full ticker symbol.
    pub ticker: String,
    /// Buy price (close on, or just after, the score date).
    pub buy_price: f64,
    /// Analyst target price from the score file.
    pub target_price: f64,
    /// Latest price within the 90-day window.
    pub current_price: f64,
    /// Price gain/loss over the period, as a percentage.
    pub gain_loss_percent: f64,
    /// Total dividends received over the period.
    pub dividends_total: f64,
    /// Total return (price plus dividends), as a percentage.
    pub total_return_percent: f64,
}

/// Aggregated performance of a whole portfolio for one score date.
#[derive(Debug)]
pub struct PortfolioPerformance {
    /// Score date the figures relate to (`YYYY-MM-DD`).
    pub score_date: String,
    /// Number of stocks with both usable buy and current prices (included in performance calculation).
    pub total_stocks: i32,
    /// Average 90-day total return across the portfolio, as a percentage.
    pub performance_90_day: f64,
    /// Annualised equivalent of the 90-day return, as a percentage.
    pub performance_annualized: f64,
    /// Per-stock performance breakdown.
    pub individual_performances: Vec<StockPerformance>,
    /// Tickers excluded because they lack a usable buy price or current price.
    pub excluded_tickers: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stock_record_new() {
        let record = StockRecord::new("AAPL".to_string(), 0.95, 150.0);
        assert_eq!(record.stock, "AAPL");
        assert_eq!(record.score, 0.95);
        assert_eq!(record.target, 150.0);
        assert!(record.ex_dividend_date.is_none());
        assert!(record.dividend_per_share.is_none());
        assert!(record.notes.is_none());
        assert!(record.intrinsic_value_per_share_basic.is_none());
        assert!(record.intrinsic_value_per_share_adjusted.is_none());
    }

    #[test]
    fn test_stock_record_serialization() {
        let record = StockRecord {
            stock: "NYSE:SEM".to_string(),
            score: 1.0,
            target: 22.63,
            ex_dividend_date: Some("2025-05-15".to_string()),
            dividend_per_share: Some(0.09375),
            notes: Some("Buy 422 at $15.09 ~= $6,368".to_string()),
            intrinsic_value_per_share_basic: Some(19.44923627342789),
            intrinsic_value_per_share_adjusted: Some(28.69295242211238),
        };

        let json = serde_json::to_string(&record).unwrap();
        let deserialized: StockRecord = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.stock, record.stock);
        assert_eq!(deserialized.score, record.score);
        assert_eq!(deserialized.target, record.target);
        assert_eq!(deserialized.ex_dividend_date, record.ex_dividend_date);
        assert_eq!(deserialized.dividend_per_share, record.dividend_per_share);
        assert_eq!(deserialized.notes, record.notes);

        // Currency values are rounded to 2 decimal places during serialization
        assert!((deserialized.intrinsic_value_per_share_basic.unwrap() - 19.45).abs() < 0.01);
        assert!((deserialized.intrinsic_value_per_share_adjusted.unwrap() - 28.69).abs() < 0.01);
    }

    #[test]
    fn test_currency_deserialization_with_negative_values() {
        // Test that negative currency values with formatting are parsed correctly
        let test_cases = vec![
            ("-$45,749.70", -45749.70),
            ("-$45,568.43", -45568.43),
            ("-$1,414.96", -1414.96),
            ("-$7,075.94", -7075.94),
            ("$18.42", 18.42),
            ("$27.56", 27.56),
            ("$3,208.46", 3208.46),
            ("$3,427.71", 3427.71),
        ];

        for (input, expected) in test_cases {
            let result = deserialize_currency(&mut serde_json::Deserializer::from_str(&format!(
                "\"{input}\""
            )));
            match result {
                Ok(value) => {
                    assert!(
                        (value - expected).abs() < 0.01,
                        "Failed to parse '{input}': expected {expected}, got {value}"
                    );
                }
                Err(e) => {
                    panic!("Failed to parse '{input}': {e}");
                }
            }
        }
    }

    #[test]
    fn test_score_entry_creation() {
        let entry = ScoreEntry {
            year: "2025".to_string(),
            month: "June".to_string(),
            day: "20".to_string(),
            file: "2025/June/20.tsv".to_string(),
            date: "2025-06-20".to_string(),
            performance_90_day: None,
            performance_annualized: None,
            total_stocks: None,
        };

        assert_eq!(entry.date, "2025-06-20");
        assert_eq!(entry.file, "2025/June/20.tsv");
    }

    #[test]
    fn test_index_data_creation() {
        let entry1 = ScoreEntry {
            year: "2025".to_string(),
            month: "June".to_string(),
            day: "20".to_string(),
            file: "2025/June/20.tsv".to_string(),
            date: "2025-06-20".to_string(),
            performance_90_day: None,
            performance_annualized: None,
            total_stocks: None,
        };

        let entry2 = ScoreEntry {
            year: "2025".to_string(),
            month: "June".to_string(),
            day: "21".to_string(),
            file: "2025/June/21.tsv".to_string(),
            date: "2025-06-21".to_string(),
            performance_90_day: None,
            performance_annualized: None,
            total_stocks: None,
        };

        let index_data = IndexData {
            scores: vec![entry1, entry2],
        };

        assert_eq!(index_data.scores.len(), 2);
        assert_eq!(index_data.scores[0].date, "2025-06-20");
        assert_eq!(index_data.scores[1].date, "2025-06-21");
    }
}
