# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Market-data presence quality gate (`tests/market_data_presence_test.ts`): a
  Deno test, run on every PR via `deno-quality.yml`, that iterates every
  committed `docs/scores/**/DD.tsv` prediction and fails CI when the sibling
  `DD.csv` is missing, blank, or header-only — naming each offending date. It
  mirrors the "> 1 non-blank line" rule of
  `src/utils.rs::is_market_data_csv_empty` so a date that would render in the
  dashboard's "Limited data mode" can no longer be published (Issue #674).
- Negative-score exclusion: a stock whose raw AI model score is ≤ 0 (predicted
  to fall) is dropped from the dashboard portfolio and every aggregate
  (equal-weight) figure, re-weighting the remaining stocks, and kept visible
  with a red **Negative score** badge and a conditional legend. The rule is
  applied through the single inclusion predicate shared by the dashboard
  (`isStockIncluded`, `docs/projection.js`) and the Rust backend
  (`is_priceable`, `src/utils.rs`), so backend aggregates and the dashboard
  agree. An unknown/missing score never excludes (Issue #627).
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
- `scripts/bump_version.ts` and the **Version Bump** workflow
  (`.github/workflows/version-bump.yml`): on every pull request the dashboard
  app version is incremented across `docs/sw.js`, `docs/sw-register.js`, and
  `docs/index.html` and committed back to the branch, so the service-worker
  cache key always changes and clients pick up the new build. The bump is
  idempotent relative to the base branch (Issue #323).

### Changed

- Chart window now defaults to **180 days on every form factor** (previously 90
  on mobile, 180 on desktop). A fresh device shows the full 180-day window; the
  90/180 toggle, the per-device saved choice, and the transient `?window=` deep
  link are unchanged, so a user can still opt into 90 (Issue #711).
- `GRQProjection.deviceWindowDays`/`deviceWindowEnd` (`docs/projection.js`) now
  honour an explicit permitted window (90 or 180) on **either** device, relaxing
  the old desktop-180 lock so a desktop 90-day choice can take effect. Each
  device keeps its own default when the value is missing or invalid (mobile 90,
  desktop 180). The helper stays pure — the caller supplies the value — and the
  allow-list constant is renamed `PERMITTED_WINDOW_DAYS` (Issue #464).

### Fixed

- Charts no longer keep the previous theme's colours after a theme switch,
  which left the canvas-drawn axis ticks, axis titles and legend unreadable
  (near-white text on a light page after switching to light; dark-on-dark after
  switching to dark). Chart.js paints those colours once at build, so the fix
  adds `GRQChartTheme.applyChartTheme(chart, theme)` — the single source of
  truth that re-sources every canvas colour from the theme and repaints the
  live chart — and calls it on the theme-toggle click and the
  `prefers-color-scheme` change for the main dashboard chart (which the mobile
  pop-out re-parents) and the trend chart, in both switch directions
  (Issue #708).
- Re-restored the 161 market-data CSVs under `docs/scores/2026/` (and their
  `index.json` performance figures) after a fresh "Auto commit models" push
  (`642eb620`, author `scorer 3`) re-wiped every one back to a lone header row —
  0 rows added, 205 488 deleted — which again forced the dashboard into "Limited
  data mode" for every 2026 date, including the reported
  `?date=2026-04-02`. `tests/regression_2026_market_data_test.rs` now also pins
  `2026-04-02` so a future re-wipe fails the build. The durable fix — stopping
  the external `scorer 3` pipeline from pushing header-only CSVs straight to
  `main` (bypassing the PR-only presence gate) — needs a human and is tracked in
  a follow-up (Issue #685).
- Restored the 161 market-data CSVs under `docs/scores/2026/` that a stray "Auto
  commit models" had reduced to a bare header row, which had forced the
  dashboard into "Limited data mode" for every 2026 prediction date. The price
  rows (and the matching `index.json` performance figures) are recovered from
  the pre-wipe commit, so the new presence gate goes green on a fixed tree
  (Issue #674; restores the data tracked by #672).
- Dashboard no longer fails to load with
  `GRQProjection.calculatePortfolioTargetWorking is not a function`. The service
  worker could cache or serve an internally-inconsistent app shell — a fresh
  `app.js` next to a stale/missing `projection.js`. The fix hardens `docs/sw.js`
  three ways: (1) shell assets are precached with `cache: "reload"`, bypassing
  the browser HTTP cache so a version bump always stores fresh bytes; (2) the
  **core** shell (the interdependent HTML/JS/CSS) is precached atomically —
  every core asset is fetched first and stored only if all succeed, and a failed
  precache now rejects the install instead of activating a partial shell, so
  `app.js` and `projection.js` always move in lock-step (optional
  icons/manifest/ CDN stay best-effort); (3) the fetch handler serves shell
  assets only from the **current** version's cache, so a leftover old-version
  cache can never serve a stale, mismatched asset (Issue #641).
- Footer **🔗 Share** button now copies a deep-link to the clipboard. The
  link-builder and clipboard/fallback handling shipped in `docs/share_link.js`
  (Issue #495) but the dashboard never called `GRQShare.initShareButton(...)`,
  so a tap did nothing — no copy, no confirmation. `docs/app.js` now wires the
  button to the live selections via `shareState()` on init (Issue #515).

### Removed

- Dead `[dependencies]` `walkdir` and `thiserror`, which were declared but never
  referenced in `src/` or `tests/`. Removing them trims build time, the
  lockfile, and the supply-chain surface.
- `setup-hooks.sh` and `scripts/pre-commit`: the local Git pre-commit hook that
  auto-incremented the version. It only fired when a contributor had installed
  it, so versions were frequently not bumped and clients did not update. The
  CI-driven **Version Bump** workflow replaces it (Issue #323).
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
