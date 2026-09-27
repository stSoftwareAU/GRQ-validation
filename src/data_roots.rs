//! The caller-supplied data roots, resolved once at start-up (issue #803).
//!
//! The pipeline reads share prices and dividend history from two directories
//! the *caller* supplies — this repository ships no such data. `main` resolves
//! both roots exactly once into a [`crate::data_roots::DataRoots`] value and
//! threads it into every pipeline entry point, so no function deep in the run
//! re-reads the environment or invents a fallback path.
//!
//! Resolution order per root: the CLI flag wins over the environment variable,
//! and there is deliberately no default. Both roots are validated before any
//! work begins, and a single error lists *every* unusable root, so an operator
//! fixes the whole configuration in one pass instead of one failure per run.

use anyhow::{anyhow, Result};
use std::path::{Path, PathBuf};

/// Environment variable naming the market-data root directory.
pub const MARKET_DATA_ROOT_ENV: &str = "GRQ_MARKET_DATA_PATH";

/// Environment variable naming the dividend-data root directory.
pub const DIVIDEND_DATA_ROOT_ENV: &str = "GRQ_DIVIDEND_DATA_PATH";

/// Resolves a caller-supplied data root from `raw`, the value of `variable`.
///
/// Injectable core of [`market_data_root`]/[`dividend_data_root`] so the
/// fail-loud contract is testable without mutating the process environment —
/// the unit tests run in parallel and many of them read these variables, so a
/// scoped `set_var`/`remove_var` would race with those readers.
///
/// # Errors
///
/// Returns an error naming only `variable` and the expected tree shape when the
/// value is absent or blank. There is deliberately no default: a silent
/// fallback would let the pipeline produce header-only CSVs instead of failing.
pub(crate) fn data_root_from_value(
    variable: &str,
    kind: &str,
    raw: Option<String>,
) -> Result<PathBuf> {
    match raw {
        Some(value) if !value.trim().is_empty() => Ok(PathBuf::from(value)),
        _ => Err(anyhow!(
            "{variable} is not set — set it to the directory holding the {kind} \
             `data/<letter>/<SYM>.json` tree"
        )),
    }
}

/// Reads `variable` from the process environment.
///
/// This is the crate's single environment read site for the data roots (issue
/// #803): every other function takes an already-resolved root as a parameter,
/// so a root can never be silently re-resolved deep in a run.
pub(crate) fn env_root(variable: &str) -> Option<String> {
    std::env::var(variable).ok()
}

/// Resolves the market-data root from the `GRQ_MARKET_DATA_PATH` environment
/// variable.
///
/// Used by [`crate::data_roots::DataRoots::resolve`] as the fallback behind
/// `--market-data-path`, and by tests that need the operator's own tree.
///
/// # Errors
///
/// Returns an error when the variable is unset or blank.
pub fn market_data_root() -> Result<PathBuf> {
    data_root_from_value(
        MARKET_DATA_ROOT_ENV,
        "market-data",
        env_root(MARKET_DATA_ROOT_ENV),
    )
}

/// Resolves the dividend-data root from the `GRQ_DIVIDEND_DATA_PATH`
/// environment variable.
///
/// Used by [`crate::data_roots::DataRoots::resolve`] as the fallback behind
/// `--dividend-data-path`, and by tests that need the operator's own tree.
///
/// # Errors
///
/// Returns an error when the variable is unset or blank.
pub fn dividend_data_root() -> Result<PathBuf> {
    data_root_from_value(
        DIVIDEND_DATA_ROOT_ENV,
        "dividend-data",
        env_root(DIVIDEND_DATA_ROOT_ENV),
    )
}

/// Returns `true` when a share-price data repository exists at `base` (i.e. it
/// contains a `data/` subdirectory). Best-effort probe;
/// [`ensure_market_data_repository_at`] is the fail-loud gate every batch entry
/// point calls instead.
fn market_data_repository_available_at(base: &Path) -> bool {
    base.join("data").is_dir()
}

