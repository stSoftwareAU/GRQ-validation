use grq_validation::utils;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let score_file_path = "docs/scores/2025/February/15.tsv";
    let score_file_date = "2025-02-15";
    
    println!("Testing performance calculation for February 15, 2025");
    println!("Score file: {}", score_file_path);
    println!("Score date: {}", score_file_date);
    
    match utils::calculate_portfolio_performance(score_file_path, score_file_date) {
        Ok(performance) => {
            println!("\n=== February 15, 2025 Performance Results ===");
            println!("Score Date: {}", performance.score_date);
            println!("Total Stocks: {}", performance.total_stocks);
            println!("Stocks with Data: {}", performance.stocks_with_data);
            println!("90-Day Performance: {:.2}%", performance.performance_90_day);
            println!("Annualized Performance: {:.2}%", performance.performance_annualized);
        }
        Err(e) => {
            println!("Error: {}", e);
        }
    }
    
    Ok(())
} 