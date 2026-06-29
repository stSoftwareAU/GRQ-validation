// Tests for the dashboard controls row on docs/index.html (issue #251).
//
// The redundant "View All Score Files" button (linking to list.html) was
// removed from the dashboard. These tests assert the button and its link are
// gone while the Score File dropdown remains intact.

import { assert } from "@std/assert";

const html = await Deno.readTextFile("docs/index.html");

Deno.test("dashboard - no list.html link remains", () => {
  assert(
    !html.includes("list.html"),
    "docs/index.html must not link to list.html",
  );
});

Deno.test("dashboard - no 'View All Score Files' button remains", () => {
  assert(
    !html.includes("View All Score Files"),
    "the 'View All Score Files' button must be removed",
  );
});

Deno.test("dashboard - Score File dropdown is preserved", () => {
  assert(
    html.includes('id="scoreFileSelect"'),
    "the #scoreFileSelect dropdown must remain",
  );
});

// Issue #530: "Score File" is an implementation detail outsiders do not
// understand. The user-facing label and placeholder must read "Prediction
// Date" instead, while the underlying control id stays unchanged.
Deno.test("dashboard - control is labelled 'Prediction Date', not 'Score File'", () => {
  assert(
    /<label for="scoreFileSelect"[^>]*>Prediction Date:<\/label>/.test(html),
    "the label must read 'Prediction Date:'",
  );
  assert(
    !html.includes(">Score File:</label>"),
    "the old 'Score File:' label must not remain",
  );
  assert(
    html.includes("Select a prediction date..."),
    "the placeholder option must read 'Select a prediction date...'",
  );
  assert(
    !html.includes("Select a score file..."),
    "the old 'Select a score file...' placeholder must not remain",
  );
});

// Issue #654: the verbose "📈 Prediction Trend" button is renamed to a compact
// "Trend" so the controls row (Trend button + min-star filter + 90/180 toggle +
// expand button) fits on one line on a 375px-wide phone.
Deno.test("dashboard - Trend button reads 'Trend', not 'Prediction Trend'", () => {
  assert(
    /<a[^>]*id="trendViewLink"[^>]*>\s*Trend\s*<\/a>/.test(html),
    "the #trendViewLink button must read 'Trend'",
  );
  assert(
    !html.includes("Prediction Trend</a>"),
    "the old '📈 Prediction Trend' button text must not remain",
  );
});

// Issue #654: the shared min-star filter control appears on the portfolio
// controls row, defaulting to "All", and rides inside the .chart-heading-controls
// wrapper alongside the Trend button and 90/180 toggle (one line on mobile).
Deno.test("dashboard - min-star filter control is present and defaults to All", () => {
  assert(
    html.includes('id="starFilterSelect"'),
    "the #starFilterSelect control must be present on the portfolio row",
  );
  assert(
    html.includes('aria-label="Minimum star rating"'),
    "the min-star control must carry an accessible name",
  );
  // The first option is the default "All" (0 = off) — no filtering by default.
  assert(
    /<select[^>]*id="starFilterSelect"[\s\S]*?<option value="0">All<\/option>/
      .test(html),
    "the first option must be the default 'All' (value 0)",
  );
});

Deno.test("dashboard - min-star control sits in the chart-heading-controls row, above the chart card", () => {
  const trendIdx = html.indexOf('id="trendViewLink"');
  const wrapIdx = html.indexOf("chart-heading-controls");
  const starIdx = html.indexOf('id="starFilterControl"');
  const cardIdx = html.indexOf('class="card mb-4"');

  assert(starIdx !== -1, "#starFilterControl must exist");
  // It follows the Trend button, lives in the shared one-line wrapper, and
  // stays above the chart card (not inside it).
  assert(
    trendIdx < starIdx,
    "the min-star control must follow the Trend button",
  );
  assert(
    wrapIdx !== -1 && wrapIdx < starIdx,
    "the min-star control must sit inside the .chart-heading-controls wrapper",
  );
  assert(
    starIdx < cardIdx,
    "the min-star control must stay above the chart card",
  );
});
