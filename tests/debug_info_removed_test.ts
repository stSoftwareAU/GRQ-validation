// Regression test for issue #619.
//
// The dashboard footer used to render a "device debug info" line
// (Bootstrap breakpoint | Mobile | Width | UA), driven by
// docs/dashboard_boot.js writing into a #debug-info element in
// docs/index.html. That readout is no longer wanted — but the
// application version line must stay, since it is useful.
//
// These tests assert the debug-info element and its updater are gone,
// while the #version display is retained.

import { assert } from "@std/assert";

const html = await Deno.readTextFile("docs/index.html");
const boot = await Deno.readTextFile("docs/dashboard_boot.js");

Deno.test("index.html no longer contains the debug-info element", () => {
  assert(
    !html.includes('id="debug-info"'),
    "docs/index.html must not render the device debug info line",
  );
});

Deno.test("index.html keeps the application version display", () => {
  assert(
    html.includes('id="version"'),
    "docs/index.html must keep the application version display",
  );
});

Deno.test("dashboard_boot.js no longer maintains the debug readout", () => {
  assert(
    !boot.includes("debug-info"),
    "dashboard_boot.js must not reference the debug-info element",
  );
  assert(
    !boot.includes("updateDebugInfo"),
    "dashboard_boot.js must not define updateDebugInfo",
  );
  assert(
    !boot.includes("navigator.userAgent"),
    "dashboard_boot.js must not read navigator.userAgent for debug output",
  );
});

Deno.test("dashboard_boot.js still loads app.js with the version query", () => {
  assert(
    boot.includes("app.js?v="),
    "dashboard_boot.js must still load app.js with a cache-busting version",
  );
});
