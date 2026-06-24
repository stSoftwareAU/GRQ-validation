// Tests for the 90/180-day chart window toggle (issue #449, sub-issue of
// milestone #445; extended to desktop in issue #466).
//
// Both phone (< 768px) and desktop now show the control, letting the user
// switch the visible chart/summary window between 90 and 180 days. Each device
// keeps its OWN default and store: mobile defaults to 90, desktop to 180. These
// assertions pin:
//   - the control markup in docs/index.html (present, accessible);
//   - the CSS in docs/styles.css (shown on every device, phone reveal kept);
//   - the wiring in docs/app.js (restores from, and persists to, the CURRENT
//     device's GRQChartWindow store on init/change, and re-renders BOTH the
//     chart and the Market Performance summary).
//
// The control markup is verified by reading the shipped files and asserting on
// their structure — the same approach used by dashboard_card_chrome_mobile_test
// .ts and dashboard_controls_test.ts. The persistence and shared-window MATHS
// are covered behaviourally by chart_window_settings_test.ts and
// chart_summary_window_test.ts; this file pins the UI + wiring around them.

import { assert } from "@std/assert";

const html = await Deno.readTextFile("docs/index.html");
const css = await Deno.readTextFile("docs/styles.css");
const appJs = await Deno.readTextFile("docs/app.js");

/**
 * Return the body of the FIRST top-level CSS rule for `selector` within `css`,
 * or null when absent. Matches the literal selector at a rule head.
 */
function ruleBody(source: string, selector: string): string | null {
  const head = source.indexOf(selector + " {");
  if (head === -1) return null;
  const open = source.indexOf("{", head);
  const close = source.indexOf("}", open);
  if (open === -1 || close === -1) return null;
  return source.slice(open + 1, close);
}

/**
 * Concatenate the bodies of EVERY `@media (...)` block matching `query`, or
 * null when none exist. styles.css splits its mobile rules across several
 * `@media (max-width: 768px)` blocks, so all must be considered.
 */
function mediaBlock(source: string, query: string): string | null {
  const needle = `@media ${query}`;
  const bodies: string[] = [];
  let from = 0;
  for (;;) {
    const head = source.indexOf(needle, from);
    if (head === -1) break;
    const open = source.indexOf("{", head);
    if (open === -1) break;
    let depth = 0;
    let end = -1;
    for (let i = open; i < source.length; i++) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) break;
    bodies.push(source.slice(open + 1, end));
    from = end + 1;
  }
  return bodies.length ? bodies.join("\n") : null;
}

// --- markup ----------------------------------------------------------------

Deno.test("index.html: chart window toggle control is present near the chart", () => {
  assert(
    html.includes('id="chartWindowControl"'),
    "the #chartWindowControl wrapper must exist",
  );
  // It sits in the chart card, before the performance chart canvas.
  const controlIdx = html.indexOf('id="chartWindowControl"');
  const canvasIdx = html.indexOf('id="performanceChart"');
  assert(controlIdx !== -1 && canvasIdx !== -1);
  assert(
    controlIdx < canvasIdx,
    "the toggle must appear before the chart canvas (near the chart)",
  );
});

Deno.test("index.html: toggle offers both 90 and 180 day choices", () => {
  assert(html.includes('id="chartWindow90"'), "90-day radio missing");
  assert(html.includes('id="chartWindow180"'), "180-day radio missing");
  assert(html.includes('value="90"'), "90 value missing");
  assert(html.includes('value="180"'), "180 value missing");
  // Both radios belong to the same group so they are mutually exclusive.
  const groupMatches = html.match(/name="chartWindowDays"/g) ?? [];
  assert(
    groupMatches.length >= 2,
    'both radios must share name="chartWindowDays"',
  );
});

