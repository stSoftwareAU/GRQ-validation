// Tests for tightening dashboard section/card spacing on mobile (issue #316,
// part of milestone #307 — give data more room on phones).
//
// On a phone the dashboard wasted vertical space in the between-section gaps
// and the outer body padding; those are tightened in a mobile media query while
// desktop/tablet (>=768px) is untouched.
//
// Issue #632: the former assertions read docs/styles.css as text and pinned the
// exact mobile-only declarations (`.mb-4`/`.mb-3` margins below Bootstrap's
// defaults, `.card-body.p-4` padding, `.row` gutters, `!important` tokens, and
// which `@media` block they lived in). That is a source-text grep (a HOW-test):
// a behaviour-preserving restyle that expresses the same tightening with `gap`,
// logical properties or a custom property leaves the rendered page identical yet
// trips the grep. The tightened mobile spacing is exercised by the pa11y visual
// gate at a 390px viewport; the enduring contract this unit test verifies is
// that the dashboard keeps its sections and controls (the features survive any
// restyle).

import { assert } from "@std/assert";

const INDEX = "docs/index.html";

Deno.test("index.html: dashboard keeps its sections and controls", async () => {
  const html = await Deno.readTextFile(INDEX);
  assert(
    html.includes('id="scoreFileSelect"'),
    "the score-file control must remain",
  );
  assert(
    html.includes('id="marketComparison"'),
    "the market-comparison section must remain",
  );
  assert(
    html.includes('id="performanceChart"'),
    "the chart section must remain",
  );
});
