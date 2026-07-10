// Tests for a self-describing repository root (Issue #78) and a pruned
// docs/fixes/ learnings store (Issue #759).
//
// Historical "fix note" Markdown files and one-off test/debug scripts used to
// accumulate at the repository root, burying the genuine entry points
// (README.md, Cargo.toml, LICENSE, SECURITY.md). #78 moved the fix-notes under
// docs/fixes/ and the stray scripts under scripts/debug/, and asserts none of
// them remain at the root.
//
// #759 then pruned docs/fixes/ itself: it was a second, drifting learnings
// store maintained in parallel with the README and the docs/archive/
// pr-summaries archive. Every stale/redundant fix log has been removed after
// confirming its durable learning is captured in the README or an existing
// pr-summary. Only CI_CD_SETUP.md is retained, because the root README links it
// twice. These tests assert that layout: no fix-note at the root, the pruned
// notes gone from docs/fixes/ too, and CI_CD_SETUP.md still present.

import { assert } from "@std/assert";

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return false;
    throw err;
  }
}

// The single fix-note retained under docs/fixes/ — the root README links it
// twice (Setup + Support), so it must stay reachable at that path (#759).
const RETAINED_FIX_NOTES = [
  "CI_CD_SETUP.md",
];

// Fix-note / summary Markdown files pruned by #759. Each was either stale
// (documented removed proxies/workflows) or a duplicate learnings store; its
// durable learning now lives in the README or a docs/archive pr-summary. They
// must not remain at the repository root (#78) and must not linger under
// docs/fixes/ (#759).
const PRUNED_FIX_NOTES = [
  "CARGO_AUDIT_FIX.md",
  "CLIPPY_FIXES.md",
  "CONFIDENCE_THRESHOLD_FIX.md",
  "CORS_PROXY_ISSUE_FIX.md",
  "DEPRECATED_ACTIONS_FIX.md",
  "fix_summary.md",
  "AUTO_FORMAT_WORKFLOW.md",
  "ANNUALIZED_PERFORMANCE_CALCULATION.md",
  "TEST_CASES_SUMMARY.md",
  "freshness-indicator-sign-investigation.md",
  "klac-split-distortion-investigation.md",
  "POPOVER_AUTO_DISMISS_FIX.md",
];

// Every fix note, retained or pruned, must be gone from the repository root.
const FIX_NOTES = [...RETAINED_FIX_NOTES, ...PRUNED_FIX_NOTES];

// Stray test/debug scripts that must move into scripts/debug/.
//
// Note (Issue #83): test_formula_verification.js used to live here, but it was
// an assertion-free demo that re-implemented the annualised formula and always
// printed success. It has been deleted — the formula's production home is the
// Rust calculate_annualized_performance (WHAT-tested in src/utils.rs), so the
// demo verified nothing while duplicating the formula. See the deletion
// regression test below.
//
// Note (Issue #85): test_feb15.rs was the Rust twin of the above — a scratch
// fn main() that called calculate_portfolio_performance, printed the result and
// asserted nothing (the Err arm still returned Ok). It has been deleted too;
// calculate_portfolio_performance is WHAT-tested under tests/, so the demo
// verified nothing while keeping a second untested invocation path.
const DEBUG_SCRIPTS = [
  "test_page_load.ts",
  "debug_schw_current_price.ts",
  "check_syntax.ts",
];

// Deleted demo scripts that must not reappear at the root or under scripts/debug/.
const DELETED_DEBUG_SCRIPTS = [
  "test_formula_verification.js",
  "test_feb15.rs",
];

Deno.test("fix-note docs are removed from the repository root", async () => {
  for (const name of FIX_NOTES) {
    assert(
      !(await exists(name)),
      `${name} must not remain at the repository root`,
    );
  }
});

Deno.test("retained fix-note docs live under docs/fixes/ (#759)", async () => {
  for (const name of RETAINED_FIX_NOTES) {
    assert(
      await exists(`docs/fixes/${name}`),
      `docs/fixes/${name} must exist (README links it)`,
    );
  }
});

Deno.test("pruned fix-note docs are removed from docs/fixes/ (#759)", async () => {
  for (const name of PRUNED_FIX_NOTES) {
    assert(
      !(await exists(`docs/fixes/${name}`)),
      `docs/fixes/${name} must be pruned — its durable learning belongs in ` +
        `the README or a docs/archive pr-summary, not a parallel fix log`,
    );
  }
});

Deno.test("stray test/debug scripts are removed from the repository root", async () => {
  for (const name of DEBUG_SCRIPTS) {
    assert(
      !(await exists(name)),
      `${name} must not remain at the repository root`,
    );
  }
});

Deno.test("stray test/debug scripts live under scripts/debug/", async () => {
  for (const name of DEBUG_SCRIPTS) {
    assert(
      await exists(`scripts/debug/${name}`),
      `scripts/debug/${name} must exist`,
    );
  }
});

Deno.test("assertion-free demo scripts are deleted (issues #83, #85)", async () => {
  for (const name of DELETED_DEBUG_SCRIPTS) {
    assert(
      !(await exists(name)),
      `${name} must not exist at the repository root`,
    );
    assert(
      !(await exists(`scripts/debug/${name}`)),
      `scripts/debug/${name} must be deleted, not retained as a false-green test`,
    );
  }
});
