## Summary

Removed the redundant `export` modifier from the `bumpVersionFiles` function in
`scripts/bump_version.ts`, narrowing it to a file-local function. The symbol is
still live code — it is called internally by the CLI `main` flow — but no other
module in the repository imports it, so its `export` was dead surface area.
Closes #631.

A whole-repo `.ts` token sweep confirmed the only references are the declaration
and one internal call site:

```
scripts/bump_version.ts:136:async function bumpVersionFiles(
scripts/bump_version.ts:190:  const result = await bumpVersionFiles(docsDir, baseVersion);
```

No barrel/`mod.ts` re-exports it, `deno.json` declares no `exports` map, and no
dynamic/reflective access was found, so dropping the `export` cannot break any
in-repo or downstream importer.

## Evidence

Backend/CLI change with no web interface to screenshot. Verified via the repo
quality gate (`./quality.sh`), which runs `deno lint`, `deno check`, and the full
test suite — all passed cleanly. The existing tests in
`tests/bump_version_test.ts` exercise the pure helper `bumpVersionContents`
(which `bumpVersionFiles` wraps) and continue to pass, confirming behaviour is
unchanged.

No new test was added: the change only removes an `export` modifier with no
behavioural effect, and the only way to "test" an export's absence is to grep
source text, which the testing guidelines explicitly forbid. The CLI flow that
uses `bumpVersionFiles` internally remains covered by
`tests/version_bump_workflow_test.ts`.

## Test Plan

- `./quality.sh` — lint, type-check, and full test suite pass.
- `tests/bump_version_test.ts` — existing coverage of `bumpVersionContents` and
  the pure helpers, unchanged and passing.
- `tests/version_bump_workflow_test.ts` — existing subprocess coverage of the
  CLI `main` flow that calls `bumpVersionFiles`, unchanged and passing.
