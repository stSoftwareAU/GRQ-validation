## Summary

Dropped the `push: [main, master]` trigger from `.github/workflows/actionlint.yml`. Actionlint is a PR gate, so the post-merge push run only duplicated a check that already passed on the PR. Added `workflow_dispatch:` for ad-hoc runs, matching the markdown-lint change from #726. Closes #866.

## Evidence

This is a CI configuration change with no UI. It is covered by structured assertions on the parsed workflow YAML:

- `deno test -A tests/actionlint_workflow_test.ts`: 2 new tests failed before the fix and passed after it (10 passed, 0 failed).
- `./quality.sh` found 2 failures that already exist on the base commit 2b53fd0, and this change does not cause them: `tests/market_data_presence_test.ts` and `tests/score_data_pairing_test.ts::checkScoreDataPairing: the committed tree passes the guard`. Both are caused by the missing `docs/scores/2026/August/26.csv`. I confirmed they fail on a clean worktree of the base commit, and recorded this on the existing tracking issue #860.

## Test Plan

Added 2 tests to `tests/actionlint_workflow_test.ts`:

- `actionlint workflow does not trigger on push to the default branch` checks any `push:` branch filter with `branchFilterMatches` against `main` and `master`.
- `actionlint workflow allows manual workflow_dispatch`.
