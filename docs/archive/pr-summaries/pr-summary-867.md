## Summary

Set `persist-credentials: false` on the `actions/checkout` step of the
`actionlint` job in `.github/workflows/actionlint.yml`. The job only reads the
tree to lint it — it never pushes or fetches a private submodule — so the
`GITHUB_TOKEN` no longer needs to be written to `.git/config`, where any later
step could read it. Closes #867.

## Evidence

Workflow-only change with no UI. `tests/actionlint_workflow_test.ts::actionlint checkout does not persist credentials`
parses the workflow YAML and asserts every checkout in the `actionlint` job
sets `persist-credentials: false`. It failed before the fix and passes after it.

## Test Plan

- Added `actionlint checkout does not persist credentials` to
  `tests/actionlint_workflow_test.ts`.
- `deno test -A tests/actionlint_workflow_test.ts`: 11 passed.
- `./quality.sh` run after the final edit.
