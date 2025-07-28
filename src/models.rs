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
            "Failed to parse currency value '{}' as float: {}",
            s, e
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
                cleaned
                    .parse::<f64>()
                    .map(Some)
                    .map_err(|e| {
                        serde::de::Error::custom(format!(
                            "Failed to parse currency value '{}' as float: {}",
                            trimmed, e
                        ))
                    })
            }
        }
        None => Ok(None),
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StockRecord {
    #[serde(rename = "Stock")]
    pub stock: String,
    #[serde(rename = "Score")]
    pub score: f64,
    #[serde(
        rename = "Target",
        serialize_with = "serialize_currency",
        deserialize_with = "deserialize_currency"
    )]
    pub target: f64,
    #[serde(rename = "ExDividendDate")]
    pub ex_dividend_date: Option<String>,
    #[serde(rename = "DividendPerShare")]
    pub dividend_per_share: Option<f64>,
    #[serde(rename = "Notes")]
    pub notes: Option<String>,
    #[serde(
        rename = "intrinsicValuePerShareBasic",
        serialize_with = "serialize_optional_currency",
        deserialize_with = "deserialize_optional_currency"
    )]
    pub intrinsic_value_per_share_basic: Option<f64>,
    #[serde(
        rename = "intrinsicValuePerShareAdjusted",
        serialize_with = "serialize_optional_currency",
        deserialize_with = "deserialize_optional_currency"
    )]
    pub intrinsic_value_per_share_adjusted: Option<f64>,
}

impl StockRecord {
    #[allow(dead_code)]
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

#[derive(Debug, Serialize, Deserialize)]
pub struct MarketDataMeta {
    #[serde(rename = "1. Information")]
    pub information: String,
    #[serde(rename = "2. Symbol")]
    pub symbol: String,
    #[serde(rename = "3. Last Refreshed")]
    pub last_refreshed: String,
    #[serde(rename = "4. Output Size")]
    pub output_size: String,
    #[serde(rename = "5. Time Zone")]
    pub time_zone: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DailyData {
    #[serde(rename = "1. open")]
    pub open: String,
    #[serde(rename = "2. high")]
    pub high: String,
    #[serde(rename = "3. low")]
    pub low: String,
    #[serde(rename = "4. close")]
    pub close: String,
    #[serde(rename = "5. adjusted close")]
    pub adjusted_close: String,
    #[serde(rename = "6. volume")]
    pub volume: String,
    #[serde(rename = "7. dividend amount")]
    pub dividend_amount: String,
    #[serde(rename = "8. split coefficient")]
    pub split_coefficient: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MarketData {
    #[serde(rename = "Meta Data")]
    pub meta_data: MarketDataMeta,
    #[serde(rename = "Time Series (Daily)")]
    pub time_series_daily: std::collections::HashMap<String, DailyData>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct IndexData {
    pub scores: Vec<ScoreEntry>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ScoreEntry {
    #[serde(rename = "year")]
    pub year: String,
    #[serde(rename = "month")]
    pub month: String,
    #[serde(rename = "day")]
    pub day: String,
    #[serde(rename = "file")]
    pub file: String,
    #[serde(rename = "date")]
    pub date: String,
    #[serde(rename = "performance_90_day", skip_serializing_if = "Option::is_none")]
    pub performance_90_day: Option<f64>,
    #[serde(
        rename = "performance_annualized",
        skip_serializing_if = "Option::is_none"
    )]
    pub performance_annualized: Option<f64>,
    #[serde(rename = "total_stocks", skip_serializing_if = "Option::is_none")]
    pub total_stocks: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DividendRecord {
    #[serde(rename = "ex_dividend_date")]
    pub ex_dividend_date: String,
    #[serde(rename = "declaration_date")]
    pub declaration_date: Option<String>,
    #[serde(rename = "record_date")]
    pub record_date: Option<String>,
    #[serde(rename = "payment_date")]
    pub payment_date: Option<String>,
    #[serde(rename = "amount")]
    pub amount: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DividendData {
    pub symbol: String,
    pub data: Vec<DividendRecord>,
}

#[derive(Debug, Clone)]
pub struct StockPerformance {
    pub ticker: String,
    pub buy_price: f64,
    pub target_price: f64,
    pub current_price: f64,
    pub gain_loss_percent: f64,
    pub dividends_total: f64,
    pub total_return_percent: f64,
}

#[derive(Debug)]
pub struct PortfolioPerformance {
    pub score_date: String,
    pub total_stocks: i32,
    pub performance_90_day: f64,
    pub performance_annualized: f64,
    pub individual_performances: Vec<StockPerformance>,
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
            let result = deserialize_currency(&mut serde_json::Deserializer::from_str(&format!("\"{}\"", input)));
            match result {
                Ok(value) => {
                    assert!(
                        (value - expected).abs() < 0.01,
                        "Failed to parse '{}': expected {}, got {}",
                        input, expected, value
                    );
                }
                Err(e) => {
                    panic!("Failed to parse '{}': {}", input, e);
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