/// Ensures a share-price data repository is present at the caller-supplied
/// `base` before batch processing (issue #803: the root is threaded in, never
/// re-resolved here).
///
/// # Errors
///
/// Returns an error when `base`/`data` is missing.
pub fn ensure_market_data_repository_at(base: &Path) -> Result<()> {
    if market_data_repository_available_at(base) {
        Ok(())
    } else {
        Err(anyhow!(
            "Market data repository not found at {}/data — \
             point {MARKET_DATA_ROOT_ENV} at a directory holding a \
             `data/<letter>/<SYM>.json` tree",
            base.display()
        ))
    }
}

/// Shared data-root fixtures for the unit tests of the modules split out of
/// `utils` (issue #882).
#[cfg(test)]
pub(crate) mod test_fixtures {
    use super::*;

    /// A caller-supplied root that deliberately holds no data (issue #803).
    ///
    /// Used by the traversal-guard tests (which must fail before touching disk)
    /// and by the projection/performance tests, which assert on price behaviour
    /// only: an absent dividend tree contributes exactly zero dividends, so the
    /// expected figures stay independent of any operator's data.
    pub(crate) fn absent_data_root() -> &'static Path {
        Path::new("target/test-fixtures/absent-data-root")
    }

    /// The operator's market-data root when one is configured *and* present on
    /// disk, else `None` after printing why `test` is being skipped. Smoke
    /// tests against real share prices can only run where that tree exists.
    pub(crate) fn configured_market_root(test: &str) -> Option<PathBuf> {
        match market_data_root() {
            Ok(root) if root.exists() => Some(root),
            _ => {
                println!("Skipping {test}: external data repository not available");
                None
            }
        }
    }
}

/// The two caller-supplied data roots, resolved and validated once at start-up.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DataRoots {
    /// Directory holding the market-data `data/<letter>/<SYM>.json` tree.
    pub market: PathBuf,
    /// Directory holding the dividend-history `data/<letter>/<SYM>.json` tree.
    pub dividends: PathBuf,
}

impl DataRoots {
    /// Resolves both roots from the CLI flags, falling back to the environment
    /// variables, and validates that each names an existing directory.
    ///
    /// # Errors
    ///
    /// Returns one error listing *every* root that is unset, blank, or not a
    /// directory, naming the variable and the flag an operator should set.
    pub fn resolve(market_flag: Option<&str>, dividend_flag: Option<&str>) -> Result<Self> {
        let market = resolve_root(MARKET_DATA_ROOT_ENV, "market-data", market_flag);
        let dividends = resolve_root(DIVIDEND_DATA_ROOT_ENV, "dividend-data", dividend_flag);

        match (market, dividends) {
            (Ok(market), Ok(dividends)) => Ok(Self { market, dividends }),
            (market, dividends) => Err(combined_error([market.err(), dividends.err()])),
        }
    }

    /// Resolves the market-data root alone, for the entry points that read no
    /// dividend history at all — the pick-details backfill (issue #839).
    /// Demanding a dividend root such a run would never open would fail an
    /// operator for a configuration the work does not need.
    ///
    /// # Errors
    ///
    /// Returns an error if the root is unset, blank, or not a directory.
    pub fn resolve_market(market_flag: Option<&str>) -> Result<PathBuf> {
        resolve_root(MARKET_DATA_ROOT_ENV, "market-data", market_flag)
    }
}

/// Resolves a single root: the flag wins over the environment variable, and the
/// result must name an existing directory.
fn resolve_root(variable: &str, kind: &str, flag: Option<&str>) -> Result<PathBuf> {
    let raw = flag.map(str::to_owned).or_else(|| env_root(variable));
    let root = data_root_from_value(variable, kind, raw)?;

    if root.is_dir() {
        Ok(root)
    } else {
        Err(anyhow!(
            "{variable} points at {root} which is not a directory — set it to the \
             directory holding the {kind} `data/<letter>/<SYM>.json` tree",
            root = root.display()
        ))
    }
}

