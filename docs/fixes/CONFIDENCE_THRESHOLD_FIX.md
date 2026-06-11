# Confidence Threshold Fix for Late-Stage Predictions

## Problem Description

The portfolio trend line was showing "Portfolio Trend (Low Confidence)" even at 89 days into a 90-day term. This was happening because the confidence threshold was too strict for very late-stage predictions.

## Root Cause

The original confidence threshold logic was:
```javascript
let confidenceThreshold = 0.05; // Default threshold
if (daysElapsed >= 60) {
    confidenceThreshold = 0.01; // Much more lenient for late-stage predictions
} else if (daysElapsed >= 30) {
    confidenceThreshold = 0.03; // Moderate threshold for mid-stage
}
```

Even at 89 days, if the R² value was below 0.01, the system would still show "Low Confidence". This was too strict for predictions that are essentially complete.

## Solution

Added an additional threshold tier for very late-stage predictions (80+ days):

```javascript
let confidenceThreshold = 0.05; // Default threshold
if (daysElapsed >= 80) {
    confidenceThreshold = 0.001; // Extremely lenient for very late-stage predictions (80+ days)
} else if (daysElapsed >= 60) {
    confidenceThreshold = 0.01; // Much more lenient for late-stage predictions
} else if (daysElapsed >= 30) {
    confidenceThreshold = 0.03; // Moderate threshold for mid-stage
}
```

## Rationale

### Why 80+ Days Deserves Higher Confidence

1. **Near Completion**: At 80+ days, we're in the final 10 days of the 90-day term
2. **Established Pattern**: By this point, the performance pattern is well-established
3. **Minimal Extrapolation**: We're only projecting 10 days into the future
4. **Practical Relevance**: Users need actionable insights at this stage

### Threshold Values Explained

- **0-30 days**: 0.05 threshold - Early volatility, need strong correlation
- **30-60 days**: 0.03 threshold - Moderate confidence, some pattern established
- **60-80 days**: 0.01 threshold - Late stage, more lenient
- **80+ days**: 0.001 threshold - Very late stage, extremely lenient

## Impact

### Before Fix
- 89-day predictions showing "Low Confidence" even with reasonable R² values
- Users confused about prediction reliability near term completion
- Inconsistent with practical expectations

### After Fix
- 80+ day predictions show "Portfolio Trend Prediction" with much lower R² requirements
- Aligns with user expectations for late-stage predictions
- More actionable insights when they matter most

## Files Modified

### **docs/app.js**
- Updated confidence threshold logic in `prepareChartData()` method
- Added 80+ day tier with 0.001 threshold

### **tests/portfolio_view_consistency_test.ts**
- Updated test to match new confidence threshold logic
- Ensures test coverage for the new tier

## Testing

### Manual Testing
1. Load a score file with 80+ days elapsed
2. Verify portfolio trend line shows "Portfolio Trend Prediction" instead of "Low Confidence"
3. Check console logs for confidence threshold values

### Automated Testing
- Updated test files to reflect new threshold logic
- Ensures regression testing for confidence calculations

## Future Considerations

### Potential Improvements
1. **Dynamic Thresholds**: Could make thresholds even more granular (e.g., 85+ days)
2. **Performance-Based**: Could adjust thresholds based on actual performance volatility
3. **User Preference**: Could allow users to adjust confidence sensitivity

### Monitoring
- Monitor user feedback on late-stage prediction confidence
- Track if the 0.001 threshold is appropriate for 80+ day predictions
- Consider if additional tiers are needed for 85+ or 88+ days

## Related Issues

This fix addresses the user concern: "Looking at the performance chart for the 20th April it says 'Portfolio Trend (low confidence)' but we are 89 days into the 90 day term. I mean if we're not confident now we never will be."

The fix ensures that predictions near the end of the 90-day term are treated with appropriate confidence levels, reflecting the reality that late-stage predictions are inherently more reliable than early-stage ones. 