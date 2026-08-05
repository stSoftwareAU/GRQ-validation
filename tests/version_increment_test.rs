//! Behaviour tests for `scripts/version-increment.sh` (issue #818).
//!
//! The helper is the single reader/writer of the manifest's `[package].version`
//! field: CI calls it on every pull request so each merged change carries a new
//! version, and `scripts/needs_rebuild.sh` calls it to decide whether the
//! deployed binary is stale. These tests execute the real script against
//! throw-away manifests and git repositories and assert on observable
//! behaviour — stdout, exit codes and the bytes left on disk.

use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use tempfile::TempDir;

const MANIFEST: &str = concat!(
    "[package]\n",
    "name = \"grq-validation\"\n",
    "version = \"1.2.3\"\n",
    "edition = \"2021\"\n",
    "\n",
    "[dependencies]\n",
    "csv = \"1.3\"\n",
);

fn script() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("scripts/version-increment.sh")
}

fn run(args: &[&str]) -> Output {
    Command::new("bash")
        .arg(script())
        .args(args)
        .output()
        .expect("run version-increment.sh")
}

fn stdout(output: &Output) -> String {
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

fn combined(output: &Output) -> String {
    let mut text = String::from_utf8_lossy(&output.stdout).into_owned();
    text.push_str(&String::from_utf8_lossy(&output.stderr));
    text
}

/// A temporary directory holding a manifest at `Cargo.toml`.
fn manifest_dir() -> (TempDir, PathBuf) {
    let dir = TempDir::new().expect("temp dir");
    let manifest = dir.path().join("Cargo.toml");
    std::fs::write(&manifest, MANIFEST).expect("write manifest");
    (dir, manifest)
}

fn git(dir: &Path, args: &[&str]) {
    let output = Command::new("git")
        .args(args)
        .current_dir(dir)
        .output()
        .unwrap_or_else(|error| panic!("git {args:?}: {error}"));
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        combined(&output)
    );
}

/// A temporary git repository whose single `main` commit holds the manifest.
fn git_repo() -> (TempDir, PathBuf) {
    let (dir, manifest) = manifest_dir();
    let path = dir.path();
    git(path, &["init", "--initial-branch=main"]);
    git(path, &["config", "user.email", "test@example.com"]);
    git(path, &["config", "user.name", "Test"]);
    git(path, &["add", "Cargo.toml"]);
    git(path, &["commit", "-m", "seed"]);
    (dir, manifest)
}

fn version_in(manifest: &Path) -> String {
    let text = std::fs::read_to_string(manifest).expect("read manifest");
    text.lines()
        .find(|line| line.trim_start().starts_with("version"))
        .and_then(|line| line.split('"').nth(1))
        .expect("manifest version")
        .to_string()
}

#[test]
fn get_version_prints_the_package_version() {
    let (_dir, manifest) = manifest_dir();

    let output = run(&["--get-version", "--manifest", manifest.to_str().unwrap()]);

    assert!(output.status.success(), "{}", combined(&output));
    assert_eq!(stdout(&output), "1.2.3");
}

#[test]
fn get_version_fails_loudly_when_the_manifest_is_missing() {
    let dir = TempDir::new().expect("temp dir");
    let missing = dir.path().join("nope/Cargo.toml");

    let output = run(&["--get-version", "--manifest", missing.to_str().unwrap()]);

    assert!(
        !output.status.success(),
        "a missing manifest must not be reported as success: {}",
        combined(&output)
    );
    assert!(
        combined(&output).contains("not found"),
        "the error must name the missing manifest, got: {}",
        combined(&output)
    );
}

#[test]
fn bump_patch_writes_the_next_patch_version() {
    let (_dir, manifest) = manifest_dir();

    let output = run(&["--bump-patch", "--manifest", manifest.to_str().unwrap()]);

    assert!(output.status.success(), "{}", combined(&output));
    assert_eq!(stdout(&output), "1.2.4");
    assert_eq!(version_in(&manifest), "1.2.4");
    // Dependency versions must survive the rewrite untouched.
    let text = std::fs::read_to_string(&manifest).expect("read manifest");
    assert!(
        text.contains("csv = \"1.3\""),
        "dependencies changed: {text}"
    );
}

