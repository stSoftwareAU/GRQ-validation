# PR Summary — Issue #899: drop orphaned `npm:@playwright/mcp` from `deno.lock`

Superseded by #901 for the `deno.lock` fix; see below.

## Summary

`deno.lock` pinned an orphaned `npm:@playwright/mcp@0.0.75` and its chain
(`playwright` → `playwright-core` → optional `fsevents@2.3.2`), although
nothing in `deno.json` or the code imports it. This branch (PR #904) was
opened to fix that, but PR #901 (`2259a32d`, merged to `main` on 2026-10-01
at 19:59 UTC) pruned the orphaned specifier and the whole `npm` section
first and closed #899. PR #904 later merged `main` three times (last merge
20:22 UTC, after #901 landed), so `main`'s already-pruned `deno.lock`
replaced this branch's version — the final diff against `main` carries no
`deno.lock` change.

What #904 actually contains against `main` is only the routine
auto-increment version bump (Cargo `0.1.38` → `0.1.39`, dashboard
`1.1.117` → `1.1.118`, consistent across `docs/index.html`,
`docs/sw-register.js`, `docs/sw.js`, `docs/trend.html`) plus this summary
file.

## Test Plan

- No `deno.lock` change ships in this PR, so the before/after npm-download
  evidence and lock-diff numbers from the earlier iteration of this branch
  no longer apply here and have been removed. See PR #901 for that
  evidence.
- `./quality.sh`: run against the version-bump-only diff; no new failures
  introduced by this PR beyond the pre-existing #896 market-data gates.
