# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Theme selector in the dashboard header: an Auto/Light/Dark toggle
  (`docs/theme.js`) that persists the choice in `localStorage` and, in Auto
  mode, follows the operating system via `prefers-color-scheme`. Present on both
  the main dashboard and the score-files list (Issue #233).
- `CONTRIBUTING.md` documenting the build, test, lint, and pull-request
  workflow.
- `CHANGELOG.md` (this file) tracking notable changes between releases.
- `.github/branch-protection.json`: a machine-readable record of the intended
  branch-protection and commit-signing controls for `main`, and the controls
  deliberately relaxed for the autonomous committers, so static scans treat the
  posture as documented rather than a gap (Issue #180). Documented in
  `CONTRIBUTING.md` and `SECURITY.md`.

### Removed

- Dead `[dependencies]` `walkdir` and `thiserror`, which were declared but never
  referenced in `src/` or `tests/`. Removing them trims build time, the
  lockfile, and the supply-chain surface.
- Dead CLI code in `src/main.rs`: the `--performance-only` flag (parsed but
  never read, so it silently did nothing) and the unreachable second
  `--calculate-performance` block (dominated by an earlier early-return).

## [0.1.10] - 2026-06-11

### Added

- Hybrid projection for score files less than 90 days old, projecting
  performance from current actual prices.
- A shared projection module so the TypeScript tests exercise production
  projection logic.
- Static dashboard (published via GitHub Pages from `docs/`) with interactive
  charts and tables for performance analysis.
- Dividend tracking and total-return calculation.
- CI/CD workflows for continuous integration, `cargo audit`, `deno audit`,
  Dependency Review, Gitleaks, Markdown Lint, Semgrep, and Shellcheck.
- Dependabot configuration for the Cargo and GitHub Actions ecosystems with a
  release-age cooldown.
- `SECURITY.md` supply-chain runbook with a disclosure contact and emergency
  dependency-bump procedures for both the Rust and Deno sides.

### Changed

- The binary now consumes the `grq_validation` library crate rather than
  duplicating logic.
- Untrusted TSV fields are escaped to prevent stored/DOM XSS in the dashboard.

[Unreleased]: https://github.com/stSoftwareAU/GRQ-validation/compare/v0.1.10...HEAD
[0.1.10]: https://github.com/stSoftwareAU/GRQ-validation/releases/tag/v0.1.10
