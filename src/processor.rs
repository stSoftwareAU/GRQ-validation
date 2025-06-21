use anyhow::{Result, Context};
use csv::{ReaderBuilder, WriterBuilder};
use chrono::{NaiveDate, Datelike};
use log::{info, error};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

use crate::models::{StockRecord, ProcessedData, ProcessingSummary};

pub struct StockProcessor {
    docs_path: PathBuf,
}

impl StockProcessor {
    pub fn new(docs_path: &str) -> Self {
        Self {
            docs_path: PathBuf::from(docs_path),
        }
    }
    
    pub fn process_all_tsv_files(&self) -> Result<Vec<ProcessedData>> {
        let mut results = Vec::new();
        
        for entry in WalkDir::new(&self.docs_path)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().map_or(false, |ext| ext == "tsv"))
        {
            let path = entry.path();
            info!("Processing TSV file: {:?}", path);
            
            match self.process_tsv_file(path) {
                Ok(data) => {
                    info!("Successfully processed {:?} with {} records", path, data.records.len());
                    results.push(data);
                }
                Err(e) => {
                    error!("Failed to process {:?}: {}", path, e);
                }
            }
        }
        
        Ok(results)
    }
    
    pub fn process_tsv_file(&self, file_path: &Path) -> Result<ProcessedData> {
        let mut reader = ReaderBuilder::new()
            .delimiter(b'\t')
            .has_headers(true)
            .from_path(file_path)
            .with_context(|| format!("Failed to read TSV file: {:?}", file_path))?;
        
        let mut records = Vec::new();
        
        for result in reader.deserialize() {
            let record: StockRecord = result
                .with_context(|| format!("Failed to deserialize record from {:?}", file_path))?;
            records.push(record);
        }
        
        // Extract date from file path (assuming structure: docs/scores/YYYY/Month/DD.tsv)
        let date = self.extract_date_from_path(file_path)?;
        
        let summary = ProcessingSummary::new(&records);
        
        Ok(ProcessedData {
            date,
            records,
            summary,
        })
    }
    
    pub fn write_processed_data(&self, data: &ProcessedData, output_path: &Path) -> Result<()> {
        let mut writer = WriterBuilder::new()
            .delimiter(b'\t')
            .from_path(output_path)
            .with_context(|| format!("Failed to create output file: {:?}", output_path))?;
        
        for record in &data.records {
            writer.serialize(record)
                .with_context(|| format!("Failed to serialize record: {:?}", record))?;
        }
        
        writer.flush()
            .with_context(|| format!("Failed to flush writer for {:?}", output_path))?;
        
        info!("Successfully wrote processed data to {:?}", output_path);
        Ok(())
    }
    
    pub fn update_daily_scores(&self, date: NaiveDate) -> Result<()> {
        // Find the TSV file for the given date
        let file_path = self.find_tsv_file_for_date(date)?;
        
        if !file_path.exists() {
            return Err(anyhow::anyhow!("No TSV file found for date: {}", date));
        }
        
        info!("Updating daily scores for date: {}", date);
        
        // Process the existing file
        let data = self.process_tsv_file(&file_path)?;
        
        // TODO: Implement your specific update logic here
        // This could involve:
        // - Fetching current stock prices
        // - Recalculating scores
        // - Updating intrinsic values
        // - Adding new analysis
        
        // Write the updated data back
        self.write_processed_data(&data, &file_path)?;
        
        info!("Successfully updated daily scores for {}", date);
        Ok(())
    }
    
    fn extract_date_from_path(&self, file_path: &Path) -> Result<NaiveDate> {
        // Extract date from path like: docs/scores/2025/June/20.tsv
        let components: Vec<&str> = file_path
            .components()
            .filter_map(|c| c.as_os_str().to_str())
            .collect();
        
        if components.len() >= 4 {
            let year = components[components.len() - 3];
            let month = components[components.len() - 2];
            let day = components[components.len() - 1].trim_end_matches(".tsv");
            
            // Convert month name to number
            let month_num = match month.to_lowercase().as_str() {
                "january" | "jan" => 1,
                "february" | "feb" => 2,
                "march" | "mar" => 3,
                "april" | "apr" => 4,
                "may" => 5,
                "june" | "jun" => 6,
                "july" | "jul" => 7,
                "august" | "aug" => 8,
                "september" | "sep" => 9,
                "october" | "oct" => 10,
                "november" | "nov" => 11,
                "december" | "dec" => 12,
                _ => return Err(anyhow::anyhow!("Invalid month: {}", month)),
            };
            
            let year: i32 = year.parse()
                .with_context(|| format!("Invalid year: {}", year))?;
            let day: u32 = day.parse()
                .with_context(|| format!("Invalid day: {}", day))?;
            
            NaiveDate::from_ymd_opt(year, month_num, day)
                .ok_or_else(|| anyhow::anyhow!("Invalid date: {}-{}-{}", year, month_num, day))
        } else {
            Err(anyhow::anyhow!("Could not extract date from path: {:?}", file_path))
        }
    }
    
    fn find_tsv_file_for_date(&self, date: NaiveDate) -> Result<PathBuf> {
        let month_name = match date.month() {
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
            _ => unreachable!(),
        };
        
        let file_path = self.docs_path
            .join("scores")
            .join(date.year().to_string())
            .join(month_name)
            .join(format!("{}.tsv", date.day()));
        
        Ok(file_path)
    }
} 