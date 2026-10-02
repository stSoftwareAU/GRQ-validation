# PR Summary — Issue #899: drop orphaned `npm:@playwright/mcp` from `deno.lock`

The lock prune landed in #901. This pull request now carries the routine
version bump on top of current `main`, including the Actionlint fix from #905.

## Summary

`deno.lock` pinned an orphaned `npm:@playwright/mcp@0.0.75` and its chain
(`playwright` → `playwright-core` → optional `fsevents@2.3.2`), although
nothing in `deno.json` or the code imports it. This branch (PR #904) was
opened to fix that, but PR #901 (`2259a32d`, merged to `main` on 2026-10-01
at 19:59 UTC) pruned the orphaned specifier and the whole `npm` section
first and closed #899. Later merges of `main` absorbed that already-pruned
lock, so this diff carries no `deno.lock` change.

Merging current `main` also replaced this branch's Actionlint workflow.
That workflow was failing every run with `startup_failure` because it still
used the refused `docker://` action (Issue #903). `.github/workflows/actionlint.yml`
now matches `main` (the pinned release binary from #905).

What remains against `main` is the routine auto-increment (Issues #323, #818):

- Cargo `0.1.40` → `0.1.41`
- Dashboard `1.1.119` → `1.1.120` (`docs/index.html`, `docs/sw-register.js`,
  `docs/sw.js`, `docs/trend.html`)

## Test Plan

- No `deno.lock` change ships in this PR. See PR #901 for the lock-prune
  evidence.
- `.github/workflows/actionlint.yml` matches `main`, so the workflow can start.
- Version strings are consistent: `Cargo.toml` / `Cargo.lock` at `0.1.41`,
  dashboard cache-busting strings at `1.1.120`.
