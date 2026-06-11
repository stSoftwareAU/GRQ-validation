// Tests that the manifest's machine-readable licence metadata matches the
// committed Apache-2.0 LICENSE file (Issue #76).
//
// `CARGO_PKG_LICENSE` is populated by Cargo from the `[package] license`
// field at compile time — it is the value that SBOM generators, dependency
// scanners and crates.io read. These tests verify the manifest declares the
// SPDX short code and that it agrees with the committed LICENSE file, so the
// two cannot drift silently.

/// The SPDX licence declared in the manifest must be the Apache-2.0 short code.
#[test]
fn manifest_declares_apache_2_0_spdx_licence() {
    assert_eq!(
        env!("CARGO_PKG_LICENSE"),
        "Apache-2.0",
        "Cargo.toml [package] license must be the SPDX identifier 'Apache-2.0'"
    );
}

/// The declared SPDX licence must agree with the committed LICENSE file.
#[test]
fn manifest_licence_matches_committed_license_file() {
    let manifest = env!("CARGO_PKG_LICENSE");
    assert_eq!(
        manifest, "Apache-2.0",
        "expected Apache-2.0 manifest licence"
    );

    let license = std::fs::read_to_string("LICENSE").expect("LICENSE file must exist");
    assert!(
        license.contains("Apache License") && license.contains("Version 2.0"),
        "committed LICENSE must be the Apache License, Version 2.0 to match the manifest"
    );
}
