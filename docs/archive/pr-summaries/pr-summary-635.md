## Summary

Added unit tests for the previously untested exported function `diffUses`
(`helpers/bump_quarantine_gate.ts:193`), the GitHub Actions analog of the
already-tested `diffCargoLock`. The function parses `uses:` action refs from
two workflow-file snapshots and emits a `Bump[]` for each newly-added or
re-pinned action. It was reached only through untested I/O glue
(`collectBumps`), leaving its classification logic without a safety net while
the parallel Cargo path was well covered. No production code changed — this is
a test-only gap fix. Closes #635.

## Evidence

Backend/CLI change with no web interface — verified via the test suite. All
three new cases assert on the observable `Bump[]` return value, not internals:

- `diffUses reports re-pinned and newly-added actions` — a re-pin (different
  SHA) and a brand-new action are both reported; an unchanged action is not;
  ecosystem is `github-actions`.
- `diffUses reports nothing when the workflows are unchanged` — empty `Bump[]`.
- `diffUses reports every action as new against an empty old snapshot` — every
  `uses:` ref counts as a new bump with `publishedAt: null`.

```
deno test tests/bump_quarantine_gate_test.ts
ok | 22 passed | 0 failed
```

`./quality.sh` passes cleanly.

## Test Plan

- Added three `diffUses` cases to `tests/bump_quarantine_gate_test.ts`
  mirroring the existing `diffCargoLock` coverage (re-pin + add, no-change,
  all-new).
- Imported `diffUses` alongside the existing `diffCargoLock`/`parseUses`
  imports.
