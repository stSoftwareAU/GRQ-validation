// Tests for the mobile-only 90/180-day chart window toggle (issue #449,
// sub-issue of milestone #445).
//
// On a phone (< 768px) the user can switch the visible chart/summary window
// between 90 days (default) and the full 180 days. Desktop never shows the
// toggle and always renders 180 days. These assertions pin:
//   - the control markup in docs/index.html (present, default 90, accessible);
//   - the mobile-only CSS in docs/styles.css (hidden on desktop, shown < 768px);
//   - the wiring in docs/app.js (reads GRQChartWindow on init, persists on
//     change, and re-renders BOTH the chart and the Market Performance summary).
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
  // Group is announced as a radio group with an accessible name.
  assert(html.includes('role="group"'), "the control must be a role=group");
  assert(
    html.includes('aria-labelledby="chartWindowLabel"'),
    "the group must reference its visible label via aria-labelledby",
  );
  assert(
    html.includes('id="chartWindowLabel"'),
    "the visible label element must exist",
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

// --- mobile-only visibility ------------------------------------------------

Deno.test("styles.css: toggle is hidden by default (desktop) and revealed on mobile", () => {
  // Base rule hides the control so desktop (>= 768px) never shows it.
  const base = ruleBody(css, ".chart-window-control");
  assert(base, ".chart-window-control must be styled");
  assert(
    /display\s*:\s*none/i.test(base),
    "desktop default must hide the control (display: none)",
  );

  // The mobile media block reveals it.
  const mobile = mediaBlock(css, "(max-width: 768px)");
  assert(mobile, "a (max-width: 768px) mobile media block must exist");
  const mobileBody = ruleBody(mobile, ".chart-window-control");
  assert(
    mobileBody,
    ".chart-window-control must be revealed inside the mobile block",
  );
  assert(
    /display\s*:\s*(flex|block)/i.test(mobileBody),
    "mobile block must reveal the control (display: flex/block)",
  );
});

Deno.test("styles.css: the toggle reveal is confined to the mobile block (desktop untouched)", () => {
  // No (min-width: 768px) desktop rule may re-show it.
  const desktop = mediaBlock(css, "(min-width: 768px)");
  if (desktop) {
    const desktopBody = ruleBody(desktop, ".chart-window-control");
    assert(
      desktopBody === null,
      "the desktop block must not re-show the toggle",
    );
  }
});

// --- wiring ----------------------------------------------------------------

Deno.test("app.js: init reads the stored mobile window and wires the toggle", () => {
  assert(
    appJs.includes("initChartWindowToggle"),
    "app.js must define/call initChartWindowToggle",
  );
  assert(
    appJs.includes("GRQChartWindow.readMobileWindowDays"),
    "init must read the stored choice via GRQChartWindow.readMobileWindowDays",
  );
  assert(
    appJs.includes("GRQChartWindow.writeMobileWindowDays"),
    "change must persist the choice via GRQChartWindow.writeMobileWindowDays",
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

Deno.test("app.js: chart and summary call sites pass the chosen mobile window", () => {
  // Both the summary (deviceWindowEnd) and the chart (deviceWindowDays /
  // deviceWindowEnd) feed the chosen window through, so they share ONE window.
  assert(
    appJs.includes("this.mobileWindowDays()"),
    "call sites must pass this.mobileWindowDays() into the window helpers",
  );
  // The summary window end must receive the chosen window argument.
  assert(
    /deviceWindowEnd\([\s\S]*?this\.mobileWindowDays\(\)/.test(appJs),
    "deviceWindowEnd call(s) must pass the chosen mobile window",
  );
  assert(
    /deviceWindowDays\([^)]*this\.mobileWindowDays\(\)/.test(appJs),
    "deviceWindowDays call(s) must pass the chosen mobile window",
  );
});
