# PR Summary — Issue #899: drop orphaned `npm:@playwright/mcp` from `deno.lock`

Superseded. The lock prune landed in #901, and this branch no longer differs
from `main` except for this note.

## Summary

`deno.lock` pinned an orphaned `npm:@playwright/mcp@0.0.75` and its chain
(`playwright` → `playwright-core` → optional `fsevents@2.3.2`), although
nothing in `deno.json` or the code imports it. This branch (PR #904) was
opened to fix that, but PR #901 (`2259a32d`, merged to `main` on 2026-10-01
at 19:59 UTC) pruned the orphaned specifier and the whole `npm` section
first and closed #899. Later merges of `main` into this branch absorbed that
already-pruned lock, so the diff carries no `deno.lock` change.

A later routine version bump on this branch (Cargo `0.1.38` → `0.1.39`,
dashboard `1.1.117` → `1.1.118`) was also superseded. `main` is already at
Cargo `0.1.40` and dashboard `1.1.119`, including the Actionlint fix from
#905. Merging that `main` removed the version-only diff and replaced this
branch's Actionlint workflow, which was failing every run with
`startup_failure` because it still used the refused `docker://` action
(Issue #903).

What #904 contains against current `main` is only this summary file.

## Test Plan

- No `deno.lock` change ships in this PR. See PR #901 for the lock-prune
  evidence.
- No version bump ships in this PR. `Cargo.toml`, `Cargo.lock`, and the
  dashboard cache-busting strings match `main`.
- `.github/workflows/actionlint.yml` matches `main` (the #905 pin), so the
  workflow can start.
