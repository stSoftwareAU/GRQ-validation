## Summary

Reworded every citation of the **private** upstream training/prediction
repository's internal source paths out of the seven diagnostic scripts, taking
each one down to concept level. A public repository must not point readers at
files they cannot see: the old comments named `GRQ/src/LearnUtil.ts`,
`GRQ/src/CoreFeatures.ts`, `GRQ/src/LearnUtilTypes.ts` and
`GRQ/src/portfolio/ScoreApp.ts` (several with line numbers), which is
unverifiable and useless to every public reader. Closes #783.

The comments still document the ported training semantics — only the private
path pointers were replaced, so no explanation was lost.

### Reword convention applied

Follows the convention already established for `docs/archive/` in #784.

| Was                                                                    | Now                                                                            |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `GRQ/src/CoreFeatures.ts -> GRQ/src/LearnUtil.ts` (denominator)         | "upstream training divides the 90-day return by `monthsAgoPrice` — the CLOSE on the score date" |
| `GRQ/src/LearnUtil.ts:147-148` (dividend basis)                        | "upstream training bakes a FLAT quarter of the trailing annual dividend"       |
| `GRQ/src/LearnUtil.ts -> market.lowPrice(symbol, targetDate)`          | "upstream training reads the low price at the target date"                     |
| `GRQ/src/LearnUtilTypes.ts:19-39`, `GRQ/src/portfolio/ScoreApp.ts:473` | "the upstream decoder the scoring app applies to every emitted score"          |
| "they live upstream in `GRQ`, not in this repo"                        | "they live in the training platform, not in this repo"                         |

### Files reworded (7)

`scripts/buy_price_denominator_diagnostic.ts`,
`scripts/diagnose_buy_price_denominator.ts`,
`scripts/diagnose_dividend_basis.ts`, `scripts/diagnose_price_basis.ts`,
`scripts/diagnose_score_target_decoding.ts`,
`scripts/dividend_basis_diagnostic.ts`,
`scripts/score_target_decoding_diagnostic.ts`.

Out of scope and deliberately untouched: the dashboard JS citations
(issue #782), the scorer-job references (issue #781), the hard-coded private
sibling checkout paths (issue #780), and this repo's own public paths
(`GRQ-validation/src/utils.rs`, `docs/projection.js`).

## Evidence

Comment-only change to CLI diagnostics — there is no web interface to
screenshot. Verified by the new regression test plus the full Deno suite.

```
$ deno test --allow-read tests/private_repo_reference_scripts_test.ts
diagnostic scripts cite no private GRQ/src source paths ... ok
diagnostic scripts do not point at the private repo by name ... ok
the scripts still document the ported training semantics ... ok
ok | 3 passed | 0 failed

$ deno test --allow-read tests/*.ts
ok | 1403 passed (79 steps) | 0 failed (28s)
```

Before the reword the first two guards failed with 11 path citations across the
seven scripts plus the "in `GRQ`" pointer — the TDD red state.

### Quality gate

`./quality.sh` passes cargo fmt, clippy and check, then fails on the
**pre-existing, environment-dependent** `utils::tests::test_read_market_data`,
which needs the local market-data checkout to contain the `SEM` symbol. Verified
pre-existing: the same test fails identically on a stashed (unmodified) tree.
This change touches no Rust. The Deno half of the gate (`deno fmt --check`,
`deno lint`, `deno check`, `deno test`) was run directly and passes clean.

`Cargo.lock` carries the transitive bumps `quality.sh`'s own `cargo update`
produced (`cc` 1.2.66 → 1.4.0, `jiff`/`jiff-static` 0.2.34 → 0.2.35). Both are
older than the 24h external-dependency quarantine (published 2026-07-24 and
2026-07-25) and `cargo audit` reports no vulnerabilities.

## Test Plan

- Added `tests/private_repo_reference_scripts_test.ts`:
  - `diagnostic scripts cite no private GRQ/src source paths` — scans every
    `scripts/*.ts` for `GRQ/src/…` path citations and reports file:line for any
    hit. Fails against the unfixed code (11 hits), passes after.
  - `diagnostic scripts do not point at the private repo by name` — collapses
    comment continuations so a pointer split across two `//` lines is still
    caught, then rejects "in `GRQ`" style pointers at the private repo.
  - `the scripts still document the ported training semantics` — asserts each
    reworded script retains its concept-level description, so the fix cannot
    regress into simply deleting the explanation.
- Full suite re-run: `deno test --allow-read tests/*.ts` → 1403 passed, 0
  failed.
