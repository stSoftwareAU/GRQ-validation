use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StockRecord {
    pub stock: String,
    pub score: f64,
    pub target: f64,
}

impl StockRecord {
    pub fn new(stock: String, score: f64, target: f64) -> Self {
        Self {
            stock,
            score,
            target,
        }
    }
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
    }
    
    #[test]
    fn test_stock_record_serialization() {
        let record = StockRecord::new("AAPL".to_string(), 0.95, 150.0);
        
        let json = serde_json::to_string(&record).unwrap();
        let deserialized: StockRecord = serde_json::from_str(&json).unwrap();
        
        assert_eq!(record.stock, deserialized.stock);
        assert_eq!(record.score, deserialized.score);
        assert_eq!(record.target, deserialized.target);
    }
} 