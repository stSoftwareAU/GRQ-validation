# Annualized Gain Fix Summary

## Problem
The annualized gain was wrong when only a few days into the 90-day prediction period. The system was using a fixed 90-day period for annualization instead of the actual number of days with market data.

## Solution
Modified both `calculate_portfolio_performance` and `calculate_hybrid_projection` functions in `src/utils.rs` to:

1. Track the latest market data date across all stocks
2. Calculate actual days elapsed (capped at 90) 
3. Use actual days in annualized performance formula
4. Use market data days instead of calendar days for hybrid projections

## Key Changes
- Added `latest_market_date` tracking
- Changed annualized formula from `365.25/90.0` to `365.25/actual_days_elapsed`
- Updated hybrid projection to use market data days for rate calculations
- Modified dampening factor to use market data days

## Result
- Early-stage portfolios now show accurate annualized rates
- No impact on completed 90-day periods  
- Consistent with frontend JavaScript calculations
- More accurate financial performance reporting
