// App-shell script cache-busting guard (issue #641).
//
// Regression: a returning user loaded the NEW app.js (always fetched fresh
// because dashboard_boot.js appends `?v=<VERSION>`) against a STALE cached
// projection.js (a plain `<script src="projection.js">` tag with no version
// query, served cache-first by the service worker). The new app.js called
// `GRQProjection.calculatePortfolioTargetWorking` (#640) which the old cached
// projection.js did not define, so the dashboard threw
// "GRQProjection.calculatePortfolioTargetWorking is not a function".
//
// The fix loads every app.js dependency in lockstep with app.js: each local
// helper `<script src>` carries the SAME `?v=<APP_VERSION>` cache-buster, so a
// version bump invalidates app.js and its dependencies together — they can
// never go out of sync. These tests call no source greps for behaviour; they
// parse the actual published markup and assert the wiring that prevents the
// skew.

import { assertEquals } from "@std/assert";

const indexHtml = await Deno.readTextFile(
  new URL("../docs/index.html", import.meta.url),
);
const sw = await Deno.readTextFile(new URL("../docs/sw.js", import.meta.url));

const appVersion = sw.match(/const APP_VERSION = "([^"]+)";/)?.[1];

// The local helper scripts app.js depends on (the "must load before app.js"
// block in docs/index.html). Each MUST be version-busted so it can never be
// served stale against a freshly-fetched app.js.
const APP_DEPENDENCY_SCRIPTS = [
  "escape.js",
  "projection.js",
  "volume_recommend.js",
  "chart_window_settings.js",
  "color_key.js",
  "series_label_colour.js",
  "chart_theme.js",
  "chart_title.js",
  "format.js",
  "market_index.js",
  "stock_selection.js",
  "yahoo_finance.js",
  "date_selection.js",
  "view_selection.js",
  "popover_dismiss.js",
  "popover_cleanup.js",
  "chart_popout.js",
  "share_link.js",
  "field_label.js",
  "freshness_text.js",
  "dashboard_boot.js",
];

/** Extract the `?v=` query for a given script src in index.html, or null. */
function scriptVersion(html: string, name: string): string | null {
  const match = html.match(
    new RegExp(`src="${name.replace(".", "\\.")}\\?v=([0-9.]+)"`),
  );
  return match ? match[1] : null;
}

Deno.test("sw.js declares a parseable APP_VERSION", () => {
  if (!appVersion) {
    throw new Error("Could not find APP_VERSION in sw.js");
  }
  assertEquals(/^\d+\.\d+\.\d+$/.test(appVersion), true);
});

Deno.test("projection.js is cache-busted in lockstep with app.js (regression #641)", () => {
  // The reported failure: new app.js + stale projection.js. projection.js must
  // carry the current app version so it is fetched fresh alongside app.js.
  assertEquals(
    scriptVersion(indexHtml, "projection.js"),
    appVersion,
    "docs/index.html must load projection.js with ?v=<APP_VERSION> so it can " +
      "never be served stale against a freshly-fetched app.js",
  );
});

Deno.test("every app.js dependency script is version-busted to APP_VERSION", () => {
  for (const name of APP_DEPENDENCY_SCRIPTS) {
    assertEquals(
      scriptVersion(indexHtml, name),
      appVersion,
      `docs/index.html must load ${name} with ?v=${appVersion} so app.js ` +
        "never runs against a stale dependency",
    );
  }
});

Deno.test("no app.js dependency is left with an unversioned <script src>", () => {
  for (const name of APP_DEPENDENCY_SCRIPTS) {
    const unversioned = new RegExp(`src="${name.replace(".", "\\.")}"`);
    assertEquals(
      unversioned.test(indexHtml),
      false,
      `docs/index.html still loads ${name} without a ?v= cache-buster`,
    );
  }
});
