// Tests for the shared min-star filter control on the Trend page
// (issue #654, foundation sub-issue of milestone #653).
//
// The control must appear on BOTH the portfolio (docs/index.html — covered by
// dashboard_controls_test.ts) and the Trend (docs/trend.html) controls rows,
// using the SAME #starFilterSelect id and the same All / 1★+ … / 5★+ options so
// both pages reflect and write the single persisted threshold. These assertions
// read the shipped trend.html and verify the control's presence, accessible
// name, and "All" default, matching the file-reading approach used by the other
// control tests in this suite.

import { assert } from "@std/assert";

const html = await Deno.readTextFile("docs/trend.html");

Deno.test("trend - min-star filter control is present and defaults to All", () => {
  assert(
    html.includes('id="starFilterSelect"'),
    "the #starFilterSelect control must be present on the Trend controls row",
  );
  assert(
    html.includes('aria-label="Minimum star rating"'),
    "the min-star control must carry an accessible name",
  );
  assert(
    /<select[^>]*id="starFilterSelect"[\s\S]*?<option value="0">All<\/option>/
      .test(html),
    "the first option must be the default 'All' (value 0)",
  );
});

Deno.test("trend - min-star control offers the whole-star thresholds 1..5", () => {
  for (const n of [1, 2, 3, 4, 5]) {
    assert(
      html.includes(`<option value="${n}">${n}★+</option>`),
      `the control must offer the ${n}★+ threshold`,
    );
  }
});

Deno.test("trend - star_filter_settings.js is loaded before trend.js", () => {
  const settingsIdx = html.indexOf('src="star_filter_settings.js"');
  const trendIdx = html.indexOf('src="trend.js"');
  assert(settingsIdx !== -1, "trend.html must load star_filter_settings.js");
  assert(
    settingsIdx < trendIdx,
    "star_filter_settings.js must load before trend.js (which wires the control)",
  );
});
