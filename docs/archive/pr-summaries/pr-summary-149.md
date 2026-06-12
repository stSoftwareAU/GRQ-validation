## Summary

Removed the source-text prose-grep assertions from
`tests/contributing_changelog_test.ts`. Most of the file read a Markdown doc
and asserted that a literal substring (or loose regex) appeared in the prose —
a grep-as-assertion that verifies nothing observable and breaks on harmless
rewording that preserves meaning. This is the same anti-pattern the repository
deliberately removed from `tests/security_md_test.ts` and
`tests/documentation_accuracy_test.ts` under Issue #81; this file was missed in
that pass.

Applied resolution (a) from the issue: kept the two existence checks
(`CONTRIBUTING.md` / `CHANGELOG.md` exist) and the already-good version-seeding
test (which derives its expectation from `Cargo.toml` and asserts a *derivable
relationship*), and removed the brittle prose greps:

- `cargo test` / `cargo fmt` / `cargo clippy` / `cargo build`
- `deno test`
- `quality.sh`
- `pull request`
- `Keep a Changelog` / `Semantic Versioning`

The header comment now records the removal under Issue #149, matching the
wording style of the sibling files. Documentation prose remains policed by the
Markdown linter and human review.

Closes #149.

## Evidence

Backend/test-only change — no web interface to screenshot.

`deno test` for the affected file (3 behavioural tests retained, all passing):

```
running 3 tests from ./tests/contributing_changelog_test.ts
CONTRIBUTING.md exists at the repository root ... ok
CHANGELOG.md exists at the repository root ... ok
CHANGELOG.md is seeded with the current Cargo.toml version ... ok

ok | 3 passed | 0 failed
```

`./quality.sh` completes successfully across the full suite.

## Test Plan

- Modified `tests/contributing_changelog_test.ts`:
  - Retained: `CONTRIBUTING.md exists at the repository root`,
    `CHANGELOG.md exists at the repository root`,
    `CHANGELOG.md is seeded with the current Cargo.toml version`.
  - Removed: the five prose-grep tests
    (`documents the Rust build/test/lint commands`,
    `documents the Deno test suite`, `anchors on the existing quality gate`,
    `describes the pull-request workflow`,
    `follows the Keep a Changelog format`).
- Ran `deno test tests/contributing_changelog_test.ts` — 3 passed.
- Ran `./quality.sh` — passes cleanly.
