## Summary

Adds a GitHub Actions `Dependency Review` workflow at `.github/workflows/dependency-review.yml`. The workflow runs on every pull request and uses `actions/dependency-review-action@v4` to flag vulnerable or disallowed dependency changes before they land on the default branch. Closes #22.

## Evidence

This is a CI workflow-only change — no application code is touched, so there is no UI to screenshot and no performance metric to benchmark.

- The new file is valid YAML (parsed with `python3 -c "import yaml; yaml.safe_load(...)"`).
- Action version pinning (`@v4`) matches the convention used by the other workflows in this repo (`ci.yml`).
- `permissions: contents: read` follows the principle of least privilege required by the `dependency-review-action`.

```mermaid
flowchart LR
    A[Pull Request opened] --> B[Dependency Review workflow]
    B --> C[actions/checkout@v4]
    C --> D[actions/dependency-review-action@v4]
    D -->|vulnerable / disallowed dep| E[PR fails]
    D -->|clean| F[PR passes]
```

## Test Plan

- [x] Verified `.github/workflows/dependency-review.yml` parses as valid YAML.
- [x] Confirmed the workflow triggers on `pull_request` for all branches as specified by the issue template.
- [x] Confirmed `permissions: contents: read` is set (required by `dependency-review-action`).
- [ ] Once merged, opening a follow-up PR will exercise the workflow end-to-end on GitHub Actions.
