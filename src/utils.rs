use anyhow::{Result, Context};
use chrono::NaiveDate;
use std::path::{Path, PathBuf};
use std::fs;

pub fn ensure_directory_exists(path: &Path) -> Result<()> {
    if !path.exists() {
        fs::create_dir_all(path)
            .with_context(|| format!("Failed to create directory: {:?}", path))?;
    }
    Ok(())
}

pub fn parse_date_string(date_str: &str) -> Result<NaiveDate> {
    // Try different date formats
    let formats = [
        "%Y-%m-%d",
        "%m/%d/%Y",
        "%d/%m/%Y",
        "%Y/%m/%d",
    ];
    
    for format in &formats {
        if let Ok(date) = NaiveDate::parse_from_str(date_str, format) {
            return Ok(date);
        }
    }
    
    Err(anyhow::anyhow!("Could not parse date string: {}", date_str))
}

pub fn format_date_for_path(date: NaiveDate) -> String {
    date.format("%Y-%m-%d").to_string()
}

pub fn get_month_name(month: u32) -> &'static str {
    match month {
        1 => "January",
        2 => "February",
        3 => "March",
        4 => "April",
        5 => "May",
        6 => "June",
        7 => "July",
        8 => "August",
        9 => "September",
        10 => "October",
        11 => "November",
        12 => "December",
        _ => "Unknown",
    }
}

pub fn validate_stock_symbol(symbol: &str) -> bool {
    // Basic validation for stock symbols
    // Should be alphanumeric with possible dots and colons
    if symbol.is_empty() || symbol.len() > 10 {
        return false;
    }
    
    symbol.chars().all(|c| c.is_alphanumeric() || c == '.' || c == ':')
}

pub fn sanitize_filename(filename: &str) -> String {
    // Remove or replace characters that are problematic in filenames
    filename
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '|' | '?' | '*' | '\\' | '/' => '_',
            _ => c,
        })
        .collect()
}

pub fn backup_file(file_path: &Path) -> Result<PathBuf> {
    let backup_path = file_path.with_extension("tsv.backup");
    
    if file_path.exists() {
        fs::copy(file_path, &backup_path)
            .with_context(|| format!("Failed to backup file: {:?}", file_path))?;
    }
    
    Ok(backup_path)
}

pub fn restore_backup(backup_path: &Path, original_path: &Path) -> Result<()> {
    if backup_path.exists() {
        fs::copy(backup_path, original_path)
            .with_context(|| format!("Failed to restore backup: {:?}", backup_path))?;
        
        fs::remove_file(backup_path)
            .with_context(|| format!("Failed to remove backup file: {:?}", backup_path))?;
    }
    
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    use std::fs;
    
    #[test]
    fn test_parse_date_string() {
        assert!(parse_date_string("2025-06-20").is_ok());
        assert!(parse_date_string("06/20/2025").is_ok());
        assert!(parse_date_string("20/06/2025").is_ok());
        assert!(parse_date_string("2025/06/20").is_ok());
        assert!(parse_date_string("invalid").is_err());
    }
    
    #[test]
    fn test_validate_stock_symbol() {
        assert!(validate_stock_symbol("AAPL"));
        assert!(validate_stock_symbol("NYSE:AAPL"));
        assert!(validate_stock_symbol("BRK.A"));
        assert!(!validate_stock_symbol(""));
        assert!(!validate_stock_symbol("TOOLONGSTOCKSYMBOL"));
        assert!(!validate_stock_symbol("AAPL<"));
    }
    
    #[test]
    fn test_sanitize_filename() {
        assert_eq!(sanitize_filename("file<name>"), "file_name_");
        assert_eq!(sanitize_filename("normal_file"), "normal_file");
        assert_eq!(sanitize_filename("file:with:colons"), "file_with_colons");
    }
    
    #[test]
    fn test_get_month_name() {
        assert_eq!(get_month_name(1), "January");
        assert_eq!(get_month_name(6), "June");
        assert_eq!(get_month_name(12), "December");
        assert_eq!(get_month_name(13), "Unknown");
    }
    
    #[test]
    fn test_format_date_for_path() {
        let date = NaiveDate::from_ymd_opt(2025, 6, 20).unwrap();
        assert_eq!(format_date_for_path(date), "2025-06-20");
    }
    
    #[test]
    fn test_ensure_directory_exists() {
        let temp_dir = tempdir().unwrap();
        let test_dir = temp_dir.path().join("test_dir");
        
        assert!(ensure_directory_exists(&test_dir).is_ok());
        assert!(test_dir.exists());
        
        // Should not fail if directory already exists
        assert!(ensure_directory_exists(&test_dir).is_ok());
    }
    
    #[test]
    fn test_backup_and_restore_file() {
        let temp_dir = tempdir().unwrap();
        let test_file = temp_dir.path().join("test.txt");
        let test_content = "test content";
        
        // Create a test file
        fs::write(&test_file, test_content).unwrap();
        
        // Backup the file
        let backup_path = backup_file(&test_file).unwrap();
        assert!(backup_path.exists());
        
        // Modify the original file
        fs::write(&test_file, "modified content").unwrap();
        
        // Restore from backup
        assert!(restore_backup(&backup_path, &test_file).is_ok());
        
        // Check that the content was restored
        let restored_content = fs::read_to_string(&test_file).unwrap();
        assert_eq!(restored_content, test_content);
        
        // Check that backup file was removed
        assert!(!backup_path.exists());
    }
} 