Deno.test("index.html: default selection is 90 days (reflects the stored default)", () => {
  // The 90-day radio carries the `checked` attribute so a fresh device shows
  // the 90-day default; the 180-day radio does not.
  const ninety = html.slice(
    html.indexOf('id="chartWindow90"'),
    html.indexOf('id="chartWindow90"') + 260,
  );
  assert(
    ninety.includes("checked"),
    "the 90-day radio must default to checked",
  );

  const oneEighty = html.slice(
    html.indexOf('id="chartWindow180"'),
    html.indexOf('id="chartWindow180"') + 260,
  );
  assert(
    !oneEighty.includes("checked"),
    "the 180-day radio must NOT be checked by default",
  );
});

// --- accessibility ---------------------------------------------------------

Deno.test("index.html: toggle is accessible (labelled radio group, focusable labels)", () => {
  // Group is announced as a radio group with an accessible name. Issue #493
  // removed the redundant visible "Chart window" label; the group now carries
  // its accessible name via aria-label instead of aria-labelledby a visible
  // span, so the 90/180 buttons render without surrounding chrome.
  assert(html.includes('role="group"'), "the control must be a role=group");
  assert(
    html.includes('aria-label="Chart window"'),
    'the group must carry its accessible name via aria-label="Chart window"',
  );
  // Each radio is associated with a <label for=...> so it is keyboard-operable
  // and screen-reader labelled.
  assert(
    html.includes('for="chartWindow90"'),
    "the 90-day radio must have an associated <label for>",
  );
  assert(
    html.includes('for="chartWindow180"'),
    "the 180-day radio must have an associated <label for>",
  );
  // Native radio inputs are inherently focusable/keyboard-operable.
  assert(
    /type="radio"[\s\S]*id="chartWindow90"/.test(html) ||
      /id="chartWindow90"[\s\S]*type="radio"/.test(html),
    "the 90-day control must be a native radio input (keyboard-operable)",
  );
});

// --- no redundant visible label (issue #493) -------------------------------

Deno.test("index.html: the visible 'Chart window' label is removed (issue #493)", () => {
  // The self-explanatory 90/180 buttons need no preceding text label. The
  // redundant visible label and its id/aria-labelledby wiring are gone.
  assert(
    !html.includes('id="chartWindowLabel"'),
    "the visible chartWindowLabel span must be removed",
  );
  assert(
    !html.includes('aria-labelledby="chartWindowLabel"'),
    "the group must no longer reference the removed visible label",
  );
  assert(
    !html.includes("chart-window-control-label"),
    "the visible label element and its class must be removed",
  );
});

Deno.test("styles.css: the unused label rule is removed (issue #493)", () => {
  assert(
    !css.includes(".chart-window-control-label"),
    "the now-unused .chart-window-control-label rule must be removed",
  );
});

// --- visibility on every device (issue #466) -------------------------------

Deno.test("styles.css: toggle is shown on desktop by default (issue #466)", () => {
  // The base rule now reveals the control so desktop (>= 768px) shows it too —
  // the old `display: none` desktop hide is relaxed.
  const base = ruleBody(css, ".chart-window-control");
  assert(base, ".chart-window-control must be styled");
  assert(
    /display\s*:\s*(flex|block)/i.test(base),
    "desktop default must show the control (display: flex/block)",
  );
  assert(
    !/display\s*:\s*none/i.test(base),
    "the base rule must NOT hide the control on desktop any more",
  );
});

Deno.test("styles.css: the phone reveal block is kept (issue #466)", () => {
  // The mobile media block keeps revealing the control explicitly.
  const mobile = mediaBlock(css, "(max-width: 768px)");
  assert(mobile, "a (max-width: 768px) mobile media block must exist");
  const mobileBody = ruleBody(mobile, ".chart-window-control");
  assert(
    mobileBody,
    ".chart-window-control reveal must remain inside the mobile block",
  );
  assert(
    /display\s*:\s*(flex|block)/i.test(mobileBody),
    "mobile block must keep revealing the control (display: flex/block)",
  );
});

// --- wiring ----------------------------------------------------------------

