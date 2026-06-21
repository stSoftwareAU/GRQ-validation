// Service worker pathname guards for the GRQ Validation Dashboard (issue #223).
//
// Australian English: these tests prevent regressions where per-day score
// data (CSV/TSV) or the score index becomes stale due to incorrect
// URL.pathname matching. They mirror the FX dashboard's
// tests/sw-pathname-guards.test.ts, adapted to GRQ Validation's file layout
// (scores live under ./scores/<year>/<month>/<day>.tsv plus *-analysis.csv
// and *-dividends.csv, and the index is ./scores/index.json).

const sw = await Deno.readTextFile(new URL("../docs/sw.js", import.meta.url));

Deno.test("sw.js caches per-day score data using a pathname-based CSV/TSV regex", () => {
  if (!sw.includes("/\\/scores\\/.*\\.(csv|tsv)$/")) {
    throw new Error(
      "Expected sw.js to include pathname regex /\\/scores\\/.*\\.(csv|tsv)$/",
    );
  }
});

Deno.test("sw.js treats scores/index.json as network-first via a pathname regex", () => {
  if (!sw.includes("/\\/scores\\/index\\.json$/")) {
    throw new Error(
      "Expected sw.js to include network-first pathname regex /\\/scores\\/index\\.json$/",
    );
  }
});

Deno.test("sw.js does not use a './scores/' string literal that never matches URL.pathname", () => {
  if (sw.includes("./scores/")) {
    throw new Error(
      "sw.js still appears to contain './scores/' which does not match URL.pathname",
    );
  }
});

Deno.test("sw.js does not treat data JSON as a cache-first static JSON asset", () => {
  // sw.js writes the guard with double-quoted ".json" — match that exactly so
  // score/index and on-demand data JSON (market-indices.json, USDAUD.json)
  // are excluded from the generic cache-first static .json matcher.
  if (!sw.includes('endsWith(".json") && !isNetworkFirst && !isDataFile')) {
    throw new Error(
      "Expected sw.js to exclude data JSON from the static asset .json matcher",
    );
  }
});
