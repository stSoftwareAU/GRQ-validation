//! Tests for the CLI-flag cleanup in issue #99, and for the caller-supplied
//! data-root flags added in issue #803.
//!
//! Two pieces of dead code were removed from `src/main.rs`:
//!   1. The `--performance-only` flag, which was parsed but never read.
//!   2. The unreachable second `if args.calculate_performance { … }` block,
//!      dominated by an earlier early-return on the same condition.
//!
//! These tests exercise the real binary end-to-end and assert on observable
//! behaviour (accepted/rejected flags and exit codes), not implementation.
//!
//! Issue #803 made both data roots caller-supplied, so every invocation below
//! passes `--market-data-path`/`--dividend-data-path` at temporary directories
//! (the pre-existing tests were updated for that new start-up contract) and the
//! child environment is cleared of both variables so the assertions never
//! depend on the developer's or runner's configuration.

use std::path::Path;
use std::process::Command;

const MARKET_DATA_ROOT_ENV: &str = "GRQ_MARKET_DATA_PATH";
const DIVIDEND_DATA_ROOT_ENV: &str = "GRQ_DIVIDEND_DATA_PATH";

/// Builds a command with both data-root environment variables removed, so a
/// test controls resolution entirely through flags and explicit `env` calls.
fn binary() -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_grq-validation"));
    command
        .env_remove(MARKET_DATA_ROOT_ENV)
        .env_remove(DIVIDEND_DATA_ROOT_ENV);
    command
}

/// Creates a usable market-data root (an empty `data/` tree) inside `base`.
fn market_root_in(base: &Path) -> std::path::PathBuf {
    let root = base.join("market-data");
    std::fs::create_dir_all(root.join("data")).expect("create market data tree");
    root
}

/// Creates a usable dividend-data root inside `base`.
fn dividend_root_in(base: &Path) -> std::path::PathBuf {
    let root = base.join("dividend-data");
    std::fs::create_dir_all(root.join("data")).expect("create dividend data tree");
    root
}

