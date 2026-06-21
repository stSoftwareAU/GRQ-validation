// Daily lockstep wrapper tests (issue #238).
//
// The scorer job invokes scripts/refresh_market_indices.ts immediately before
// its daily scores/USDAUD commit. Its one hard guarantee is that it must NEVER
// block that commit: whether the underlying Yahoo fetch succeeds or fails, the
// wrapper logs the outcome and resolves to exit code 0. These tests inject a
// stub refresh + log capturer (no network, no subprocess) and assert that
// contract directly against the REAL refreshIndicesGraceful function.

import { assert, assertEquals } from "@std/assert";
import { refreshIndicesGraceful } from "../scripts/refresh_market_indices.ts";

Deno.test("refreshIndicesGraceful - success path returns 0 and logs success", async () => {
  const logs: string[] = [];
  let called = 0;
  const code = await refreshIndicesGraceful(
    () => {
      called++;
      return Promise.resolve();
    },
    (msg) => logs.push(msg),
  );

  assertEquals(code, 0);
  assertEquals(called, 1);
  assert(
    logs.some((l) => l.includes("succeeded")),
    "expected a success log line",
  );
});

Deno.test("refreshIndicesGraceful - a fetch failure still returns 0 (never blocks the commit)", async () => {
  const logs: string[] = [];
  const code = await refreshIndicesGraceful(
    () => Promise.reject(new Error("Yahoo Finance returned no usable closes")),
    (msg) => logs.push(msg),
  );

  // The contract: a failed/partial fetch must not block the scores/USDAUD commit.
  assertEquals(code, 0);
  assert(
    logs.some((l) => l.includes("failed")),
    "expected a failure log line",
  );
  assert(
    logs.some((l) => l.includes("leaving docs/market-indices.json unchanged")),
    "failure log must state the committed file is left untouched",
  );
});

Deno.test("refreshIndicesGraceful - surfaces the underlying failure reason in the log", async () => {
  const logs: string[] = [];
  const code = await refreshIndicesGraceful(
    () =>
      Promise.reject(
        new Error("Refusing to overwrite docs/market-indices.json: regressed"),
      ),
    (msg) => logs.push(msg),
  );

  assertEquals(code, 0);
  assert(
    logs.some((l) => l.includes("Refusing to overwrite")),
    "the safe-write guard's reason should be surfaced for diagnostics",
  );
});

Deno.test("refreshIndicesGraceful - tolerates a non-Error rejection", async () => {
  const logs: string[] = [];
  const code = await refreshIndicesGraceful(
    () => Promise.reject("string failure"),
    (msg) => logs.push(msg),
  );

  assertEquals(code, 0);
  assert(logs.some((l) => l.includes("string failure")));
});
