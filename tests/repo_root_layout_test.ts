// Tests for a self-describing repository root (Issue #78).
//
// Historical "fix note" Markdown files and one-off test/debug scripts used to
// accumulate at the repository root, burying the genuine entry points
// (README.md, Cargo.toml, LICENSE, SECURITY.md). These tests assert that the
// fix-notes now live under docs/fixes/ and the stray scripts under
// scripts/debug/, and that none of them remain at the root.

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

// Fix-note / summary Markdown files that must move into docs/fixes/.
const FIX_NOTES = [
  "CARGO_AUDIT_FIX.md",
  "CLIPPY_FIXES.md",
  "CONFIDENCE_THRESHOLD_FIX.md",
  "CORS_PROXY_ISSUE_FIX.md",
  "DEPRECATED_ACTIONS_FIX.md",
  "fix_summary.md",
  "AUTO_FORMAT_WORKFLOW.md",
  "CI_CD_SETUP.md",
  "ANNUALIZED_PERFORMANCE_CALCULATION.md",
  "TEST_CASES_SUMMARY.md",
];

// Stray test/debug scripts that must move into scripts/debug/.
//
// Note (Issue #83): test_formula_verification.js used to live here, but it was
// an assertion-free demo that re-implemented the annualised formula and always
// printed success. It has been deleted — the formula's production home is the
// Rust calculate_annualized_performance (WHAT-tested in src/utils.rs), so the
// demo verified nothing while duplicating the formula. See the deletion
// regression test below.
const DEBUG_SCRIPTS = [
  "test_feb15.rs",
  "test_page_load.ts",
  "debug_schw_current_price.ts",
  "check_syntax.ts",
];

// The deleted demo script must not reappear at the root or under scripts/debug/.
const DELETED_DEBUG_SCRIPTS = [
  "test_formula_verification.js",
];

Deno.test("fix-note docs are removed from the repository root", async () => {
  for (const name of FIX_NOTES) {
    assert(
      !(await exists(name)),
      `${name} must not remain at the repository root`,
    );
  }
});

Deno.test("fix-note docs live under docs/fixes/", async () => {
  for (const name of FIX_NOTES) {
    assert(
      await exists(`docs/fixes/${name}`),
      `docs/fixes/${name} must exist`,
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

Deno.test("assertion-free formula-verification demo is deleted (issue #83)", async () => {
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
