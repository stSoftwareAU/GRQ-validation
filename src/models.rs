use serde::{Deserialize, Serialize};
use chrono::NaiveDate;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StockRecord {
    pub stock: String,
    pub score: f64,
    pub target: f64,
    pub ex_dividend_date: Option<NaiveDate>,
    pub dividend_per_share: Option<f64>,
    pub notes: Option<String>,
    pub intrinsic_value_per_share_basic: f64,
    pub intrinsic_value_per_share_adjusted: f64,
}

impl StockRecord {
    pub fn new(
        stock: String,
        score: f64,
        target: f64,
        intrinsic_value_per_share_basic: f64,
        intrinsic_value_per_share_adjusted: f64,
    ) -> Self {
        Self {
            stock,
            score,
            target,
            ex_dividend_date: None,
            dividend_per_share: None,
            notes: None,
            intrinsic_value_per_share_basic,
            intrinsic_value_per_share_adjusted,
        }
    }
    
    pub fn set_dividend_info(&mut self, ex_dividend_date: Option<NaiveDate>, dividend_per_share: Option<f64>) {
        self.ex_dividend_date = ex_dividend_date;
        self.dividend_per_share = dividend_per_share;
    }
    
    pub fn set_notes(&mut self, notes: Option<String>) {
        self.notes = notes;
    }
    
    pub fn calculate_score_ratio(&self) -> f64 {
        if self.target > 0.0 {
            self.score / self.target
        } else {
            0.0
        }
    }
    
    pub fn is_undervalued(&self) -> bool {
        self.intrinsic_value_per_share_adjusted > self.target
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessedData {
    pub date: NaiveDate,
    pub records: Vec<StockRecord>,
    pub summary: ProcessingSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessingSummary {
    pub total_stocks: usize,
    pub average_score: f64,
    pub undervalued_count: usize,
    pub total_intrinsic_value: f64,
    pub total_target_value: f64,
}

impl ProcessingSummary {
    pub fn new(records: &[StockRecord]) -> Self {
        let total_stocks = records.len();
        let average_score = if total_stocks > 0 {
            records.iter().map(|r| r.score).sum::<f64>() / total_stocks as f64
        } else {
            0.0
        };
        
        let undervalued_count = records.iter().filter(|r| r.is_undervalued()).count();
        let total_intrinsic_value = records.iter().map(|r| r.intrinsic_value_per_share_adjusted).sum();
        let total_target_value = records.iter().map(|r| r.target).sum();
        
        Self {
            total_stocks,
            average_score,
            undervalued_count,
            total_intrinsic_value,
            total_target_value,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_stock_record_new() {
        let record = StockRecord::new(
            "AAPL".to_string(),
            0.95,
            150.0,
            160.0,
            165.0,
        );
        
        assert_eq!(record.stock, "AAPL");
        assert_eq!(record.score, 0.95);
        assert_eq!(record.target, 150.0);
        assert_eq!(record.intrinsic_value_per_share_basic, 160.0);
        assert_eq!(record.intrinsic_value_per_share_adjusted, 165.0);
        assert!(record.ex_dividend_date.is_none());
        assert!(record.dividend_per_share.is_none());
        assert!(record.notes.is_none());
    }
    
    #[test]
    fn test_stock_record_set_dividend_info() {
        let mut record = StockRecord::new(
            "AAPL".to_string(),
            0.95,
            150.0,
            160.0,
            165.0,
        );
        
        let ex_date = NaiveDate::from_ymd_opt(2025, 6, 20).unwrap();
        record.set_dividend_info(Some(ex_date), Some(0.25));
        
        assert_eq!(record.ex_dividend_date, Some(ex_date));
        assert_eq!(record.dividend_per_share, Some(0.25));
    }
    
    #[test]
    fn test_stock_record_set_notes() {
        let mut record = StockRecord::new(
            "AAPL".to_string(),
            0.95,
            150.0,
            160.0,
            165.0,
        );
        
        record.set_notes(Some("Strong buy recommendation".to_string()));
        
        assert_eq!(record.notes, Some("Strong buy recommendation".to_string()));
    }
    
    #[test]
    fn test_calculate_score_ratio() {
        let record = StockRecord::new(
            "AAPL".to_string(),
            0.95,
            150.0,
            160.0,
            165.0,
        );
        
        assert_eq!(record.calculate_score_ratio(), 0.95 / 150.0);
    }
    
    #[test]
    fn test_calculate_score_ratio_zero_target() {
        let record = StockRecord::new(
            "AAPL".to_string(),
            0.95,
            0.0,
            160.0,
            165.0,
        );
        
        assert_eq!(record.calculate_score_ratio(), 0.0);
    }
    
    #[test]
    fn test_is_undervalued() {
        let undervalued_record = StockRecord::new(
            "AAPL".to_string(),
            0.95,
            150.0,
            160.0,
            165.0,
        );
        
        let overvalued_record = StockRecord::new(
            "TSLA".to_string(),
            0.85,
            200.0,
            180.0,
            190.0,
        );
        
        assert!(undervalued_record.is_undervalued());
        assert!(!overvalued_record.is_undervalued());
    }
    
    #[test]
    fn test_processing_summary_new() {
        let records = vec![
            StockRecord::new("AAPL".to_string(), 0.95, 150.0, 160.0, 165.0),
            StockRecord::new("TSLA".to_string(), 0.85, 200.0, 180.0, 190.0),
            StockRecord::new("MSFT".to_string(), 0.90, 300.0, 320.0, 325.0),
        ];
        
        let summary = ProcessingSummary::new(&records);
        
        assert_eq!(summary.total_stocks, 3);
        assert_eq!(summary.average_score, (0.95 + 0.85 + 0.90) / 3.0);
        assert_eq!(summary.undervalued_count, 2); // AAPL and MSFT
        assert_eq!(summary.total_intrinsic_value, 165.0 + 190.0 + 325.0);
        assert_eq!(summary.total_target_value, 150.0 + 200.0 + 300.0);
    }
    
    #[test]
    fn test_processing_summary_empty() {
        let records: Vec<StockRecord> = vec![];
        let summary = ProcessingSummary::new(&records);
        
        assert_eq!(summary.total_stocks, 0);
        assert_eq!(summary.average_score, 0.0);
        assert_eq!(summary.undervalued_count, 0);
        assert_eq!(summary.total_intrinsic_value, 0.0);
        assert_eq!(summary.total_target_value, 0.0);
    }
    
    #[test]
    fn test_stock_record_serialization() {
        let record = StockRecord::new(
            "AAPL".to_string(),
            0.95,
            150.0,
            160.0,
            165.0,
        );
        
        let json = serde_json::to_string(&record).unwrap();
        let deserialized: StockRecord = serde_json::from_str(&json).unwrap();
        
        assert_eq!(record.stock, deserialized.stock);
        assert_eq!(record.score, deserialized.score);
        assert_eq!(record.target, deserialized.target);
    }
} 