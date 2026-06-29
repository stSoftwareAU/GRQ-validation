// Regression test for issue #619.
//
// The dashboard footer used to render a "device debug info" line
// (Bootstrap breakpoint | Mobile | Width | UA), driven by
// docs/dashboard_boot.js writing into a #debug-info element in
// docs/index.html. That readout is no longer wanted — but the
// application version line must stay, since it is useful.
//
// Issue #633: the dashboard_boot.js checks below used to grep the module's
// SOURCE TEXT for internal identifier names (`updateDebugInfo`,
// `navigator.userAgent`, `app.js?v=`). A grep passes for the wrong reason —
// it never runs the boot — and breaks on any rename even when behaviour is
// unchanged. They are now BEHAVIOURAL: we drive the real bootstrap with a fake
// DOM and assert its observable effects — it loads app.js with the version
// query and never populates a #debug-info readout.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";

const html = await Deno.readTextFile("docs/index.html");

// --- shipped markup contracts ---------------------------------------------

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

// --- behavioural: drive the REAL bootstrap with a fake DOM -----------------

// dashboard_boot.js runs its IIFE at import time, reading globalThis.VERSION
// and mutating document. Define both BEFORE importing so the real boot code
// runs against the fake DOM (mirrors share_button_wiring_test.ts).
class FakeScript {
  src = "";
}

class FakeElement {
  textContent = "";
  innerHTML = "";
}

const appendedScripts: FakeScript[] = [];
// A live #debug-info element the boot COULD populate if it still maintained the
// debug readout. After boot it must remain untouched.
const debugInfo = new FakeElement();

const fakeDoc = {
  createElement: (_tag: string) => new FakeScript(),
  head: {
    appendChild: (node: FakeScript) => {
      appendedScripts.push(node);
    },
  },
  getElementById: (id: string) => id === "debug-info" ? debugInfo : null,
};

(globalThis as unknown as { document: unknown }).document = fakeDoc;
(globalThis as unknown as { VERSION: string }).VERSION = "9.9.9-test";

await import("../docs/dashboard_boot.js");

Deno.test("dashboard_boot.js loads app.js with the cache-busting version", () => {
  assertEquals(
    appendedScripts.length,
    1,
    "the boot must append exactly one script",
  );
  assertStringIncludes(
    appendedScripts[0].src,
    "app.js?v=9.9.9-test",
    "the boot must load app.js with the version query",
  );
});

Deno.test("dashboard_boot.js does not populate a device debug readout", () => {
  // The boot ran above; a debug-info element was reachable via getElementById
  // yet the boot never wrote to it — the readout removal is observable, not
  // merely absent from the source text.
  assertEquals(
    debugInfo.textContent,
    "",
    "the boot must not write a debug readout into #debug-info",
  );
  assertEquals(
    debugInfo.innerHTML,
    "",
    "the boot must not render any debug markup into #debug-info",
  );
});
