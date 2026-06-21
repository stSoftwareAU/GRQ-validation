## Summary

Made two flag-order-coupled assertions in
`tests/cargo_supply_chain_quarantine_test.ts` order-independent. The tests
previously regexed workflow `run:` text and required `--locked` to appear
*before* `--version`, so a behaviour-preserving flag swap
(`cargo install <tool> --version 0.x --locked`) would turn them red — a
HOW-test coupled to YAML source layout rather than the observable contract.

The assertions now locate the `cargo install <tool>` line and check the flag
set independently: `--locked` present **and** `--version` pinned, in any
order. The genuine supply-chain property (pinned, locked installs) is still
enforced; the source-text ordering coupling is gone. Closes #266.

## Evidence

Backend/test-only change — no web interface to screenshot. Verified via
`deno test` and the full `./quality.sh` gate (passes cleanly).

The new helper checks the *observable* contract rather than text order:

```ts
function assertPinnedInstall(runs, tool, source) {
  const line = installLine(runs, tool);
  assert(line !== "", `${source} must install ${tool}`);
  assert(/\s--locked\b/.test(line), `${source}: ${tool} install must pass --locked`);
  assert(/\s--version\s+\d+\.\d+/.test(line), `${source}: ${tool} install must pin --version`);
}
```

Either flag order now passes; dropping a flag still fails. The sibling
WHAT-tests (`cargo update` absent, `--locked` present) were intentionally left
untouched as already-robust behaviour assertions.

## Test Plan

- Modified `tests/cargo_supply_chain_quarantine_test.ts`:
  - `ci.yml pins cargo tool installs to explicit versions with --locked` — now
    uses order-independent `assertPinnedInstall`.
  - `cargo-audit.yml pins cargo-audit install to an explicit version with
    --locked` — now uses order-independent `assertPinnedInstall`.
- `deno test --allow-read tests/cargo_supply_chain_quarantine_test.ts` →
  6 passed / 0 failed.
- `./quality.sh < /dev/null` → passes cleanly.
