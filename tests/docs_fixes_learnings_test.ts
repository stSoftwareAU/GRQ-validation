// Tests for folding the durable docs/fixes/ learnings into the README (#759).
//
// docs/fixes/ was a second, drifting learnings store. Before each stale fix
// log was deleted, any durable learning it held that was NOT already captured
// in the README or a docs/archive pr-summary had to be folded into the relevant
// README section first. These assertions read the REAL committed README.md (and
// docs/app.js) and pin the folded learnings + the stale content that must be
// gone, so a future edit cannot silently drop them again.

import { assert, assertStringIncludes } from "@std/assert";

const README = "README.md";
const APP_JS = "docs/app.js";

Deno.test("README folds the annualised-performance calculation note", async () => {
  const readme = await Deno.readTextFile(README);
  // Compound growth over the ACTUAL elapsed days, capped at 90 — never a
  // simple ×4 multiplication (from ANNUALIZED_PERFORMANCE_CALCULATION.md).
  assertStringIncludes(readme, "365.25 / days_elapsed");
  assertStringIncludes(readme, "compound growth");
});

Deno.test("README folds the split-reconciliation thresholds", async () => {
  const readme = await Deno.readTextFile(README);
  // The numeric plausibility thresholds that live in code as the single source
  // of truth (from klac-split-distortion-investigation.md).
  assertStringIncludes(readme, "1.0 ≤ c ≤ 10.0");
  assertStringIncludes(readme, "5 trading days");
  assertStringIncludes(readme, "±15%");
});

Deno.test("README folds the late-stage projection confidence tiers", async () => {
  const readme = await Deno.readTextFile(README);
  // The R² threshold relaxes as a prediction matures (from
  // CONFIDENCE_THRESHOLD_FIX.md); the still-live behaviour is in docs/app.js.
  assertStringIncludes(readme, "0.001");
  const app = await Deno.readTextFile(APP_JS);
  assertStringIncludes(app, "confidenceThreshold");
});

Deno.test("no public CORS proxy relay lingers in the README or dashboard", async () => {
  // The abandoned-proxy negative learning is captured as "no public CORS
  // proxy / untrusted third-party relay" in the README; the actual relay
  // strings must not reappear anywhere the dashboard fetches from (#93, #759).
  for (const path of [README, APP_JS]) {
    const text = await Deno.readTextFile(path);
    for (const relay of ["allorigins.win", "cors-anywhere", "thingproxy"]) {
      assert(
        !text.includes(relay),
        `${path} must not reference the abandoned CORS proxy '${relay}'`,
      );
    }
  }
});

Deno.test("README still links the retained CI/CD setup guide", async () => {
  const readme = await Deno.readTextFile(README);
  assertStringIncludes(readme, "docs/fixes/CI_CD_SETUP.md");
  assert(
    (await Deno.stat("docs/fixes/CI_CD_SETUP.md")).isFile,
    "the retained CI_CD_SETUP.md link target must resolve",
  );
});
