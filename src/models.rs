use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct StockRecord {
    pub stock: String,
    pub score: f64,
    pub target: f64,
    pub ex_dividend_date: Option<String>,
    pub dividend_per_share: Option<f64>,
    pub notes: Option<String>,
    pub intrinsic_value_per_share_basic: Option<f64>,
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
pub struct ScoreEntry {
    pub date: String,
    pub path: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct IndexData {
    pub scores: Vec<ScoreEntry>,
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
        assert_eq!(
            deserialized.intrinsic_value_per_share_basic,
            record.intrinsic_value_per_share_basic
        );
        assert_eq!(
            deserialized.intrinsic_value_per_share_adjusted,
            record.intrinsic_value_per_share_adjusted
        );
    }

    #[test]
    fn test_score_entry_creation() {
        let entry = ScoreEntry {
            date: "2025-06-20".to_string(),
            path: "2025/June/20.tsv".to_string(),
        };

        assert_eq!(entry.date, "2025-06-20");
        assert_eq!(entry.path, "2025/June/20.tsv");
    }

    #[test]
    fn test_index_data_creation() {
        let entry1 = ScoreEntry {
            date: "2025-06-20".to_string(),
            path: "2025/June/20.tsv".to_string(),
        };

        let entry2 = ScoreEntry {
            date: "2025-06-21".to_string(),
            path: "2025/June/21.tsv".to_string(),
        };

        let index_data = IndexData {
            scores: vec![entry1, entry2],
        };

        assert_eq!(index_data.scores.len(), 2);
        assert_eq!(index_data.scores[0].date, "2025-06-20");
        assert_eq!(index_data.scores[1].date, "2025-06-21");
    }
}
