// Tests that the manifest declares a canonical `repository` URL (Issue #691).
//
// `CARGO_PKG_REPOSITORY` is populated by Cargo from the `[package] repository`
// field at compile time — it is the source-location value that crates.io and
// `cargo doc` surface, and that SBOM generators use for provenance. These tests
// verify the manifest declares the field and that it points at the canonical
// GitHub repository, so the crate's provenance cannot drift silently.

/// The manifest must declare a non-empty `repository` field.
#[test]
fn manifest_declares_repository() {
    assert!(
        !env!("CARGO_PKG_REPOSITORY").is_empty(),
        "Cargo.toml [package] repository must be set to the canonical source URL"
    );
}

/// The declared repository must be the canonical GitHub URL for this crate.
#[test]
fn manifest_repository_is_canonical_github_url() {
    assert_eq!(
        env!("CARGO_PKG_REPOSITORY"),
        "https://github.com/stSoftwareAU/GRQ-validation",
        "Cargo.toml [package] repository must be the canonical GitHub URL"
    );
}
