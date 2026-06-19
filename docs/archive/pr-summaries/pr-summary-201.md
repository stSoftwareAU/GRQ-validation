## Summary

Two `t.step` blocks in `tests/integration_test.ts` were tautological: they
asserted on values the test itself had just computed inline, never touching the
production code they claimed to guard. This PR rewrites both steps to drive the
real shared helpers in `docs/projection.js`, so a regression in the production
90-day boundary or dividend-window logic now makes the tests fail. Closes #201.

- **"90-day boundary respect"** previously rebuilt `ninetyDayDate` and asserted
  `testDate > ninetyDayDate` — only its own date arithmetic. It now calls the
  real `GRQProjection.getDaysElapsed(scoreDate, date)` and asserts a date past
  the window reports `> 90` elapsed days while a date inside it reports `<= 90`.
- **"dividend exclusion after 90 days"** previously re-implemented the window
  predicate with a local `.filter(...)`. It now calls the real
  `GRQProjection.filterDividendsWithin90Days(testDividends, scoreDate)` and
  asserts the surviving amounts are `[0.135, 0.32]`.

Both rewrites follow the same pattern as the existing "performance calculation"
step (issue #80), which already drives the real maths.

## Evidence

Backend/test-only change — no web interface to screenshot.

Verified the rewritten "dividend exclusion" step is no longer tautological by
temporarily flipping the production predicate (`<=` → `>=`) in
`docs/projection.js`: the step failed as expected, then passed again once the
production code was restored. This confirms the assertion now exercises the
function under test rather than the test's own arithmetic.

```
  dividend exclusion after 90 days ... FAILED   # with production logic broken
  ...
ok | 1 passed (4 steps) | 0 failed             # with production logic restored
```

Pre-existing, unrelated: the Rust `utils::tests::test_read_market_data` fails on
this machine because it needs a current-quarter market-data file that is not
present. It fails identically on a clean checkout (verified via `git stash`) and
is untouched by this TS-only change.

## Test Plan

- Modified `tests/integration_test.ts`:
  - `Integration Tests › 90-day boundary respect` — now drives
    `GRQProjection.getDaysElapsed`.
  - `Integration Tests › dividend exclusion after 90 days` — now drives
    `GRQProjection.filterDividendsWithin90Days`.
- `deno test tests/integration_test.ts` — all 4 steps pass.
- `deno lint`, `deno fmt --check`, `deno check` on the changed file — clean.
