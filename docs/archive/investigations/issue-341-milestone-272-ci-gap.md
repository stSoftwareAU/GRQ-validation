# Root-cause: how a non-compiling `src/utils.rs` reached `milestone/272`

_Investigation for Issue #341 (sub-issue of #326). Remediation handed to #342._

## TL;DR

A non-compiling `src/utils.rs` merged onto
`milestone/272-verify-klac-exclude-or-correct-split-skewed-st` via **PR #324**
(Issue #294) **because no Rust quality gate ever ran on that PR**. The break was
not bypassed — it was simply never checked. Two independent trigger gaps, plus
the absence of branch protection, combined so that the only workflow that ran on
the PR was the accessibility (a11y) check.

```mermaid
flowchart TD
    A["PR #324 base = milestone/272-…"] --> B{"ci.yml trigger<br/>branches: [ main ]"}
    B -- "base != main" --> X1["Rust gate never triggers<br/>(fmt/clippy/check/test skipped)"]
    A --> C{"cargo-audit / deno-quality /<br/>semgrep / shellcheck / md-lint<br/>branches: [\"*\"]"}
    C -- "'*' does not match '/'<br/>in milestone/272-…" --> X2["These gates never trigger either"]
    A --> D{"a11y.yml<br/>pull_request: (no branch filter)"}
    D -- "matches every base" --> X3["Accessibility is the ONLY check that runs"]
    A --> E{"Branch protection on<br/>milestone/272?"}
    E -- "404 Not protected" --> X4["No required checks,<br/>no strict up-to-date → merge allowed"]
    X1 --> M["Non-compiling utils.rs merged (3810684)"]
    X2 --> M
    X3 --> M
    X4 --> M
```

## Evidence per checklist item

### 1. Did the Rust gate run on PR #324 / merge `e87068c`? — **No.**

- PR #324 (`gh pr view 324`): base =
  `milestone/272-verify-klac-exclude-or-correct-split-skewed-st`, head =
  `issue-294-…`, merged `2026-06-22T04:21:12Z`, merge commit
  `3810684baa447ee6654136121116ccf6593d0c88`.
- Every workflow run for the PR head SHA `4e9a346`
  (`actions/runs?head_sha=4e9a346…`): **total_count = 1 — `Accessibility` only.**
- `statusCheckRollup` for PR #324: only `check-docs-changes` and `pa11y`
  (both from the Accessibility workflow). No `Test and Quality Checks` job, no
  `cargo fmt`/`clippy`/`check`/`test`.
- `check-runs` for merge commit `3810684`: **total_count = 0.**
- `e87068c` is the later `Merge branch 'main' into milestone/272`; its
  `check-runs`: **total_count = 0.**

The Rust gate did **not** execute, was **not** skipped after triggering — it was
**never triggered**.

### 2. Is the Rust compile/clippy step a _required_ status check? — **No.**

`gh api repos/stSoftwareAU/GRQ-validation/branches/milestone/272-…/protection`
returns **HTTP 404 "Not Found"** — the milestone branch has no branch
protection, therefore no required status checks.

### 3. Was the merge required to be up to date (strict)? — **No.**

Same 404: with no protection there is no
"require branches to be up to date before merging" rule. Even had the gate
existed, nothing forced a re-run against the moved target.

### 4. Path / trigger filtering — **trigger filtering is the cause; path
filtering is not.**

- **`ci.yml` (the Rust gate) — branch trigger gap (primary).** It triggers
  **only** on `push`/`pull_request` to `branches: [ main ]`. PR #324's base is
  `milestone/272-…`, not `main`, so the whole workflow — including the `test`
  job (`cargo fmt --check`, `clippy -D warnings`, `cargo check`, `cargo test`) —
  never started.
- **`ci.yml` internal path filter is _not_ the cause.** Its `check-changes` job
  gates the `test` job on `^(src/|Cargo\.toml|Cargo\.lock|tests/)`. PR #324
  changed `src/main.rs`, `src/models.rs`, `src/utils.rs`, so `rust=true` would
  have been set. Had the workflow triggered, the gate would have caught the
  break. The path filter is innocent; the branch trigger is the fault.
- **Wildcard branch filter does not match `/` (secondary, broader than the
  original lead).** `cargo-audit`, `deno-quality`, `semgrep`, `shellcheck` and
  `markdown-lint` use `pull_request: branches: ["*"]`. In GitHub Actions branch
  filters, `*` matches any character **except `/`**; a base branch named
  `milestone/272-…` contains a `/`, so `["*"]` does **not** match it. These
  workflows therefore also never triggered on the milestone PR. (`**` or `*/*`
  would be required to match slashed branch names.)
- **`a11y.yml` is the control.** It uses a bare `pull_request:` with **no**
  `branches:` filter, so it matches every base branch — which is exactly why
  Accessibility is the sole check that ran on PRs #324 and #327.

**Confirmation across PRs** (`actions/runs?head_sha=…`):

| PR | Base branch | Workflows that ran |
|----|-------------|--------------------|
| #324 (Issue #294) | `milestone/272-…` | `Accessibility` only |
| #327 (Issue #295) | `milestone/272-…` | `Accessibility` only |
| #325 | `main` | all 11 incl. `CI/CD Pipeline`, `Cargo Audit`, `Deno Quality`, … |
| #351 | `main` | all 11 incl. `CI/CD Pipeline`, `Cargo Audit`, `Deno Quality`, … |

The discriminator is purely the base branch: `main` → full suite;
`milestone/272-…` (slashed) → Accessibility only.

### 5. Was the merge a bypass (admin override / direct push / early
auto-merge)? — **No bypass needed.**