#[test]
fn bump_patch_dry_run_leaves_the_manifest_alone() {
    let (_dir, manifest) = manifest_dir();

    let output = run(&[
        "--bump-patch",
        "--dry-run",
        "--manifest",
        manifest.to_str().unwrap(),
    ]);

    assert!(output.status.success(), "{}", combined(&output));
    assert_eq!(stdout(&output), "1.2.4");
    assert_eq!(version_in(&manifest), "1.2.3");
}

#[test]
fn bump_patch_rejects_a_non_semver_version() {
    let (dir, manifest) = manifest_dir();
    std::fs::write(&manifest, "[package]\nversion = \"nightly\"\n").expect("write manifest");

    let output = run(&["--bump-patch", "--manifest", manifest.to_str().unwrap()]);

    assert!(
        !output.status.success(),
        "a non-semver version must fail loudly: {}",
        combined(&output)
    );
    drop(dir);
}

#[test]
fn already_bumped_is_false_when_the_branch_matches_the_base() {
    let (dir, manifest) = git_repo();

    let output = run(&[
        "--already-bumped",
        "--manifest",
        manifest.to_str().unwrap(),
        "--repo",
        dir.path().to_str().unwrap(),
        "--base-ref",
        "main",
    ]);

    assert!(
        !output.status.success(),
        "an unbumped branch must report 'not bumped': {}",
        combined(&output)
    );
}

#[test]
fn already_bumped_is_true_when_the_branch_moved_the_version() {
    let (dir, manifest) = git_repo();
    run(&["--bump-patch", "--manifest", manifest.to_str().unwrap()]);

    let output = run(&[
        "--already-bumped",
        "--manifest",
        manifest.to_str().unwrap(),
        "--repo",
        dir.path().to_str().unwrap(),
        "--base-ref",
        "main",
    ]);

    assert!(
        output.status.success(),
        "a branch-side bump must be detected: {}",
        combined(&output)
    );
}

#[test]
fn run_bumps_once_and_then_skips() {
    let (dir, manifest) = git_repo();
    let args = [
        "--run",
        "--manifest",
        manifest.to_str().unwrap(),
        "--repo",
        dir.path().to_str().unwrap(),
        "--base-ref",
        "main",
    ];

    let first = run(&args);
    assert!(first.status.success(), "{}", combined(&first));
    assert!(
        stdout(&first).starts_with("bumped:"),
        "first run must bump, got: {}",
        stdout(&first)
    );
    assert_eq!(version_in(&manifest), "1.2.4");

    // Re-running CI on the same branch must not ratchet the version again.
    let second = run(&args);
    assert!(second.status.success(), "{}", combined(&second));
    assert!(
        stdout(&second).starts_with("skip:"),
        "second run must skip, got: {}",
        stdout(&second)
    );
    assert_eq!(version_in(&manifest), "1.2.4");
}

#[test]
fn run_bumps_when_the_base_ref_is_unreachable() {
    let (dir, manifest) = git_repo();

    let output = run(&[
        "--run",
        "--manifest",
        manifest.to_str().unwrap(),
        "--repo",
        dir.path().to_str().unwrap(),
        "--base-ref",
        "origin/does-not-exist",
    ]);

    assert!(output.status.success(), "{}", combined(&output));
    assert!(
        stdout(&output).starts_with("bumped:"),
        "an unknown base ref must stay conservative and bump, got: {}",
        stdout(&output)
    );
    assert_eq!(version_in(&manifest), "1.2.4");
}

#[test]
fn an_unknown_option_is_a_usage_error() {
    let output = run(&["--get-version", "--wat"]);

    assert_eq!(
        output.status.code(),
        Some(2),
        "unknown options must exit 2: {}",
        combined(&output)
    );
}

#[test]
fn a_missing_mode_is_a_usage_error() {
    let output = run(&["--manifest", "Cargo.toml"]);

    assert_eq!(
        output.status.code(),
        Some(2),
        "a missing mode must exit 2: {}",
        combined(&output)
    );
}

#[test]
fn the_repository_manifest_is_readable_by_default() {
    // The shipped defaults must point at this repository's own manifest, so a
    // bare `--get-version` from the repo root reports the real version.
    let output = Command::new("bash")
        .arg(script())
        .arg("--get-version")
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .output()
        .expect("run version-increment.sh");

    assert!(output.status.success(), "{}", combined(&output));
    assert_eq!(stdout(&output), env!("CARGO_PKG_VERSION"));
}
