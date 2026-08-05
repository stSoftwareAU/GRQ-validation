//! Behaviour tests for `scripts/needs_rebuild.sh` (issue #818).
//!
//! `run.sh` used to decide whether to rebuild by diffing `HEAD~1..HEAD` for
//! changes under `src/` or `Cargo.toml`. A pull that lands several commits at
//! once reuses the stale binary whenever the newest commit misses those paths,
//! which is how GRQ-3 kept running a binary that predated `--market-data-path`
//! and failed every cycle (#816 recurring as #818).
//!
//! The replacement compares the version the built binary reports with
//! `[package].version` in `Cargo.toml`. These tests source the real helper and
//! call `needs_rebuild` against stand-in binaries, asserting on its verdict and
//! the reason it reports.

use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use tempfile::TempDir;

fn helper() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("scripts/needs_rebuild.sh")
}

/// Sources the helper and calls `needs_rebuild`, returning its output. The
/// verdict is printed as `REBUILD` or `CURRENT` followed by the reason.
fn needs_rebuild(binary: &Path, manifest: &Path) -> Output {
    Command::new("bash")
        .arg("-c")
        .arg(
            r#". "$1"
if needs_rebuild "$2" "$3"; then echo "REBUILD"; else echo "CURRENT"; fi
echo "reason: $REBUILD_REASON""#,
        )
        .arg("needs_rebuild_test")
        .arg(helper())
        .arg(binary)
        .arg(manifest)
        .output()
        .expect("run needs_rebuild")
}

fn combined(output: &Output) -> String {
    let mut text = String::from_utf8_lossy(&output.stdout).into_owned();
    text.push_str(&String::from_utf8_lossy(&output.stderr));
    text
}

/// Writes a manifest declaring `version` and returns its path.
fn manifest_with(dir: &TempDir, version: &str) -> PathBuf {
    let path = dir.path().join("Cargo.toml");
    std::fs::write(
        &path,
        format!("[package]\nname = \"grq-validation\"\nversion = \"{version}\"\n"),
    )
    .expect("write manifest");
    path
}

/// Writes an executable stand-in binary whose body is `body`.
fn fake_binary(dir: &TempDir, body: &str) -> PathBuf {
    let path = dir.path().join("grq-validation");
    std::fs::write(&path, format!("#!/bin/bash\n{body}\n")).expect("write binary");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))
            .expect("chmod binary");
    }
    path
}

#[test]
fn a_missing_binary_needs_a_rebuild() {
    let dir = TempDir::new().expect("temp dir");
    let manifest = manifest_with(&dir, "0.1.11");
    let binary = dir.path().join("grq-validation");

    let output = needs_rebuild(&binary, &manifest);

    let text = combined(&output);
    assert!(text.contains("REBUILD"), "expected a rebuild, got: {text}");
    assert!(
        text.contains("missing"),
        "the reason must name the missing binary, got: {text}"
    );
}

#[test]
fn a_stale_binary_needs_a_rebuild() {
    let dir = TempDir::new().expect("temp dir");
    let manifest = manifest_with(&dir, "0.1.11");
    // The exact failure from #818: a deployed binary built before the change.
    let binary = fake_binary(&dir, "echo 'grq-validation 0.1.9'");

    let output = needs_rebuild(&binary, &manifest);

    let text = combined(&output);
    assert!(text.contains("REBUILD"), "expected a rebuild, got: {text}");
    assert!(
        text.contains("0.1.9") && text.contains("0.1.11"),
        "the reason must name both versions, got: {text}"
    );
}

#[test]
fn a_binary_without_a_version_flag_needs_a_rebuild() {
    let dir = TempDir::new().expect("temp dir");
    let manifest = manifest_with(&dir, "0.1.11");
    // A pre-clap-version binary: it rejects the flag instead of answering it.
    let binary = fake_binary(
        &dir,
        "echo \"error: unexpected argument '--version' found\" >&2\nexit 2",
    );

    let output = needs_rebuild(&binary, &manifest);

    let text = combined(&output);
    assert!(text.contains("REBUILD"), "expected a rebuild, got: {text}");
}

#[test]
fn a_binary_that_reports_nothing_needs_a_rebuild() {
    let dir = TempDir::new().expect("temp dir");
    let manifest = manifest_with(&dir, "0.1.11");
    let binary = fake_binary(&dir, "exit 0");

    let output = needs_rebuild(&binary, &manifest);

    let text = combined(&output);
    assert!(text.contains("REBUILD"), "expected a rebuild, got: {text}");
}

#[test]
fn a_current_binary_is_reused() {
    let dir = TempDir::new().expect("temp dir");
    let manifest = manifest_with(&dir, "0.1.11");
    let binary = fake_binary(&dir, "echo 'grq-validation 0.1.11'");

    let output = needs_rebuild(&binary, &manifest);

    let text = combined(&output);
    assert!(
        text.contains("CURRENT") && !text.contains("REBUILD"),
        "a matching binary must be reused, got: {text}"
    );
}

#[test]
fn an_unreadable_manifest_fails_loudly() {
    let dir = TempDir::new().expect("temp dir");
    let manifest = dir.path().join("Cargo.toml");
    let binary = fake_binary(&dir, "echo 'grq-validation 0.1.11'");

    let output = needs_rebuild(&binary, &manifest);

    let text = combined(&output);
    assert!(
        !output.status.success(),
        "a missing manifest must not be masked as a clean check, got: {text}"
    );
    assert!(
        !text.contains("CURRENT") && !text.contains("REBUILD"),
        "no verdict may be reported for an unreadable manifest, got: {text}"
    );
}

#[test]
fn the_release_binary_is_checked_against_the_repository_manifest() {
    // End-to-end wiring: the shipped defaults resolve, so the helper can judge
    // this repository's own release binary without extra configuration.
    let repo = Path::new(env!("CARGO_MANIFEST_DIR"));

    let output = needs_rebuild(
        &repo.join("target/release/grq-validation"),
        &repo.join("Cargo.toml"),
    );

    let text = combined(&output);
    assert!(
        output.status.success(),
        "the check must complete against the real manifest, got: {text}"
    );
    assert!(
        text.contains("REBUILD") || text.contains("CURRENT"),
        "the check must report a verdict, got: {text}"
    );
}
