//! Tests for the CLI-flag cleanup in issue #99.
//!
//! Two pieces of dead code were removed from `src/main.rs`:
//!   1. The `--performance-only` flag, which was parsed but never read.
//!   2. The unreachable second `if args.calculate_performance { … }` block,
//!      dominated by an earlier early-return on the same condition.
//!
//! These tests exercise the real binary end-to-end and assert on observable
//! behaviour (accepted/rejected flags and exit codes), not implementation.

use std::process::Command;

/// Run the binary with the given arguments and capture its output.
fn run_with_args(extra: &[&str]) -> std::process::Output {
    let docs_dir = tempfile::tempdir().expect("create temp docs dir");
    let mut args = vec!["--docs-path", docs_dir.path().to_str().unwrap()];
    args.extend_from_slice(extra);
    Command::new(env!("CARGO_BIN_EXE_grq-validation"))
        .args(&args)
        .output()
        .expect("run grq-validation binary")
}

#[test]
fn performance_only_flag_is_no_longer_accepted() {
    // The removed `--performance-only` flag must now be rejected by clap as an
    // unknown argument, rather than silently accepted and ignored.
    let output = run_with_args(&["--performance-only"]);
    let stderr = String::from_utf8_lossy(&output.stderr);

    assert!(
        !output.status.success(),
        "expected non-zero exit for removed flag, stderr: {stderr}"
    );
    assert!(
        stderr.contains("unexpected argument") || stderr.contains("--performance-only"),
        "expected an unknown-argument error mentioning the removed flag, stderr: {stderr}"
    );
}

#[test]
fn calculate_performance_flag_is_still_accepted() {
    // The retained `--calculate-performance` flag must still be parsed. With an
    // empty docs directory the binary takes the early-return performance branch
    // and exits successfully (it logs a failure but does not error out).
    let output = run_with_args(&["--calculate-performance"]);
    let stderr = String::from_utf8_lossy(&output.stderr);

    assert!(
        output.status.success(),
        "expected --calculate-performance to be accepted, stderr: {stderr}"
    );
    // The unreachable second block's messages must never appear: that branch
    // only ran when the flag was false, which the early return makes impossible.
    assert!(
        !stderr.contains("no longer needed for normal operation"),
        "unreachable calculate-performance block should be gone, stderr: {stderr}"
    );
}
