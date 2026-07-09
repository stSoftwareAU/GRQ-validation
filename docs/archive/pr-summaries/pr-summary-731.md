## Summary

Hardened the `check-changes` job in `.github/workflows/ci.yml` so its
`actions/checkout` step no longer persists the workflow `GITHUB_TOKEN` into
`.git/config`. Added `persist-credentials: false` to the existing `with:` block
(alongside `fetch-depth: 0`). The `check-changes` job only reads git history to
compute diffs — it never pushes back to the repository or fetches private
submodules — so the persisted credential is unnecessary and only widens the
blast radius of a compromised later step (defence in depth, least privilege).

Closes #731.

## Evidence

Backend/CI configuration change — no web interface to screenshot.

- **YAML validity**: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"` → `YAML OK`.
- The repository's own `actionlint` workflow (`.github/workflows/actionlint.yml`)
  is the enforcing per-repo gate on this change.
- This mirrors the already-hardened checkout steps in the same repo, e.g.
  `ci.yml:166`, `cargo-audit.yml:36`, and `a11y.yml:51`.

Diff (job `check-changes`):

```yaml
      uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0
      with:
        fetch-depth: 0  # Fetch full history for proper diffs
        # check-changes only reads history for diffs; it never pushes back, so
        # the GITHUB_TOKEN must not be persisted into .git/config (issue #731).
        persist-credentials: false
```

## Test Plan

This is a single-line workflow-YAML security hardening change with no Rust code
surface, so no unit test applies. Validation performed:

- Parsed the workflow with a YAML loader to confirm it remains well-formed.
- Confirmed the change is scoped to the `check-changes` job's checkout step only
  (line 43); other jobs are untouched.
