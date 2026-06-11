#!/bin/bash

echo "=========================================="
echo "Annualized Performance Calculation Tests"
echo "=========================================="

echo ""
echo "1. Running JavaScript Annualised Performance Tests (requires deno)..."
echo "----------------------------------------"
# The assertion-free demo script (scripts/debug/test_formula_verification.js)
# was deleted in issue #83; run the real WHAT-test instead.
deno test --allow-read tests/annualized_performance_test.ts

echo ""
echo "2. Rust Tests Available (requires cargo):"
echo "----------------------------------------"
echo "cargo test test_annualized_performance_calculation_with_actual_days -- --nocapture"
echo "cargo test test_annualized_vs_fixed_90_day_comparison -- --nocapture" 
echo "cargo test test_market_data_days_vs_calendar_days -- --nocapture"
echo "cargo test test_edge_cases_for_annualized_calculation -- --nocapture"

echo ""
echo "✅ Annualised performance tests run; further cases documented above."