PR #324 was a normal squash/merge to `3810684`. No admin override or force-push
was required because **zero** status checks were required on the unprotected
milestone branch — the single Accessibility check was green, so the merge
proceeded legitimately through an open gate.

## Ordered list of gaps (root → contributing)

1. **Rust gate is branch-pinned to `main`.** `ci.yml` only triggers for
   `branches: [ main ]`, so the compile/clippy/format/test gate cannot run on
   any PR whose base is a milestone or feature branch. _(Primary root cause.)_
2. **`branches: ["*"]` silently excludes slashed branches.** Because `*` does
   not match `/`, the rest of the PR quality suite also skips PRs targeting
   `milestone/…` (and any `area/…`-style) branches — far broader than just the
   Rust gate. _(Confirms and **expands** the original lead.)_
3. **No branch protection on the milestone branch.** No required status checks
   and no strict "up to date before merging" — nothing could have blocked the
   merge even if a gate had reported failure.
4. **Only the unfiltered a11y workflow guards milestone PRs today**, giving a
   false sense of "checks ran" (one green check) while the substantive Rust and
   security gates were absent.

## Recommended remediation (handed to #342)

1. **Trigger the Rust gate on milestone/feature PRs.** In `ci.yml` change the
   `pull_request` (and, if desired, `push`) filter from `branches: [ main ]` to
   include slashed branches, e.g. `branches: [main, "milestone/**", "**"]` (use
   `**` — not `*` — so slashes match), or drop the `pull_request` branch filter
   entirely so it runs on every PR.
2. **Audit the `["*"]` filters.** Replace `branches: ["*"]` with `branches:
   ["**"]` (or remove the filter) in `cargo-audit.yml`, `deno-quality.yml`,
   `semgrep.yml`, `shellcheck.yml` and `markdown-lint.yml` so they too run on
   slashed base branches.
3. **Require the Rust gate via branch protection / rulesets.** Add a ruleset
   covering `milestone/**` (and `main`) that requires the `Test and Quality
   Checks` status check and enables "require branches to be up to date before
   merging" so a green-in-isolation branch cannot break a moved target.
4. **Add a regression guard** that asserts the CI workflows' branch filters
   match the milestone naming convention, so a future `["*"]`/`[main]` filter
   cannot silently re-open this gap.

## Commands used (for reproducibility)

```bash
gh pr view 324 --json baseRefName,headRefName,mergeCommit,mergedAt
gh api 'repos/stSoftwareAU/GRQ-validation/actions/runs?head_sha=4e9a346…' \
  --jq '.total_count, [.workflow_runs[].name]'
gh pr view 324 --json statusCheckRollup
gh api repos/stSoftwareAU/GRQ-validation/commits/3810684/check-runs --jq '.total_count'
gh api repos/stSoftwareAU/GRQ-validation/commits/e87068c/check-runs --jq '.total_count'
gh api repos/stSoftwareAU/GRQ-validation/branches/milestone/272-…/protection   # 404
```
