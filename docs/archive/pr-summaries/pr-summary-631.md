## Summary

Removed the redundant `export` modifier from `bumpVersionFiles` in
`scripts/bump_version.ts`. The function is a thin I/O wrapper around the pure
`bumpVersionContents` helper and is only used internally by the CLI `main`
flow — no other module in the repository imports it, and the repo declares no
`exports` map or barrel, so the export was dead code. The symbol itself is kept
and remains live as a file-local function. Closes #631.

A whole-repo sweep confirmed `bumpVersionFiles` appears only in its own module
(the declaration plus one internal call site), and no dynamic/reflective access
exists, so narrowing its visibility is safe.

## Evidence

Backend/CLI change with no web interface — no screenshot applicable.

- `deno test --allow-read tests/bump_version_test.ts tests/version_bump_workflow_test.ts` — 16 passed, 0 failed.
- `deno check scripts/bump_version.ts` — clean.
- `deno lint scripts/bump_version.ts` — clean.
- `deno fmt --check scripts/bump_version.ts` — clean.

The existing test suite exercises the pure helpers and the idempotency logic and
continues to pass unchanged, confirming the bump behaviour is unaffected by
narrowing the wrapper's visibility.

## Test Plan

- No new tests required: this change only narrows symbol visibility and does not
  alter runtime behaviour. Writing a test that asserts the absence of an
  `export` keyword would be a source-text grep, which the project guidelines
  forbid.
- Existing coverage in `tests/bump_version_test.ts` (pure helpers and
  `bumpVersionContents`) and `tests/version_bump_workflow_test.ts` (workflow
  wiring) verifies the surrounding behaviour and all pass.
