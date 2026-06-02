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

## Emergency dependency-bump procedure

When a malicious or vulnerable version of a dependency is disclosed, pin the
known-safe version, refresh the lockfile, and re-run the tests before
merging. Land the fix straight to the default branch as an out-of-band update.

### Deno (JSR / `@std`) dependencies

1. Pin the safe version in the `imports` map of `deno.json`.
2. Refresh the cache and lockfile:

   ```bash
   deno cache --reload check_syntax.ts
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

A few minutes of this rehearsed procedure is enough — the goal is that a
reporter knows who to tell and the team has an agreed steer for the
out-of-band update, not an exhaustive runbook.