/// Folds the per-root failures into one actionable start-up error.
fn combined_error(problems: [Option<anyhow::Error>; 2]) -> anyhow::Error {
    let listed = problems
        .into_iter()
        .flatten()
        .map(|problem| format!("  - {problem}"))
        .collect::<Vec<_>>()
        .join("\n");

    anyhow!(
        "cannot start: caller-supplied data root(s) unusable:\n{listed}\n\
         Pass --market-data-path/--dividend-data-path, or set \
         {MARKET_DATA_ROOT_ENV}/{DIVIDEND_DATA_ROOT_ENV}. This repository ships \
         no market or dividend data: point each root at your own directory \
         holding a `data/<UPPERCASE-FIRST-LETTER>/<SYMBOL>.json` tree."
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_accepts_existing_directories_from_flags() {
        let market = tempfile::tempdir().unwrap();
        let dividends = tempfile::tempdir().unwrap();

        let roots = DataRoots::resolve(
            Some(market.path().to_str().unwrap()),
            Some(dividends.path().to_str().unwrap()),
        )
        .expect("existing directories must resolve");

        assert_eq!(roots.market, market.path());
        assert_eq!(roots.dividends, dividends.path());
    }

    #[test]
    fn resolve_lists_every_unusable_root_in_one_error() {
        // Both flags are supplied (so the environment is never consulted) and
        // both point at directories that do not exist.
        let missing = tempfile::tempdir().unwrap();
        let absent_market = missing.path().join("no-market-tree");
        let absent_dividends = missing.path().join("no-dividend-tree");

        let error = DataRoots::resolve(
            Some(absent_market.to_str().unwrap()),
            Some(absent_dividends.to_str().unwrap()),
        )
        .expect_err("non-existent roots must fail at start-up");
        let message = error.to_string();

        assert!(
            message.contains(MARKET_DATA_ROOT_ENV) && message.contains(DIVIDEND_DATA_ROOT_ENV),
            "the start-up error must name both variables, got: {message}"
        );
        assert!(
            message.contains(&absent_market.display().to_string())
                && message.contains(&absent_dividends.display().to_string()),
            "the start-up error must list both offending paths, got: {message}"
        );
    }

    #[test]
    fn resolve_reports_only_the_broken_root() {
        let market = tempfile::tempdir().unwrap();
        let absent_dividends = market.path().join("no-dividend-tree");

        let error = DataRoots::resolve(
            Some(market.path().to_str().unwrap()),
            Some(absent_dividends.to_str().unwrap()),
        )
        .expect_err("a single broken root must still fail");
        let message = error.to_string();

        assert!(
            message.contains(&absent_dividends.display().to_string()),
            "the broken root must be listed, got: {message}"
        );
        assert!(
            !message.contains(&format!("  - {}", market.path().display())),
            "the usable root must not be reported as a problem, got: {message}"
        );
    }

    #[test]
    fn resolve_rejects_a_blank_flag_rather_than_falling_back() {
        let dividends = tempfile::tempdir().unwrap();

        let error = DataRoots::resolve(Some("   "), Some(dividends.path().to_str().unwrap()))
            .expect_err("a blank flag is a configuration error, not a fallback");

        assert!(
            error.to_string().contains(MARKET_DATA_ROOT_ENV),
            "a blank market root must be reported, got: {error}"
        );
    }

    #[test]
    fn test_ensure_market_data_repository_ok_when_present() {
        // A base directory containing a `data/` subdir resolves to Ok, covering
        // `market_data_repository_available`'s `true` branch transitively.
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("data")).unwrap();
        assert!(market_data_repository_available_at(dir.path()));
        assert!(ensure_market_data_repository_at(dir.path()).is_ok());
    }

    #[test]
    fn test_ensure_market_data_repository_err_when_absent() {
        // A base directory without a `data/` subdir resolves to a descriptive
        // Err naming the missing repository, covering the `false` branch.
        let dir = tempfile::tempdir().unwrap();
        assert!(!market_data_repository_available_at(dir.path()));
        let err = ensure_market_data_repository_at(dir.path()).unwrap_err();
        let msg = err.to_string();
        let expected = format!("{}/data", dir.path().display());
        assert!(
            msg.contains(&expected),
            "message names the missing data directory {expected}: {msg}"
        );
        assert!(
            msg.contains(MARKET_DATA_ROOT_ENV),
            "message names the environment variable to set: {msg}"
        );
        assert!(
            !msg.contains("GRQ-"),
            "message must not name a private repository: {msg}"
        );
    }

    // Issue #802: the data roots are caller-supplied. An unset or blank root is
    // a fail-loud error naming only the environment variable — never a silent
    // default, which is what produced header-only market-data CSVs.
    #[test]
    fn test_market_data_root_unset_fails_loud() {
        let err = data_root_from_value(MARKET_DATA_ROOT_ENV, "market-data", None).unwrap_err();
        let msg = err.to_string();
        assert!(
            msg.contains(MARKET_DATA_ROOT_ENV),
            "message names the environment variable: {msg}"
        );
        assert!(
            msg.contains("data/<letter>/<SYM>.json"),
            "message says what the variable must point at: {msg}"
        );
        assert!(
            !msg.contains("GRQ-"),
            "message must not name a private repository: {msg}"
        );

        // A blank value is treated exactly like an unset one.
        assert!(
            data_root_from_value(MARKET_DATA_ROOT_ENV, "market-data", Some("  ".to_string()))
                .is_err(),
            "a blank root must not resolve to the current directory"
        );
    }

    #[test]
    fn test_dividend_data_root_unset_fails_loud() {
        let err = data_root_from_value(DIVIDEND_DATA_ROOT_ENV, "dividend-data", None).unwrap_err();
        let msg = err.to_string();
        assert!(
            msg.contains(DIVIDEND_DATA_ROOT_ENV),
            "message names the environment variable: {msg}"
        );
        assert!(
            msg.contains("data/<letter>/<SYM>.json"),
            "message says what the variable must point at: {msg}"
        );
        assert!(
            !msg.contains("GRQ-"),
            "message must not name a private repository: {msg}"
        );

        assert!(
            data_root_from_value(DIVIDEND_DATA_ROOT_ENV, "dividend-data", Some(String::new()))
                .is_err(),
            "a blank root must not resolve to the current directory"
        );
    }

    #[test]
    fn test_data_root_from_value_returns_caller_supplied_path() {
        let root = data_root_from_value(
            MARKET_DATA_ROOT_ENV,
            "market-data",
            Some("/tmp/md".to_string()),
        )
        .unwrap();
        assert_eq!(root, PathBuf::from("/tmp/md"));
    }

    /// Read-only wiring check: the public resolvers must read their environment
    /// variable and must not fall back to a default when it is absent. Asserted
    /// against whatever the ambient environment holds, so it never mutates
    /// process state that the parallel tests around it read. It goes through
    /// [`env_root`] — the crate's single environment read site (issue #803).
    #[test]
    fn test_data_roots_resolve_from_environment() {
        for (variable, resolved) in [
            (MARKET_DATA_ROOT_ENV, market_data_root()),
            (DIVIDEND_DATA_ROOT_ENV, dividend_data_root()),
        ] {
            match env_root(variable) {
                Some(value) if !value.trim().is_empty() => {
                    assert_eq!(resolved.unwrap(), PathBuf::from(value));
                }
                _ => {
                    let msg = resolved.unwrap_err().to_string();
                    assert!(
                        msg.contains(variable),
                        "unset {variable} must fail loud naming itself, got: {msg}"
                    );
                }
            }
        }
    }
}
