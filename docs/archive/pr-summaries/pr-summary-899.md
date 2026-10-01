# PR Summary — Issue #899: drop orphaned `npm:@playwright/mcp` from `deno.lock`

Closes #899

## Summary

`deno.lock` still pinned `npm:@playwright/mcp@0.0.75` and its chain (`playwright` → `playwright-core` → optional `fsevents@2.3.2`), although nothing in `deno.json` or the code imports it. Deno therefore resolved and downloaded the three packages on every run, and on macOS printed `Ignored build scripts for packages: npm:fsevents@2.3.2` from `deno task refresh-indices`. This PR deletes the orphaned specifier and the whole `npm` section, which held only these four packages. Nothing else in the lock changes.

- [x] Prune the orphaned specifier and `npm` section from `deno.lock`
- [x] Verify `deno install --frozen` / `deno check --frozen` against the pruned lock
- [x] Quality gate run (see Test Plan)

## Spec

### Intent and Rationale

- Stop Deno resolving and downloading an npm package tree that nothing uses, which removes the fsevents build-script warning at its source.

### Essential Design Decisions

- Pruned only the stale entries rather than regenerating the whole lock, so the jsr and `remote` pins stay byte-identical.
- No `"nodeModulesDir": "auto"`, no `package.json`, no `node_modules/`. Silencing the warning that way would keep the unused dependency.

### Undiscoverable Facts

- The entry was most likely left by an ad-hoc `deno run npm:@playwright/mcp` (the Playwright MCP server) that wrote into the repo's lock. No tracked file imports it: the only "playwright" mentions are comments in `scripts/gen_issue_*_evidence.ts`.
- `fsevents` is darwin-only, so the warning never appears on Linux. The downloads below are the platform-neutral symptom.

## Evidence

`deno install --frozen` with a fresh `DENO_DIR`, run against the base lock and then the pruned one (output filtered to npm/warning lines):

```text
== before
Download https://registry.npmjs.org/@playwright/mcp/-/mcp-0.0.75.tgz
Download https://registry.npmjs.org/playwright/-/playwright-1.61.0-alpha-1778188671000.tgz
Download https://registry.npmjs.org/playwright-core/-/playwright-core-1.61.0-alpha-1778188671000.tgz
Downloaded 3 packages from npm
+ npm:@playwright/mcp 0.0.75
== after
Downloaded 0 packages from npm
```

Lock diff: `deno.lock | 32 +-------` (1 insertion, the trailing comma fix, and 31 deletions). After the install, `deno.lock` is unchanged and no `node_modules/` exists.

## Test Plan

- `deno check --frozen scripts/*.ts tests/*.ts`: passes.
- `deno install --frozen`: no npm downloads, no build-script warning, lock untouched.
- `./quality.sh`: 1698 passed, 2 failed. Both failures are the committed-tree market-data gates (`market_data_presence_test.ts`, `score_data_pairing_test.ts`). They report `docs/scores/2026/August/30.csv`, `31.csv` and `September/01.csv` missing, and already fail on `main`, as `deno task check-score-data` showed before this change. That is the root cause tracked by #896, which needs the private market-data host to backfill, and it is unrelated to the lock.

## Deno regression avoided

- Fixed by pruning the Deno lock; did not add `nodeModulesDir`, `package.json` or `node_modules/` to silence the warning.
