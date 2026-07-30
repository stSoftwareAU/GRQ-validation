//! Behaviour tests for the shell entry points' data-root pre-flight (issue
//! #803).
//!
//! `run.sh` and `process_date.sh` now pass `--market-data-path` /
//! `--dividend-data-path` through to the binary, so an unset root must stop the
//! run *before* anything is built or written. These tests execute the real
//! scripts with both variables removed from the child environment and assert on
//! observable behaviour — a non-zero exit and a message naming both variables
//! and the expected on-disk layout.

use std::process::Command;

/// Runs `script` under bash with both data-root variables removed, from the
/// repository root, and returns `(success, combined output)`.
fn run_script_without_roots(script: &str, args: &[&str]) -> (bool, String) {
    let repo_root = env!("CARGO_MANIFEST_DIR");
    let output = Command::new("bash")
        .arg(script)
        .args(args)
        .current_dir(repo_root)
        .env_remove("GRQ_MARKET_DATA_PATH")
        .env_remove("GRQ_DIVIDEND_DATA_PATH")
        .output()
        .unwrap_or_else(|error| panic!("run {script}: {error}"));

    let mut combined = String::from_utf8_lossy(&output.stdout).into_owned();
    combined.push_str(&String::from_utf8_lossy(&output.stderr));
    (output.status.success(), combined)
}

/// Asserts the shared fail-loud guidance: both variable names and the layout.
fn assert_names_both_roots_and_layout(script: &str, message: &str) {
    for expected in [
        "GRQ_MARKET_DATA_PATH",
        "GRQ_DIVIDEND_DATA_PATH",
        "data/<UPPERCASE-FIRST-LETTER>/<SYMBOL>.json",
    ] {
        assert!(
            message.contains(expected),
            "{script} must name {expected} when a data root is unset, got:\n{message}"
        );
    }
}

#[test]
fn run_sh_fails_loudly_without_data_roots() {
    let (success, message) = run_script_without_roots("run.sh", &[]);

    assert!(
        !success,
        "run.sh must exit non-zero without data roots, got:\n{message}"
    );
    assert_names_both_roots_and_layout("run.sh", &message);
}

#[test]
fn process_date_sh_fails_loudly_without_data_roots() {
    let (success, message) = run_script_without_roots("process_date.sh", &["2025-06-05"]);

    assert!(
        !success,
        "process_date.sh must exit non-zero without data roots, got:\n{message}"
    );
    assert_names_both_roots_and_layout("process_date.sh", &message);
    assert!(
        !message.contains("Building project"),
        "the guard must run before the build, got:\n{message}"
    );
}
