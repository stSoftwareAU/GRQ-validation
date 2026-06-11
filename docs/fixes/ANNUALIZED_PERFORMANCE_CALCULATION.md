# Annualized Performance Calculation

## Overview

The annualized performance calculation converts performance to an annual rate using **compound interest**, not simple multiplication. This is the correct financial approach for comparing performance across different time periods.

**IMPORTANT FIX**: When we only have a few days of market data (less than 90 days), the annualized calculation now uses the actual number of days with market data instead of assuming a full 90-day period.

## Formula

The annualized performance is calculated using the compound interest formula:

```
Annualized Performance = ((1 + performance/100) ^ (365.25/actual_days) - 1) × 100
```

Where:
- `performance` is the percentage return over the actual period
- `actual_days` is the number of days with market data (capped at 90 days)
- `365.25/actual_days` calculates how many such periods would occur in a year
- The result is converted back to a percentage

## Implementation

### Rust Code (src/utils.rs)

Both the regular performance calculation and hybrid projection now calculate the actual days elapsed:

```rust
// Calculate actual days elapsed from score date to latest market data date (capped at 90)
let actual_days_elapsed = std::cmp::min((latest_market_date - score_date).num_days(), 90);

// Calculate annualized performance using actual days elapsed instead of fixed 90 days
let performance_annualized = if performance_90_day != 0.0 && actual_days_elapsed > 0 {
    ((1.0 + performance_90_day / 100.0).powf(365.25 / actual_days_elapsed as f64) - 1.0) * 100.0
} else {
    0.0
};
```

### JavaScript Equivalent

```javascript
const calculateAnnualized = (performance, actualDays) => {
    if (performance === 0 || actualDays <= 0) return 0;
    return ((1 + performance / 100) ** (365.25 / actualDays) - 1) * 100;
};
```

## Why Use Actual Days vs Fixed 90 Days?

### Problem with Fixed 90-Day Period
When we're only 5 days into the 90-day prediction period:
- **Wrong**: Using 90 days for annualization
- **Annualized = ((1 + 5-day_performance/100) ^ (365.25/90) - 1) × 100**
- This significantly understates the annualized performance

### Correct Approach with Actual Days
When we're only 5 days into the 90-day prediction period:
- **Correct**: Using 5 days for annualization  
- **Annualized = ((1 + 5-day_performance/100) ^ (365.25/5) - 1) × 100**
- This properly reflects the annualized rate based on actual performance data

## Why Compound Interest vs Simple Multiplication?

### Simple Multiplication (Incorrect)
```
Annualized = 90-day_performance × 4
```

**Problems:**
- Assumes linear growth
- Doesn't account for compounding effects
- Underestimates positive returns
- Overestimates negative returns

### Compound Interest (Correct)
```
Annualized = (1 + 90-day_performance/100) ^ 4.058 - 1
```

**Benefits:**
- Accounts for compounding effects
- Matches financial industry standards
- Provides accurate annual projections
- Handles both positive and negative returns correctly

## Examples

### Positive Performance

**90-day performance: 6.07%**
- Simple multiplication: 6.07% × 4 = 24.28%
- Compound interest: (1 + 0.0607)^4.058 - 1 = 27.02%
- **Difference: +2.74%** (compound is higher)

### Negative Performance

**90-day performance: -12.98%**
- Simple multiplication: -12.98% × 4 = -51.92%
- Compound interest: (1 - 0.1298)^4.058 - 1 = -43.12%
- **Difference: +8.80%** (compound is less negative)

### Small Performance

**90-day performance: 0.48%**
- Simple multiplication: 0.48% × 4 = 1.92%
- Compound interest: (1 + 0.0048)^4.058 - 1 = 1.96%
- **Difference: +0.04%** (compound is slightly higher)

## Test Results

The test suite confirms that the calculation uses compound interest correctly:

```
Positive performance:
  90-day: 6.07% → Annualized: 27.02% (simple would be 24.28%)

Negative performance:
  90-day: -12.98% → Annualized: -43.12% (simple would be -51.92%)

Large positive:
  90-day: 20% → Annualized: 109.58% (simple would be 80%)

Large negative:
  90-day: -20% → Annualized: -59.57% (simple would be -80%)
```

## Key Insights

### 1. **Positive Returns Compound Up**
- Compound interest always produces higher annualized returns than simple multiplication for positive performance
- The effect is more pronounced with larger returns

### 2. **Negative Returns Compound Down (but less severely)**
- Compound interest produces less negative annualized returns than simple multiplication
- This reflects the mathematical reality that losses compound differently than gains

### 3. **Small Returns Show Minimal Difference**
- For small performance values (< 5%), the difference between compound and simple is minimal
- This is why some users might think it's using simple multiplication

### 4. **Financial Industry Standard**
- This calculation matches how mutual funds, ETFs, and other financial products report annualized returns
- It's the standard approach used by Morningstar, Bloomberg, and other financial data providers

## Verification

The calculation has been verified against real data from the index.json file:

| Date | 90-Day Performance | Annualized (Actual) | Simple × 4 | Compound (Calculated) |
|------|-------------------|-------------------|------------|---------------------|
| 2024-11-15 | 6.07% | 27.00% | 24.28% | 27.02% |
| 2024-12-03 | -12.98% | -43.09% | -51.92% | -43.12% |
| 2024-11-02 | 0.48% | 1.95% | 1.92% | 1.96% |

The calculated values match the actual values within 0.1%, confirming the formula is correct.

## Conclusion

The annualized performance calculation **is correct** and uses compound interest as it should. The formula:

```rust
((1.0 + performance_90_day / 100.0).powf(365.25 / 90.0) - 1.0) * 100.0
```

Properly converts 90-day performance to annualized performance using compound interest, which is the standard financial approach for performance reporting. 