/// Run the binary with the given arguments and capture its output. Both data
/// roots are supplied as flags pointing at temporary trees.
fn run_with_args(extra: &[&str]) -> std::process::Output {
    let docs_dir = tempfile::tempdir().expect("create temp docs dir");
    let roots_dir = tempfile::tempdir().expect("create temp roots dir");
    let market = market_root_in(roots_dir.path());
    let dividends = dividend_root_in(roots_dir.path());

    let mut args = vec![
        "--docs-path",
        docs_dir.path().to_str().unwrap(),
        "--market-data-path",
        market.to_str().unwrap(),
        "--dividend-data-path",
        dividends.to_str().unwrap(),
    ];
    args.extend_from_slice(extra);
    binary()
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

// --- Caller-supplied data roots (issue #803) ---

#[test]
fn help_documents_both_data_root_flags_and_their_env_vars() {
    let output = binary().arg("--help").output().expect("run --help");
    let help = String::from_utf8_lossy(&output.stdout);

    assert!(output.status.success(), "--help must exit zero: {help}");
    for expected in [
        "--market-data-path",
        "--dividend-data-path",
        MARKET_DATA_ROOT_ENV,
        DIVIDEND_DATA_ROOT_ENV,
    ] {
        assert!(
            help.contains(expected),
            "--help must document {expected}, got:\n{help}"
        );
    }
}

#[test]
fn missing_data_roots_fails_at_startup_listing_both() {
    // Neither flag nor environment variable: the run must stop before any work,
    // naming both variables in a single actionable message.
    let docs_dir = tempfile::tempdir().expect("create temp docs dir");
    let output = binary()
        .args(["--docs-path", docs_dir.path().to_str().unwrap()])
        .output()
        .expect("run grq-validation binary");
    let stderr = String::from_utf8_lossy(&output.stderr);

    assert!(
        !output.status.success(),
        "expected a non-zero exit with no data roots, stderr: {stderr}"
    );
    assert!(
        stderr.contains(MARKET_DATA_ROOT_ENV) && stderr.contains(DIVIDEND_DATA_ROOT_ENV),
        "the start-up error must name both variables, stderr: {stderr}"
    );
    assert!(
        stderr.contains("data/<UPPERCASE-FIRST-LETTER>/<SYMBOL>.json")
            || stderr.contains("data/<letter>/<SYM>.json"),
        "the start-up error must describe the expected layout, stderr: {stderr}"
    );
}

#[test]
fn missing_data_roots_writes_no_partial_csv() {
    // The start-up guard runs before any score file is touched, so a run
    // without roots leaves the docs tree exactly as it found it.
    let docs_dir = tempfile::tempdir().expect("create temp docs dir");
    let scores = docs_dir.path().join("scores/2025/June");
    std::fs::create_dir_all(&scores).expect("create score dir");
    std::fs::write(scores.join("20.tsv"), "Stock\tScore\n").expect("write score file");

    let output = binary()
        .args(["--docs-path", docs_dir.path().to_str().unwrap()])
        .output()
        .expect("run grq-validation binary");

    assert!(!output.status.success(), "expected a non-zero exit");
    assert!(
        !scores.join("20.csv").exists() && !scores.join("20-dividends.csv").exists(),
        "no CSV may be written when the data roots are unusable"
    );
}

#[test]
fn market_data_path_flag_overrides_env() {
    // The environment names a usable root while the flag names a directory that
    // does not exist. The flag must win, so the run fails naming the flag's
    // path — proving the environment value was not silently preferred.
    let roots_dir = tempfile::tempdir().expect("create temp roots dir");
    let docs_dir = tempfile::tempdir().expect("create temp docs dir");
    let env_market = market_root_in(roots_dir.path());
    let dividends = dividend_root_in(roots_dir.path());
    let flag_market = roots_dir.path().join("flag-market-data");

    let output = binary()
        .env(MARKET_DATA_ROOT_ENV, &env_market)
        .env(DIVIDEND_DATA_ROOT_ENV, &dividends)
        .args([
            "--docs-path",
            docs_dir.path().to_str().unwrap(),
            "--market-data-path",
            flag_market.to_str().unwrap(),
        ])
        .output()
        .expect("run grq-validation binary");
    let stderr = String::from_utf8_lossy(&output.stderr);

    assert!(
        !output.status.success(),
        "the flag's non-existent root must fail the run, stderr: {stderr}"
    );
    assert!(
        stderr.contains(&flag_market.display().to_string()),
        "the error must name the flag's root, stderr: {stderr}"
    );
    assert!(
        !stderr.contains(&format!("  - {}", env_market.display())),
        "the environment's root must not be reported as the problem, stderr: {stderr}"
    );
}

#[test]
fn environment_supplies_the_roots_when_no_flag_is_given() {
    // The converse of the precedence test: with no flags, the variables are the
    // fallback and a run against an empty docs tree starts successfully.
    let roots_dir = tempfile::tempdir().expect("create temp roots dir");
    let docs_dir = tempfile::tempdir().expect("create temp docs dir");
    let market = market_root_in(roots_dir.path());
    let dividends = dividend_root_in(roots_dir.path());
    std::fs::write(
        docs_dir.path().join("scores-index-placeholder"),
        "not an index",
    )
    .expect("write placeholder");

    let output = binary()
        .env(MARKET_DATA_ROOT_ENV, &market)
        .env(DIVIDEND_DATA_ROOT_ENV, &dividends)
        .args([
            "--docs-path",
            docs_dir.path().to_str().unwrap(),
            "--calculate-performance",
        ])
        .output()
        .expect("run grq-validation binary");
    let stderr = String::from_utf8_lossy(&output.stderr);

    assert!(
        output.status.success(),
        "environment-supplied roots must satisfy the start-up guard, stderr: {stderr}"
    );
    assert!(
        !stderr.contains("cannot start"),
        "no start-up failure expected, stderr: {stderr}"
    );
}
