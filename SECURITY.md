# Security Policy

This repository (`grq-validation`) is a hybrid Rust + Deno project. This
policy tells a reporter who to contact and gives the maintainers a rehearsed
steer for cutting an emergency dependency bump if a transitive crate or JSR
module is found to be compromised.

## Reporting a vulnerability

Please report any suspected vulnerability — including a compromised
dependency — privately to **security@stsoftware.com.au**.

- Do **not** open a public GitHub issue for a security report.
- Include the affected component, the version, and how to reproduce or
  observe the problem.
- You will receive an acknowledgement, and we will keep you updated on the
  remediation.

You may also use GitHub's
[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
to open a private advisory on this repository.

## Code ownership and branch protection

The repository ships a [`CODEOWNERS`](.github/CODEOWNERS) file that puts a
trusted reviewer on its privileged surface. The CI/CD workflows run with
`id-token: write` and consume non-`GITHUB_TOKEN` secrets (`SEMGREP_APP_TOKEN`,
`CODECOV_TOKEN`, `GITLEAKS_LICENSE`, `ACTIONS_PUSH`), so `CODEOWNERS` requires a
named owner to approve any change under `/.github/workflows/` and
`/.github/actions/` — raising the bar against the tj-actions / OIDC-theft
supply-chain attack shape.

`CODEOWNERS` only requests reviews on its own; enforcement comes from
branch-protection settings, which a repository administrator must enable on the
default branch (they are not stored in the tree). The intended controls — and
the controls deliberately relaxed for the autonomous committers — are recorded
as machine-readable static evidence in
[`.github/branch-protection.json`](.github/branch-protection.json) and described
for contributors in [CONTRIBUTING.md](CONTRIBUTING.md). The intended settings
are:

- Require at least one approving pull-request review.
- **Require review from Code Owners.**
- Block direct pushes and force-pushes to the default branch.
- Require linear history (to suit the rebase/squash workflow).
- **Require signed commits**, so `git log --show-signature` reports a good
  signature on `main` and GitHub shows a **Verified** badge.

Two controls are deliberately relaxed for automation and recorded as such: the
`scorer 3` identity pushes daily data-only commits under `docs/` directly to
`main`, and the automated committers (`scorer 3`, `Vibe Coder`, `service @ ST`)
currently commit unsigned because per-identity signing keys are not yet
provisioned. Both are accepted, documented postures tracked as future work — see
`.github/branch-protection.json` for the per-control rationale.

## Emergency dependency-bump procedure

When a malicious or vulnerable version of a dependency is disclosed, pin the
known-safe version, refresh the lockfile, and re-run the tests before
merging. Land the fix straight to the default branch as an out-of-band update.

### Deno (JSR / `@std`) dependencies

1. Pin the safe version in the `imports` map of `deno.json`.
2. Refresh the cache and lockfile:

   ```bash
   deno cache --reload scripts/debug/check_syntax.ts
   deno outdated            # confirm the pinned version is in effect
   ```

3. Regenerate `deno.lock` (delete and re-resolve if needed) so the safe
   version is locked.
4. Verify before merging:

   ```bash
   deno test --allow-read tests/*.ts
   ```

### Rust (Cargo) dependencies

1. Pin the safe version precisely:

   ```bash
   cargo update -p <crate> --precise <version>
   ```

2. Confirm the advisory is cleared and re-run the test suite:

   ```bash
   cargo audit
   cargo test --all-targets --all-features
   ```

### Overriding the quarantine window

The procedure above assumes the known-safe version has already cleared the
repository's 24-hour dependency-age quarantine. That same quarantine — the
`VIBE_BUMP_QUARANTINE_HOURS` window enforced by the **Dependency Quarantine
Gate** workflow for Cargo/Action bumps, and the `minimumDependencyAge`
(`age: "P1D"`, i.e. 24 hours) policy enforced for the Deno channel — also
blocks a *legitimate* emergency patch when the only fix for an
actively-exploited CVE ships as a release younger than 24 hours. The gate is
deliberately fail-closed and has no env-var escape hatch, so use the explicit,
reviewable override below rather than an ad-hoc bypass. Treat this as a
last resort for an active incident, not a routine fast-lane.

**Cargo / GitHub Actions channel — Code-Owner check override.** The gate runs
as a required status check; there is intentionally no `emergency_bypass` input
to keep it attacker-unbypassable. To land a sub-24h patch:

1. Open the emergency bump PR exactly as in the procedure above, pinning the
   single vetted dependency and version.
2. Re-run `cargo audit` first and confirm the advisory is cleared by the
   pinned version — the override is only justified once the fix is proven.
3. Record the justification on the PR: the CVE/advisory ID, the dependency and
   version, and why waiting out the window is riskier than merging early.
4. A **Code Owner** (see [`CODEOWNERS`](.github/CODEOWNERS)) — and only a Code
   Owner — then dismisses/overrides the failing **Dependency Quarantine Gate**
   required check on that one PR via branch-protection's "require status
   checks" override, leaving the audit gate and review in force. The override
   is per-PR, logged in the PR timeline, and never widens the window for other
   PRs.

**Deno (JSR / `@std`) channel — explicit pin.** `minimumDependencyAge`
(`age: "P1D"`) gates resolution of *new* versions, but it does not block an
explicit pin already written into the tree. To override:

1. Pin the patched, vetted version directly in the `imports` map of
   `deno.json` (an explicit pin is honoured even when younger than the window).
2. Refresh `deno.lock` so the safe version is locked, then re-run
   `deno test --allow-read tests/*.ts` before merging.

In both channels the override is a documented, rehearsed path that keeps the
audit and Code-Owner review in force — it relaxes only the age window, only for
the single named dependency, and only for the duration of the incident PR.

A few minutes of this rehearsed procedure is enough — the goal is that a
reporter knows who to tell and the team has an agreed steer for the
out-of-band update, not an exhaustive runbook.
