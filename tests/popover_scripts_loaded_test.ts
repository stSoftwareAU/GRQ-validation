// Regression test for PR #389 / pa11y CI failure.
//
// docs/app.js calls both globalThis.GRQPopover.* (popover_dismiss.js) and
// globalThis.GRQPopovers.* (popover_cleanup.js) on every dashboard re-render.
// popover_cleanup.js was added to the service-worker precache list but NOT to
// index.html, so the browser left globalThis.GRQPopovers undefined,
// updateStockTable() threw, and #stockDetailCard never rendered — pa11y timed
// out waiting for it (exit code 2).
//
// These tests assert that each popover helper script app.js depends on is
// loaded by index.html, before the app.js bootstrap, so a missing <script>
// tag is caught here instead of in CI.

import { assert } from "@std/assert";

const html = await Deno.readTextFile("docs/index.html");
const appJs = await Deno.readTextFile("docs/app.js");

// Map the globalThis namespace app.js consumes to the file that publishes it.
const MODULES: Array<{ global: string; src: string }> = [
  { global: "GRQPopover.", src: "popover_dismiss.js" },
  { global: "GRQPopovers.", src: "popover_cleanup.js" },
];

for (const { global, src } of MODULES) {
  Deno.test(`index.html loads ${src} that app.js depends on (${global})`, () => {
    // Only require the script tag when app.js actually uses the global.
    if (!appJs.includes(global)) return;

    const scriptIndex = html.indexOf(`src="${src}"`);
    assert(
      scriptIndex !== -1,
      `docs/index.html must load ${src}; app.js uses globalThis.${global}`,
    );

    const bootIndex = html.indexOf('src="dashboard_boot.js"');
    assert(bootIndex !== -1, "dashboard_boot.js script tag must be present");
    assert(
      scriptIndex < bootIndex,
      `${src} must be loaded before dashboard_boot.js (app.js)`,
    );
  });
}
