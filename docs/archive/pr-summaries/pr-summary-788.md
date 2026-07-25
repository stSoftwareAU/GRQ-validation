# Run every quality gate on `milestone/*` pull requests

## Summary

Nine test/lint/scan workflows filtered their `pull_request` trigger with
`branches: ["*"]`. In GitHub Actions filter-pattern syntax `*` matches any
character **except** `/`, so none of those gates ran on a pull request whose
base branch is `milestone/<slug>` — the shared integration branch milestone
sub-issue PRs target. Secret scanning (gitleaks), SAST (semgrep), dependency
review, the Cargo/Deno audits, the dependency quarantine gate and every lint
gate were all silently skipped, leaving the gap to surface only on the single
oversized rollup PR into `main`.

Each of the nine now lists `milestone/**` alongside `*`, matching the spelling
`ci.yml` already uses for the Rust gate (Issue #342):

```yaml
on:
  pull_request:
    # `*` does not match `/`, so `milestone/**` is needed for milestone
    # integration PRs to run this gate (Issue #788).
    branches: ["*", "milestone/**"]
```

Workflows changed: `actionlint`, `bump-quarantine-gate`, `cargo-audit`,
`deno-quality`, `dependency-review`, `gitleaks`, `markdown-lint`, `semgrep`,
`shellcheck`. `a11y.yml` (unfiltered `pull_request:`) and `ci.yml` were already
correct and are untouched. `version-bump.yml` deliberately stays `main`-only so
the version bump lands once, on the rollup PR — a regression test pins that.

Closes #788.

## Evidence

Backend/CI-only change — there is no web interface to screenshot. The evidence
is the test suite plus `actionlint`.

Which gates run for a PR base of `milestone/<slug>`, before and after:

```mermaid
flowchart LR
    subgraph Before["Before — branches: [\"*\"]"]
        B1[PR into milestone/slug] -->|* does not match /| B2[9 gates skipped]
        B1 --> B3[ci.yml + a11y.yml run]
        B2 --> B4[Gap found late,<br/>on the rollup PR into main]
    end
    subgraph After["After — branches: [\"*\", \"milestone/**\"]"]
        A1[PR into milestone/slug] --> A2[All 11 gates run]
        A2 --> A3[Findings attributed to<br/>the sub-issue PR]
    end
```

Verification run locally:

- `deno test --allow-read tests/*.ts` — the nine new
  `... runs on pull requests into a milestone branch` tests failed against the
  unfixed workflows and pass after the filter change.
- `actionlint .github/workflows/*.yml` — clean.
- `markdownlint-cli2` — 0 errors.
- `./quality.sh` — `market_data_presence_test.ts` ("data-presence gate") fails,
  but it fails identically on a clean checkout of `main` (verified with
  `git stash -u`): a committed prediction date has no sibling market-data CSV.
  Pre-existing and unrelated to this change.

## Test Plan

New — `tests/milestone_branch_filter_test.ts`:

- For each of the eleven PR gates (`a11y`, `actionlint`, `bump-quarantine-gate`,
  `cargo-audit`, `ci`, `deno-quality`, `dependency-review`, `gitleaks`,
  `markdown-lint`, `semgrep`, `shellcheck`): evaluates the workflow's real
  `branches:` filter against `milestone/star-filter-controls` and asserts the
  gate runs. These are the regression tests for this bug — all nine failed
  before the fix.
- Same eleven re-checked against `main` so nothing was narrowed.
- `version-bump workflow stays main-only` — guards against over-widening.

New helpers in `tests/workflow_assertions.ts`, unit-tested in
`tests/workflow_assertions_test.ts` with synthetic inputs:

- `branchFilterMatches(branches, branch)` — implements GitHub's filter-pattern
  semantics (`*` stops at `/`, `**` crosses it, `!` excludes, absent filter
  matches everything). Tests cover each of those cases plus literal dots.
- `triggerBranches(doc, trigger)` — distinguishes an absent trigger (`null`),
  an unfiltered trigger (`undefined`) and an explicit filter.

The tests assert the outcome (does this gate run for this base branch?) rather
than the spelling of the filter, so dropping `branches:` entirely or switching
to `milestone/*` would keep them green.
