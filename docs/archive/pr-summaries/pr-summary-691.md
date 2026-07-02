# PR Summary — Issue #691

## Summary

Added the canonical `repository` metadata field to the `[package]` table in
`Cargo.toml`. The manifest previously declared `name`, `version`, `edition`,
`authors`, `description`, and `license` but omitted `repository` — the
source-location field that crates.io and `cargo doc` surface and that SBOM
generators use for provenance. Its absence weakened the crate's provenance and
traceability. Closes #691.

```diff
 description = "A Rust program to process daily stock scores from TSV files"
 license = "Apache-2.0"
+repository = "https://github.com/stSoftwareAU/GRQ-validation"
```

## Evidence

Backend/CLI metadata change only — no web interface to screenshot.

`CARGO_PKG_REPOSITORY` is populated by Cargo from the `[package] repository`
field at compile time, mirroring the existing `license_metadata_test.rs`
pattern for `CARGO_PKG_LICENSE`. New tests assert the field is present and
points at the canonical GitHub URL:

- Before the fix: both tests failed (`CARGO_PKG_REPOSITORY` was empty).
- After the fix: both tests pass, and the full Rust suite (all targets) passes.

## Test Plan

- Added `tests/repository_metadata_test.rs`:
  - `manifest_declares_repository` — asserts the `repository` field is non-empty.
  - `manifest_repository_is_canonical_github_url` — asserts it equals
    `https://github.com/stSoftwareAU/GRQ-validation`.
- `cargo fmt --all -- --check` — clean.
- `cargo clippy --tests --all-features -- -D warnings` — clean.
- `cargo test --all-targets --all-features` — all tests pass.
