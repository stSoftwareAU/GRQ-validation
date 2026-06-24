// Tests for moving the chart controls onto the SAME line as the "Prediction
// Trend" button (issue #524). The reporter circled the 90/180-day toggle
// (#chartWindowControl) and the mobile expand ⤢ button (#chartPopoutExpand) and
// drew an arrow up to the 📈 Prediction Trend button (#trendViewLink): they used
// to sit on the chart heading row BELOW the Prediction Trend button (issue
// #518), wasting a whole row on mobile. They now ride on the Prediction Trend
// line itself — to the right of #trendViewLink, in the top controls row, above
// the loading/chart area.
//
// These assertions pin the new markup order in docs/index.html and the
// single-line flex layout in docs/styles.css, matching the file-reading
// approach used by chart_window_toggle_test.ts and chart_controls_heading_row_test.ts.

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

Deno.test("index.html: chart controls follow the Prediction Trend button (#524)", () => {
  const trendIdx = html.indexOf('id="trendViewLink"');
  const windowIdx = html.indexOf('id="chartWindowControl"');
  const expandIdx = html.indexOf('id="chartPopoutExpand"');
  const titleIdx = html.indexOf('id="chartTitle"');

  assert(trendIdx !== -1, "#trendViewLink must exist");
  assert(windowIdx !== -1, "#chartWindowControl must exist");
  assert(expandIdx !== -1, "#chartPopoutExpand must exist");
  assert(titleIdx !== -1, "#chartTitle must exist");

  // The 90/180 toggle and expand button now come AFTER the Prediction Trend
  // button (same line) ...
  assert(
    trendIdx < windowIdx,
    "the 90/180 toggle must follow the Prediction Trend button",
  );
  assert(
    trendIdx < expandIdx,
    "the expand button must follow the Prediction Trend button",
  );
  // ... and BEFORE the chart title (they no longer ride the chart heading row).
  assert(
    windowIdx < titleIdx,
    "the 90/180 toggle must sit above the chart heading, not on it",
  );
  assert(
    expandIdx < titleIdx,
    "the expand button must sit above the chart heading, not on it",
  );
});

Deno.test("index.html: the trend button and chart controls share one flex line (#524)", () => {
  // The Prediction Trend column wraps the button and the chart-heading-controls
  // wrapper in a single flex container so they sit on one horizontal line.
  const trendIdx = html.indexOf('id="trendViewLink"');
  const wrapIdx = html.indexOf("chart-heading-controls");
  const windowIdx = html.indexOf('id="chartWindowControl"');
  const expandIdx = html.indexOf('id="chartPopoutExpand"');

  assert(
    trendIdx < wrapIdx,
    "the chart-heading-controls wrapper must follow the trend button",
  );
  // Within the wrapper the toggle sits left of the expand button.
  assert(
    wrapIdx < windowIdx && windowIdx < expandIdx,
    "the wrapper must contain the 90/180 toggle then the expand button",
  );
});

Deno.test("styles.css: heading-controls wrapper still lays controls on one row (#524)", () => {
  const body = ruleBody(css, ".chart-heading-controls");
  assert(body, ".chart-heading-controls must be styled");
  assert(
    /display\s*:\s*(flex|inline-flex)/i.test(body),
    "the wrapper must be a flex row so the controls sit on one line",
  );
});
