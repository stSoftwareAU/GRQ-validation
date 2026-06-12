//! Tests that the library crate root declares an explicit lint posture
//! (Issue #116).
//!
//! A lint posture is a compile-time configuration, not a runtime function, so
//! — like `license_metadata_test.rs`, which verifies the committed LICENSE
//! against the manifest — these tests assert on the committed crate root
//! (`src/lib.rs`). The whole point of the issue is that without an explicit,
//! committed posture, hygiene lints accumulate or get dropped silently; these
//! tests fail loudly if the posture is removed or weakened.
//!
//! The complementary half of the posture — `deny(warnings)` — is enforced in
//! CI by `quality.sh` (`cargo clippy ... -D warnings`) rather than hard-coded
//! into the source, which would break day-to-day builds on compiler upgrades.

use std::fs;

/// Read the inner attributes (`#![...]`) declared at the top of the crate root.
fn crate_root_attributes() -> String {
    fs::read_to_string("src/lib.rs").expect("src/lib.rs must exist")
}

#[test]
fn crate_root_warns_on_missing_docs() {
    let src = crate_root_attributes();
    assert!(
        src.contains("#![warn(missing_docs)]"),
        "src/lib.rs must keep `#![warn(missing_docs)]` so the public API stays documented"
    );
}

#[test]
fn crate_root_denies_unsafe_code() {
    let src = crate_root_attributes();
    assert!(
        src.contains("#![deny(unsafe_code)]"),
        "src/lib.rs must declare `#![deny(unsafe_code)]`: this crate is pure safe \
         Rust, so any future `unsafe` must be an explicit, reviewed decision"
    );
}

#[test]
fn crate_root_denies_unsafe_op_in_unsafe_fn() {
    let src = crate_root_attributes();
    assert!(
        src.contains("#![deny(unsafe_op_in_unsafe_fn)]"),
        "src/lib.rs must declare `#![deny(unsafe_op_in_unsafe_fn)]` so unsafe \
         operations inside any future unsafe fn require their own unsafe block"
    );
}
