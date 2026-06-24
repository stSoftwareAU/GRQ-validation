// Wiring guards for the Trend view (issue #430, milestone #422).
//
// The Trend view is a separate page (docs/trend.html) that must be reachable
// from the existing dashboard, precached for offline/installed use, and built
// only from the shared modules. These tests pin that wiring against the real
// shipped files so a future edit cannot silently drop it.
import { assert, assertEquals } from "@std/assert";

const trendHtml = await Deno.readTextFile("docs/trend.html");
const indexHtml = await Deno.readTextFile("docs/index.html");
const sw = await Deno.readTextFile("docs/sw.js");

Deno.test("index.html links to the Trend view (navigation in)", () => {
  assert(
    indexHtml.includes('href="trend.html"'),
    "the dashboard must offer a link to trend.html",
  );
});

Deno.test("trend.html links back to the dashboard (navigation out)", () => {
  assert(
    trendHtml.includes('href="index.html"'),
    "the Trend view must offer a link back to index.html",
  );
});

Deno.test("trend.html loads the shared engines and the controller", () => {
  for (
    const src of [
      "projection.js",
      "format.js",
      "market_index.js",
      "trend_series.js",
      "index_overlay.js",
      "trend_settings.js",
      "trend_indices_deeplink.js",
      "trend_predictions.js",
      "trend.js",
    ]
  ) {
    assert(
      trendHtml.includes(`src="${src}"`),
      `trend.html must load ${src}`,
    );
  }
});

Deno.test("trend.html exposes the grouping control and chart canvas", () => {
  assert(trendHtml.includes('id="groupingSelect"'), "grouping select missing");
  assert(trendHtml.includes('id="trendChart"'), "trend chart canvas missing");
  assert(trendHtml.includes('id="trendEmpty"'), "empty-state element missing");
  // Default grouping is month — the select offers all four granularities.
  for (const value of ["day", "week", "month", "quarter"]) {
    assert(
      trendHtml.includes(`value="${value}"`),
      `grouping option ${value} missing`,
    );
  }
});

Deno.test("sw.js precaches the Trend view assets", () => {
  for (
    const asset of [
      "./trend.html",
      "./trend.js",
      "./trend_predictions.js",
      "./trend_series.js",
      "./index_overlay.js",
      "./trend_settings.js",
      "./trend_indices_deeplink.js",
    ]
  ) {
    assert(
      sw.includes(`"${asset}"`),
      `sw.js STATIC_ASSETS must precache ${asset}`,
    );
  }
});

Deno.test("trend.html app-version aligns with sw.js APP_VERSION", () => {
  const appVersion = sw.match(/const APP_VERSION = "([^"]+)";/)?.[1];
  const trendMeta = trendHtml.match(
    /<meta name="app-version" content="([^"]+)">/,
  )?.[1];
  assertEquals(
    trendMeta,
    appVersion,
    "trend.html app-version meta must match sw.js APP_VERSION",
  );
});
