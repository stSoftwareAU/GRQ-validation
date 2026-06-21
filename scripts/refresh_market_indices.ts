#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write
//
// Daily lockstep wrapper for the benchmark indices (issue #238).
//
// The external "scorer" job (stSoftwareAU/GRQ, worker/score.sh) checks out this
// repo and, once a day, commits new docs/scores/... and docs/USDAUD.json with a
// message like "Add scores for 2026-06-20". Before #238 the benchmark indices
// (docs/market-indices.json) were not part of that job, so they drifted days
// behind the actuals.
//
// This wrapper is the stable entry point the scorer invokes immediately before
// that commit, so the indices reach the last trading day in lockstep with the
// scores + USDAUD:
//
//   deno run --allow-net --allow-read --allow-write scripts/refresh_market_indices.ts
//   (or the deno task form: deno task refresh-indices)
//
// Contract: it MUST NOT block the scores/USDAUD commit. A Yahoo Finance outage
// or partial fetch is logged and swallowed — the process still exits 0, and the
// safe-write guard in fetch_market_indices.ts guarantees the committed file is
// left at its last-good content rather than a stale/partial payload. The
// scorer's checkin then stages whatever (if anything) changed into the SAME
// daily commit.

import { refreshMarketIndices } from "./fetch_market_indices.ts";

// Run the index refresh, swallowing any failure so the caller's scores/USDAUD
// commit is never blocked. `refresh` and `log` are injectable for testing.
// Always resolves to 0 — a non-fatal exit code by contract (#238).
async function refreshIndicesGraceful(
  refresh: () => Promise<void> = refreshMarketIndices,
  log: (msg: string) => void = console.error,
): Promise<number> {
  try {
    await refresh();
    log("refresh_market_indices: index refresh succeeded");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(
      "refresh_market_indices: index refresh failed " +
        `(${message}); leaving docs/market-indices.json unchanged and continuing`,
    );
  }
  // Always succeed: the scores/USDAUD commit must never be blocked (#238).
  return 0;
}

if (import.meta.main) {
  Deno.exit(await refreshIndicesGraceful());
}

export { refreshIndicesGraceful };
