# Add Deno Dependency Updates workflow

## Summary

Added `.github/workflows/deno-outdated.yml`, a new GitHub Actions workflow that runs `deno outdated --update --latest` on a weekly schedule (Mondays at 06:00 UTC) and opens a pull request with the bumped dependencies. The workflow also supports manual dispatch. Third-party actions are pinned to 40-character commit SHAs to satisfy the project's supply-chain rule. Closes #25.

## Evidence

This change is purely a GitHub Actions workflow file plus its unit tests — there is no UI to screenshot and no runtime performance to benchmark. Verification is via the new Deno test suite, which parses the YAML and asserts the workflow's shape.

```mermaid
flowchart LR
    A[Weekly cron / manual dispatch] --> B[Checkout repo]
    B --> C[Setup Deno v2.x]
    C --> D[deno outdated --update --latest]
    D --> E[create-pull-request]
    E --> F[chore/deno-outdated PR]
```

Test results for the new workflow (6/6 passing):

```text
running 6 tests from ./tests/deno_outdated_workflow_test.ts
Deno Outdated workflow file exists ... ok
Deno Outdated workflow parses as valid YAML ... ok
Deno Outdated workflow has schedule and workflow_dispatch triggers ... ok
Deno Outdated workflow declares write permissions for PR creation ... ok
Deno Outdated workflow runs deno outdated and creates a PR ... ok
Deno Outdated workflow pins actions to commit SHAs ... ok
ok | 6 passed | 0 failed
```

Pre-existing failures in `markdown_lint_workflow_test.ts` and `schw_projection_test.ts` exist on `main` and are out of scope for this issue.

## Test Plan

- `tests/deno_outdated_workflow_test.ts` — six new tests verifying:
  - the workflow file exists and parses as valid YAML;
  - the `on` block declares both a `schedule` (with a non-empty cron) and a `workflow_dispatch` trigger;
  - top-level `permissions` grant `contents: write` and `pull-requests: write` so `create-pull-request` can open a PR;
  - the `outdated` job runs on `ubuntu-latest`, executes `deno outdated --update --latest`, and uses `actions/checkout`, `denoland/setup-deno`, and `peter-evans/create-pull-request`;
  - every `uses:` line pins its action to a 40-character commit SHA (supply-chain rule).
