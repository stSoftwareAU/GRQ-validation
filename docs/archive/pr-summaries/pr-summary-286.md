## Summary

Implemented the stock priceable predicate and exclusion rule in the Rust backend. A stock now counts toward portfolio performance only if it has BOTH a usable buy price (> 0 at/after the prediction date) AND a usable current price (> 0). If either is missing, the stock is excluded entirely.

**Closes #286**

## Changes

1. **Added `is_priceable` predicate** (`src/utils.rs`):
   - Single source of truth: `fn is_priceable(buy_price: f64, current_price: f64) -> bool`
   - Returns `true` only when both prices are positive

2. **Updated `PortfolioPerformance` struct** (`src/models.rs`):
   - Added `excluded_tickers: Vec<String>` field to surface excluded stocks
   - Updated documentation for `total_stocks` to clarify it counts only included stocks

3. **Fixed `calculate_portfolio_performance`** (`src/utils.rs`):
   - Uses `is_priceable` predicate at the inclusion gate
   - Tracks excluded tickers in a new vector
   - Redefines `total_stocks` as the count of included stocks (not file count)
   - Average denominator is now the included count only

4. **Fixed `calculate_hybrid_projection`** (`src/utils.rs`):
   - Applied same exclusion logic for consistency
   - Tracks excluded tickers
   - Reports included count only

5. **Updated `main.rs` display logic**:
   - Shows included stock count and lists excluded tickers with reason
   - Added logging for excluded stock counts

## Test Plan

**TDD tests added** (all passing):
- ✅ `test_is_priceable_both_prices_present` — both prices positive → included
- ✅ `test_is_priceable_buy_price_missing` — buy price zero → excluded
- ✅ `test_is_priceable_current_price_missing` — current price zero → excluded
- ✅ `test_is_priceable_both_prices_missing` — both zero → excluded
- ✅ `test_is_priceable_negative_prices` — negative prices → excluded
- ✅ `test_portfolio_performance_excludes_unpriceable_stocks` — integration test
- ✅ `test_portfolio_performance_excludes_missing_current_price` — validates both check
- ✅ `test_portfolio_performance_included_count_matches_included_stocks` — count accuracy
- ✅ `test_excluded_tickers_surfaced_on_portfolio_performance` — downstream visibility
- ✅ `test_portfolio_performance_average_denominator_is_included_count` — average correctness

**Existing tests**:
- All 60 unit tests pass (including existing performance calculation tests)
- `cargo test` green
- `./quality.sh` passes all checks (fmt, clippy, test, deno)

## Evidence

No visual changes (backend/CLI feature). Implementation verified via:
- TDD: 10 new unit tests cover the predicate and integration
- Existing tests all pass (backward compatibility maintained)
- Quality gate: `cargo clippy`, `cargo fmt`, `deno lint`, `deno test` all green

## Impact

- **Fixes portfolio count inflation**: `total_stocks` now reflects actual included stocks
- **Improves average accuracy**: denominator is included count only (no longer diluted by unpriceable stocks)
- **Enables downstream filtering**: `excluded_tickers` allows dashboard/main.rs to strike out unpriceable stocks
- **Fulfils acceptance criteria**: predicate ✓, count correction ✓, excluded list surfaced ✓
- **Supports blocking issues**: #272, #273, #274 now have consistent portfolio figures
