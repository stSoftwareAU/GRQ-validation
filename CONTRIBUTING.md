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