Deno.test("app.js: init reads each device's stored window and wires the toggle", () => {
  assert(
    appJs.includes("initChartWindowToggle"),
    "app.js must define/call initChartWindowToggle",
  );
  // Mobile path (unchanged).
  assert(
    appJs.includes("GRQChartWindow.readMobileWindowDays"),
    "init must read the mobile choice via GRQChartWindow.readMobileWindowDays",
  );
  assert(
    appJs.includes("GRQChartWindow.writeMobileWindowDays"),
    "change must persist mobile via GRQChartWindow.writeMobileWindowDays",
  );
  // Desktop path (issue #466) — now reads and persists the desktop key too.
  assert(
    appJs.includes("GRQChartWindow.readDesktopWindowDays"),
    "init must read the desktop choice via GRQChartWindow.readDesktopWindowDays",
  );
  assert(
    appJs.includes("GRQChartWindow.writeDesktopWindowDays"),
    "change must persist desktop via GRQChartWindow.writeDesktopWindowDays",
  );
});

Deno.test("app.js: a per-device effective-window accessor resolves the choice (issue #466)", () => {
  // currentWindowDays() picks the mobile or desktop store based on the device,
  // so every window-sizing call site shares ONE source of truth.
  assert(
    appJs.includes("currentWindowDays()"),
    "app.js must define currentWindowDays() as the effective-window accessor",
  );
  assert(
    appJs.includes("desktopWindowDays()"),
    "app.js must define desktopWindowDays() parallel to mobileWindowDays()",
  );
  // The accessor must branch on the device between the two stores.
  const start = appJs.indexOf("currentWindowDays()");
  const body = appJs.slice(start, start + 300);
  assert(
    body.includes("isMobileDevice()") &&
      body.includes("mobileWindowDays()") &&
      body.includes("desktopWindowDays()"),
    "currentWindowDays() must choose mobile vs desktop window by device",
  );
});

Deno.test("app.js: the toggle change handler persists to the CURRENT device's store (issue #466)", () => {
  const start = appJs.indexOf("initChartWindowToggle()");
  assert(start !== -1, "initChartWindowToggle must exist");
  const body = appJs.slice(start, start + 1600);
  // The change handler branches on the device so a desktop flip writes the
  // desktop key and a mobile flip writes the mobile key (mobile unaffected).
  assert(
    body.includes("writeMobileWindowDays") &&
      body.includes("writeDesktopWindowDays"),
    "the change handler must persist to both stores depending on the device",
  );
  assert(
    body.includes("isMobileDevice()"),
    "the change handler must branch on isMobileDevice() to pick the store",
  );
});

Deno.test("app.js: changing the toggle re-renders BOTH chart and summary (#367)", () => {
  // Extract the toggle wiring method body and assert it drives both views, so
  // the chart and the Market Performance summary always agree on the window.
  const start = appJs.indexOf("initChartWindowToggle()");
  assert(start !== -1, "initChartWindowToggle must exist");
  const body = appJs.slice(start, start + 1400);
  assert(
    body.includes("this.updateChart()"),
    "the change handler must re-render the chart",
  );
  assert(
    body.includes("this.updateMarketComparison()"),
    "the change handler must refresh the Market Performance summary",
  );
});

Deno.test("app.js: chart and summary call sites pass the per-device window (issue #466)", () => {
  // Every window-sizing call site now resolves through currentWindowDays() so
  // the chart and the summary share ONE per-device window (a desktop 90 choice
  // narrows both together).
  assert(
    appJs.includes("this.currentWindowDays()"),
    "call sites must pass this.currentWindowDays() into the window helpers",
  );
  // The call sites must NOT hard-wire the mobile-only accessor any more.
  assert(
    !/deviceWindowEnd\([\s\S]*?this\.mobileWindowDays\(\)/.test(appJs),
    "deviceWindowEnd must no longer be fed the mobile-only window",
  );
  // The summary window end must receive the per-device window argument.
  assert(
    /deviceWindowEnd\([\s\S]*?(currentWindowDays\(\)|windowDays)/.test(appJs),
    "deviceWindowEnd call(s) must pass the per-device window",
  );
  assert(
    /deviceWindowDays\([^)]*(currentWindowDays\(\)|windowDays)/.test(appJs),
    "deviceWindowDays call(s) must pass the per-device window",
  );
});
