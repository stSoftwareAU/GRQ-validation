// Tests for flattening dashboard card chrome on mobile (issue #317, part of
// milestone #307 — give data more room on phones).
//
// Each dashboard section is a Bootstrap `.card` with a border, rounded corners
// and a `shadow-sm` drop shadow. On a phone those boxed the figures/tables in
// and wasted edge space, so the cards are flattened in a mobile media query
// while desktop/tablet (>=768px) is untouched.
//
// Issue #632: the former assertions read docs/styles.css as text and pinned the
// exact mobile-only declarations (`.card` `border-radius: 0`, `border: none`,
// `.shadow-sm` `box-shadow: none`, `!important` tokens, and which `@media` block
// they lived in). That is a source-text grep (a HOW-test) that a
// behaviour-preserving restyle breaks without changing what the user sees. The
// flat mobile rendering is exercised by the pa11y visual gate at a 390px
// viewport; the enduring contract this unit test verifies is the section
// heading/markup structure that survives any restyle.

import { assert } from "@std/assert";

const INDEX = "docs/index.html";

Deno.test("index.html: card-header titles and section markup remain intact", async () => {
  const html = await Deno.readTextFile(INDEX);
  assert(
    html.includes("Market Performance Comparison"),
    "the market-comparison card-header title must remain",
  );
  // Issue #605: the "Individual Stock Performance" heading was deleted.
  assert(
    !html.includes("Individual Stock Performance"),
    "the stock-table card-header title must be removed (issue #605)",
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
