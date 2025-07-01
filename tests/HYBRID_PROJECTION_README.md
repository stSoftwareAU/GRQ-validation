# Hybrid Projection System

## Overview

The Hybrid Projection System is an advanced approach to predicting 90-day stock performance that addresses the limitations of simple linear trend lines. It uses different projection methods based on the time elapsed since the score date, providing more realistic and accurate predictions.

## Why Hybrid Projections?

Traditional linear trend lines have several limitations:
- **Extrapolation errors**: Linear trends don't account for mean reversion
- **Early volatility**: Early price movements are often not predictive of long-term performance
- **Ignoring fundamentals**: Pure technical analysis ignores target prices and company fundamentals
- **Unrealistic projections**: Can predict impossible losses (>100%) or unrealistic gains

## How It Works

The hybrid system uses different approaches based on days elapsed:

### 1. Early Days (0-30 days)
- **Method**: Dampened Trend (30% of linear trend)
- **Rationale**: Early price movements are often volatile and not predictive
- **Confidence**: Reduced by 30% to reflect uncertainty
- **Fallback**: Target-based projection if trend is unreliable (R² < 0.1)

### 2. Medium Term (30-60 days)
- **Method**: Dampened Trend (50% of linear trend)
- **Rationale**: More data available, but still account for mean reversion
- **Confidence**: Reduced by 20% to reflect remaining uncertainty
- **Fallback**: Target-based projection if trend is unreliable (R² < 0.05)

### 3. Long Term (60+ days)
- **Method**: Target-based projection or mean reversion
- **Rationale**: Fundamentals become more important than short-term trends
- **Confidence**: Higher confidence in target-based projections
- **Fallback**: Mean reversion if no target available

## Implementation Details

### Key Methods

#### `calculateHybridProjection(stock, scoreDate)`
Main entry point that determines the appropriate projection method and calculates the 90-day prediction.

**Returns:**
```javascript
{
    projected90DayPerformance: number,  // Capped between -100% and 200%
    projectionMethod: string,           // "dampened_trend" or "target_based"
    confidence: number,                 // 0.0 to 1.0
    daysElapsed: number,                // Days since score date
    currentPerformance: number,         // Current actual performance
    targetPercentage: number | null     // Target percentage if available
}
```

#### `calculateHybridProjectionData(stock, scoreDate)`
Generates chart data points for the hybrid projection line.

**Returns:**
```javascript
{
    data: Array<{x: Date, y: number}>,  // Chart data points
    projection: HybridProjection        // Projection details
}
```

### Dampening Factors

- **Early days (0-30)**: 30% of linear trend slope
- **Medium term (30-60)**: 50% of linear trend slope
- **Rationale**: Reduces the impact of early volatility and accounts for mean reversion

### Confidence Calculation

- **Dampened trend**: `min(R² * dampening_factor, max_confidence)`
- **Target-based**: Fixed confidence based on time period
- **Mean reversion**: Lower confidence (0.4) due to uncertainty

### Bounds Checking

All projections are capped to realistic bounds:
- **Minimum**: -100% (maximum possible loss)
- **Maximum**: 200% (reasonable maximum gain)

## Test Cases

The system includes comprehensive test cases covering:

1. **Strong Upward Trends**: Tests dampened trend calculation for positive performance
2. **Strong Downward Trends**: Tests dampened trend calculation for negative performance
3. **Volatile Data**: Tests fallback to target-based when R² is low
4. **Insufficient Data**: Tests handling of stocks with minimal market data
5. **Target-Based Fallback**: Tests when trend analysis is unreliable
6. **Bounds Checking**: Ensures projections stay within realistic limits
7. **Confidence Levels**: Validates confidence calculations
8. **Method Selection**: Tests proper method selection logic
9. **Dividend Integration**: Tests inclusion of dividend returns



## Testing the System

The hybrid projection system is integrated into the main GRQ validation dashboard. To test it:

```bash
# Start the main server
./helpers/server.sh

# Or directly with Deno
deno run --allow-net --allow-read helpers/server.ts
```

Then visit `http://localhost:8000` to see the hybrid projections in the main dashboard.

### Running Unit Tests

```bash
cd tests
deno test hybrid_projection_tests.ts
```

## Integration with Main App

The hybrid projection system is integrated into the main GRQ validation app:

1. **Chart Display**: Shows hybrid projections as dashed lines with appropriate colors
2. **Color Coding**: 
   - Green: Upward projections
   - Red: Downward projections  
   - Purple: Target-based projections
3. **Confidence Threshold**: Only shows projections with confidence > 0.2
4. **90-Day Points**: Shows predicted performance at exactly 90 days
5. **Judgement System**: Uses hybrid projections for stock judgements instead of simple trend lines
6. **Working Details**: Shows hybrid projection method and confidence in popover details

## Advantages Over Linear Trends

1. **More Realistic**: Accounts for mean reversion and early volatility
2. **Adaptive**: Uses different methods based on available data
3. **Fundamental Integration**: Incorporates target prices when appropriate
4. **Confidence Scoring**: Provides confidence levels for projections
5. **Bounds Checking**: Prevents impossible projections
6. **Fallback Mechanisms**: Graceful degradation when data is insufficient

## Future Enhancements

Potential improvements to consider:

1. **Peer Comparison**: Compare to similar stocks in the same sector
2. **Market Conditions**: Adjust projections based on overall market trends
3. **Volatility Adjustment**: Use historical volatility to adjust dampening factors
4. **Machine Learning**: Train models on historical projection accuracy
5. **Confidence Intervals**: Show range of possible outcomes
6. **Sector Analysis**: Different approaches for different sectors

## Usage Example

```javascript
// In the main app
const hybridData = this.calculateHybridProjectionData(stock, scoreDate);

if (hybridData && hybridData.projection.confidence > 0.2) {
    // Add to chart
    datasets.push({
        label: "Hybrid Projection",
        data: hybridData.data,
        borderColor: getProjectionColor(hybridData.projection),
        borderDash: [5, 5],
        // ... other chart options
    });
}
```

This hybrid approach provides much more realistic and useful 90-day projections compared to simple linear trend lines, while maintaining the simplicity and interpretability that users expect. 