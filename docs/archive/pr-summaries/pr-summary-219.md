# Resolve PR #217 CI issues — skip Gitleaks for Dependabot PRs

## Summary

PR #217 (a Dependabot bump of `actions/checkout` 6.0.3 → 7.0.0) failed CI on the
`gitleaks` check only. The root cause is unrelated to the checkout bump:
`gitleaks/gitleaks-action` requires an org-level Gitleaks Pro licence, but
Dependabot-triggered runs execute against the separate **Dependabot secrets**
store and cannot read the `GITLEAKS_LICENSE` secret. The action therefore exits
with `ErrLicense` ("missing gitleaks license") before scanning, failing the
check on every Dependabot PR.

A dependency-bump PR introduces no secrets to scan, so the fix guards the
`gitleaks` job with `if: github.actor != 'dependabot[bot]'`, skipping it for
Dependabot-authored PRs while leaving full secret scanning intact for all human
PRs. Branch protection on `main` lists no required status checks, so a skipped
job does not block merges.

Closes #219.

## Evidence

This is a CI/workflow configuration change with no web interface to screenshot.

Failing run log for PR #217's `gitleaks` check:

```text
[stSoftwareAU] is an organization. License key is required.
##[error]🛑 missing gitleaks license. Go grab one at gitleaks.io and store it
as a GitHub Secret named GITLEAKS_LICENSE.
```

The empty `GITLEAKS_LICENSE:` env and `Secret source: Dependabot` line in the
same log confirm the secret was unavailable because the run was triggered by
Dependabot.

```mermaid
flowchart TD
    A[PR opened] --> B{github.actor == dependabot[bot]?}
    B -- yes --> C[gitleaks job skipped<br/>no licence needed, no secrets to scan]
    B -- no --> D[gitleaks job runs<br/>org licence available, full scan]
```

Verified locally:

```text
deno test --allow-read tests/*.ts
ok | 338 passed (55 steps) | 0 failed
```

## Test Plan

- Added `tests/gitleaks_workflow_test.ts::"Gitleaks job is skipped for Dependabot-authored PRs"`,
  which parses `.github/workflows/gitleaks.yml` and asserts the `gitleaks` job
  declares an `if` condition referencing `github.actor`, `!=`, and
  `dependabot[bot]`. It fails against the unfixed workflow and passes after the
  fix.
- Existing Gitleaks workflow tests (exists, valid YAML, `pull_request` trigger,
  read-only `contents` permission, concurrency cancellation) continue to pass.
- Full Deno suite: 338 passed, 0 failed (`deno test --allow-read tests/*.ts`).
- `deno fmt`, `deno lint`, and `deno check` clean on the modified test file.
