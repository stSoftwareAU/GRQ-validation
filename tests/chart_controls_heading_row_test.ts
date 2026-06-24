// Tests for moving the chart controls UP onto the chart heading row (issue
// #518). The reporter asked repeatedly for the 90/180-day toggle
// (#chartWindowControl) and the expand ⤢ button (#chartPopoutExpand) to be
// MOVED — they previously sat stacked on two rows BELOW the
// "Portfolio Performance Over Time" heading, wasting mobile vertical space.
//
// The fix lifts both controls onto a SINGLE horizontal row that sits on the
// chart heading line itself (to the right of #chartTitle), above the chart
// card. These assertions pin:
//   - the new markup order in docs/index.html (controls after the title but
//     before the chart card/canvas, grouped in one wrapper);
//   - the CSS in docs/styles.css (the heading-controls wrapper lays the two
//     controls out on one row).
//
// The control markup is verified by reading the shipped files and asserting on
// their structure — the same approach used by chart_window_toggle_test.ts and
// dashboard_controls_test.ts.

import { assert } from "@std/assert";

const html = await Deno.readTextFile("docs/index.html");
const css = await Deno.readTextFile("docs/styles.css");

/** Return the body of the FIRST top-level CSS rule for `selector`, or null. */
function ruleBody(source: string, selector: string): string | null {
  const head = source.indexOf(selector + " {");
  if (head === -1) return null;
  const open = source.indexOf("{", head);
  const close = source.indexOf("}", open);
  if (open === -1 || close === -1) return null;
  return source.slice(open + 1, close);
}

// --- markup order ----------------------------------------------------------

Deno.test("index.html: chart controls sit on the heading row, not below it (#518)", () => {
  const titleIdx = html.indexOf('id="chartTitle"');
  const windowIdx = html.indexOf('id="chartWindowControl"');
  const expandIdx = html.indexOf('id="chartPopoutExpand"');
  const cardIdx = html.indexOf('class="card mb-4"');
  const canvasIdx = html.indexOf('id="performanceChart"');

  assert(titleIdx !== -1, "#chartTitle must exist");
  assert(windowIdx !== -1, "#chartWindowControl must exist");
  assert(expandIdx !== -1, "#chartPopoutExpand must exist");
  assert(cardIdx !== -1, "the chart card (card mb-4) must exist");
  assert(canvasIdx !== -1, "#performanceChart canvas must exist");

  // Controls come AFTER the title (same heading row) ...
  assert(
    titleIdx < windowIdx,
    "the 90/180 toggle must follow the chart title on the heading row",
  );
  assert(
    titleIdx < expandIdx,
    "the expand button must follow the chart title on the heading row",
  );
  // ... and BEFORE the chart card/canvas (moved UP, above the card).
  assert(
    windowIdx < cardIdx,
    "the 90/180 toggle must move above the chart card (not inside it)",
  );
  assert(
    expandIdx < cardIdx,
    "the expand button must move above the chart card (not inside it)",
  );
  assert(
    windowIdx < canvasIdx && expandIdx < canvasIdx,
    "both controls must precede the chart canvas",
  );
});

Deno.test("index.html: both controls share one heading-controls wrapper (#518)", () => {
  assert(
    html.includes("chart-heading-controls"),
    "a .chart-heading-controls wrapper must group the controls on one row",
  );
  const wrapIdx = html.indexOf("chart-heading-controls");
  const windowIdx = html.indexOf('id="chartWindowControl"');
  const expandIdx = html.indexOf('id="chartPopoutExpand"');
  // The toggle sits left of the expand button within the shared wrapper.
  assert(
    wrapIdx < windowIdx && windowIdx < expandIdx,
    "the wrapper must contain the 90/180 toggle then the expand button",
  );
});

// --- one-row layout --------------------------------------------------------

Deno.test("styles.css: heading-controls wrapper lays controls on one row (#518)", () => {
  const body = ruleBody(css, ".chart-heading-controls");
  assert(body, ".chart-heading-controls must be styled");
  assert(
    /display\s*:\s*(flex|inline-flex)/i.test(body),
    "the wrapper must be a flex row so the controls sit on one line",
  );
});

// --- the stacked second row is gone ----------------------------------------

Deno.test("index.html: the stacked control rows below the heading are removed (#518)", () => {
  // The controls no longer carry the stacking bottom-margin utilities that put
  // them on their own rows below the heading.
  assert(
    !html.includes('class="chart-window-control mb-2"'),
    "the 90/180 toggle must no longer carry the mb-2 stacking margin",
  );
});
