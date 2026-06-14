# Contributing to GRQ Validation

Thanks for your interest in improving GRQ Validation. This project is a hybrid
codebase — a Rust library and binary that process daily stock scores, paired
with a static dashboard and a Deno (TypeScript) test suite. The notes below
cover how to build, test, and submit changes.

## Prerequisites

- **Rust** (latest stable) — the library and CLI.
- **Deno** — the dashboard and TypeScript tests.
- **Git**.

## Getting started

```bash
git clone https://github.com/stSoftwareAU/GRQ-validation.git
cd GRQ-validation
cargo build --release
```

## Building and running

```bash
# Build the release binary
cargo build --release

# Process recent score files (within 100 days)
./run.sh

# Process every score file, including older ones
./run.sh --process-all

# Process a specific date
./target/release/grq-validation --docs-path docs --date 2025-01-15
```

## Testing

```bash
# Run all Rust tests
cargo test

# Run a single Rust test
cargo test test_name

# Run the Deno test suite (dashboard / workflow tests)
deno test --allow-read tests/
```

## Formatting and linting

```bash
# Format Rust code
cargo fmt --all

# Lint Rust code (warnings are treated as errors)
cargo clippy --all-targets --all-features -- -D warnings

# Format and lint the Deno side
deno fmt docs/*.js docs/*.html docs/*.css tests/*.ts
deno lint tests/*.ts
deno check tests/*.ts
```

## The local quality gate

Before opening a pull request, run the full quality gate. It mirrors CI by
running formatting checks, Clippy, the Rust tests with coverage, a release
build, and the Deno format/lint/check/test steps:

```bash
./quality.sh
```

Keep running `./quality.sh` until it passes cleanly. On unattended machines,
redirect stdin to avoid hangs: `./quality.sh < /dev/null`.

## Submitting changes — the pull-request workflow

1. **Fork** the repository (external contributors) or create a branch.
2. **Create a feature branch** off `main`.
3. **Make your changes** following Test-Driven Development: add a failing test
   that defines the expected behaviour, then implement the code to make it pass.
4. **Run `./quality.sh`** and ensure it passes cleanly.
5. **Update documentation** (`README.md`, `CHANGELOG.md`, and any relevant docs)
   when your change affects usage, behaviour, or the public surface.
6. **Open a pull request** with a clear description of what changed and why,
   referencing any related issue.

## Branch protection, review, and commit signing

The repository's governance posture for the default branch (`main`) is recorded
as machine-readable static evidence in
[`.github/branch-protection.json`](.github/branch-protection.json), so security
scans can confirm the intended controls — and the deliberately relaxed ones —
rather than treating them as an undocumented gap. GitHub does **not** apply that
file automatically; a repository administrator enforces the controls via
Settings → Branches or a repository ruleset. The intended controls are:

- **Require a pull request before merging** with at least one approving review.
- **Require review from Code Owners** so the committed
  [`.github/CODEOWNERS`](.github/CODEOWNERS) rules are enforced rather than
  advisory.
- **Block force-pushes and deletions** on `main`.
- **Require linear history** (the rebase/squash workflow above).
- **Require signed commits.**

### Controls intentionally relaxed for automation

Two controls are deliberately relaxed for the autonomous committer identities,
and this is a recorded operational choice — not an oversight:

- **Direct pushes for daily data.** The automated `scorer 3` identity pushes
  daily score files and auto-committed models under `docs/` straight to `main`.
  These commits touch generated data only — never source, workflows, or actions
  (which CODEOWNERS guards) — and a human-reviewed pull request per day is
  operationally infeasible. A ruleset bypass actor scoped to this identity is
  the recommended way to encode the exception.
- **Unsigned automation commits.** Per-identity GPG/SSH signing keys for the
  automated committers (`scorer 3`, `Vibe Coder`, `service @ ST`) are not yet
  provisioned, so commits from these identities are currently unsigned. This is
  an accepted, documented posture and tracked as future work; once keys are
  issued and `commit.gpgsign` is configured per identity, `main` will show the
  **Verified** badge.

See [SECURITY.md](SECURITY.md) for the rationale linking these controls to the
supply-chain attack shape they defend against.

## Conventions

- **Australian English** — use Australian spelling in code, comments, and
  documentation (e.g. colour, behaviour, organisation, favour, centre).
- **Keep the changelog current** — record notable changes in `CHANGELOG.md`
  under the `[Unreleased]` heading, and move them under a versioned heading
  when the `Cargo.toml` version is bumped.
- **Security** — see [SECURITY.md](SECURITY.md) for disclosure and the
  emergency dependency-bump procedure.

## Licence

By contributing, you agree that your contributions are licensed under the
Apache License, Version 2.0. See [LICENSE](LICENSE) for the full text.
