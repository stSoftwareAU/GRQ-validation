// Tests for keeping the chart controls on a SINGLE horizontal row (issue #518).
// The reporter asked repeatedly for the 90/180-day toggle (#chartWindowControl)
// and the expand ⤢ button (#chartPopoutExpand) to be MOVED off the two stacked
// rows they originally occupied, onto one horizontal line.
//
// Issue #524 then moved that single-row group again — up onto the Prediction
// Trend button's line (above the chart heading), so the controls no longer sit
// on the #chartTitle row. The detailed placement assertions now live in
// chart_controls_trend_line_test.ts; this file retains only #518's enduring
// guarantees that survive that move:
//   - both controls are grouped in ONE .chart-heading-controls wrapper, with
//     the 90/180 toggle to the left of the expand button;
//   - the controls still precede the chart card/canvas (they are above it, not
//     inside it);
//   - the old stacking bottom-margin utility is gone.
//
// The control markup is verified by reading the shipped files and asserting on
// their structure — the same approach used by chart_window_toggle_test.ts and
// dashboard_controls_test.ts.
//
// Issue #632: the former "wrapper is a flex row in styles.css" assertion was a
// source-text grep over docs/styles.css (it pinned `display: flex`), so a
// behaviour-preserving restyle — e.g. a single-row CSS grid — tripped it
// without changing what the user sees. The one-row layout is exercised by the
// pa11y visual gate at mobile viewports; the enduring markup-grouping contract
// below is what these unit tests verify.

import { assert } from "@std/assert";

const html = await Deno.readTextFile("docs/index.html");

// --- markup order ----------------------------------------------------------

Deno.test("index.html: chart controls sit above the chart card, not inside it (#518)", () => {
  const windowIdx = html.indexOf('id="chartWindowControl"');
  const expandIdx = html.indexOf('id="chartPopoutExpand"');
  const cardIdx = html.indexOf('class="card mb-4"');
  const canvasIdx = html.indexOf('id="performanceChart"');

  assert(windowIdx !== -1, "#chartWindowControl must exist");
  assert(expandIdx !== -1, "#chartPopoutExpand must exist");
  assert(cardIdx !== -1, "the chart card (card mb-4) must exist");
  assert(canvasIdx !== -1, "#performanceChart canvas must exist");

  // Both controls live ABOVE the chart card/canvas (issue #524 moved them up
  // onto the Prediction Trend line; they remain above the card, not inside it).
  assert(
    windowIdx < cardIdx,
    "the 90/180 toggle must stay above the chart card (not inside it)",
  );
  assert(
    expandIdx < cardIdx,
    "the expand button must stay above the chart card (not inside it)",
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

// --- the stacked second row is gone ----------------------------------------

Deno.test("index.html: the stacked control rows below the heading are removed (#518)", () => {
  // The controls no longer carry the stacking bottom-margin utilities that put
  // them on their own rows below the heading.
  assert(
    !html.includes('class="chart-window-control mb-2"'),
    "the 90/180 toggle must no longer carry the mb-2 stacking margin",
  );
});
