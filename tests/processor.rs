use grq_validation::processor::StockProcessor;
use grq_validation::models::ProcessedData;
use std::fs;
use std::path::Path;
use tempfile::tempdir;

const SAMPLE_TSV: &str = "Stock\tScore\tTarget\tExDividendDate\tDividendPerShare\tNotes\tintrinsicValuePerShareBasic\tintrinsicValuePerShareAdjusted\nNYSE:SEM\t1\t22.63\t2025-05-15\t0.09375\tBuy 422 at $15.09 ~= $6,368\t19.44923627342789\t28.69295242211238\nNASDAQ:PPC\t1\t69.41\t2025-04-03\t0\tBuy 141 at $46.27 ~= $6,524\t34.526907056662694\t65.07110298804957\n";

#[test]
fn test_process_sample_tsv_file() {
    let temp_dir = tempdir().unwrap();
    let scores_dir = temp_dir.path().join("scores/2025/June");
    fs::create_dir_all(&scores_dir).unwrap();
    let tsv_path = scores_dir.join("20.tsv");
    fs::write(&tsv_path, SAMPLE_TSV).unwrap();

    let processor = StockProcessor::new(temp_dir.path().to_str().unwrap());
    let processed: ProcessedData = processor.process_tsv_file(&tsv_path).unwrap();

    assert_eq!(processed.records.len(), 2);
    assert_eq!(processed.records[0].stock, "NYSE:SEM");
    assert_eq!(processed.records[1].stock, "NASDAQ:PPC");
    assert_eq!(processed.date.year(), 2025);
    assert_eq!(processed.date.month(), 6);
    assert_eq!(processed.date.day(), 20);
    assert!(processed.summary.average_score > 0.9);
}

#[test]
fn test_process_all_tsv_files() {
    let temp_dir = tempdir().unwrap();
    let scores_dir = temp_dir.path().join("scores/2025/June");
    fs::create_dir_all(&scores_dir).unwrap();
    let tsv_path = scores_dir.join("21.tsv");
    fs::write(&tsv_path, SAMPLE_TSV).unwrap();

    let processor = StockProcessor::new(temp_dir.path().to_str().unwrap());
    let all = processor.process_all_tsv_files().unwrap();
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].records.len(), 2);
} 