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

use crate::utils::{data_root_from_value, env_root, DIVIDEND_DATA_ROOT_ENV, MARKET_DATA_ROOT_ENV};
use anyhow::{anyhow, Result};
use std::path::PathBuf;

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
}
