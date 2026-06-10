## Summary

Replaced the verbose `is_none()` + `unwrap()` "find the next trading day" guard in
`src/utils.rs` with the idiomatic `Option` combinator, removing the latent panic
shape and the double read of the `Option`. The pattern appeared twice — in
`calculate_portfolio_performance` and the identical block in
`calculate_hybrid_projection`. Closes #111.

**Deviation from the issue's suggested `map_or`:** the issue proposed
`next_trading_day_date.map_or(true, |d| date < d)`. Under this repo's pinned
toolchain (clippy 0.1.95 / rustc 1.95.0) the `clippy::unnecessary_map_or` lint
fires on `map_or(true, …)` and `quality.sh` runs clippy with `-D warnings`, so the
`map_or` form fails the quality gate and clippy explicitly suggests `is_none_or`.
`is_none_or(|d| date < d)` satisfies the issue's intent exactly — an `Option`
combinator with no `unwrap()` and no panic shape — while passing clean. `NaiveDate`
is `Copy`, so the combinator consumes the `Option` by value with no `clone()`.

```diff
-        if date >= score_date
-            && (next_trading_day_date.is_none()
-                || date < next_trading_day_date.unwrap())
-        {
+        if date >= score_date && next_trading_day_date.is_none_or(|d| date < d) {
```

The change is behaviour-preserving: `option.is_none() || date < option.unwrap()`
is logically identical to `option.is_none_or(|d| date < d)`.

## Evidence

Backend/CLI change only — no web interface to screenshot. Verified via the quality
gate: `./quality.sh < /dev/null` passes cleanly, including `cargo clippy
--all-targets --all-features -- -D warnings` and the full Rust + Deno test suites
(160 Deno tests, all Rust tests green). The changed branch is exercised by the
existing integration test that calls `calculate_portfolio_performance` against a
real score file.

## Test Plan

- No test changes required — this is a provably equivalent refactor.
- Existing tests in `src/utils.rs` exercising `calculate_portfolio_performance`
  (and the next-trading-day fallback branch) continue to pass.
- `./quality.sh < /dev/null` passes: clippy with `-D warnings`, all Rust unit
  tests, and all Deno tests.
