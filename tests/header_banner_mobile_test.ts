// Tests for shrinking the dashboard header banner on mobile (issue #315,
// part of milestone #307 — reclaim vertical space on phones).
//
// The top banner is a `div.card-header.header-gradient` with an `h1.display-4`
// title and a `p.lead` subtitle. On a phone the gradient banner ate a large
// slice of the first screen, so its vertical footprint is shrunk in CSS via a
// mobile media query.
//
// Issue #632: the former assertions read docs/styles.css as text and pinned the
// exact mobile-only declarations (`padding-top`/`padding-bottom` rem values,
// `!important` tokens, `font-size` values, and which `@media` block they lived
// in). That is a source-text grep (a HOW-test): any behaviour-preserving
// restyle — collapsing the four padding declarations into a `padding`
// shorthand, expressing the shrink with a custom property, etc. — leaves the
// rendered banner identical yet trips the grep. The shrunk mobile rendering is
// exercised by the pa11y visual gate at a 390px viewport; the enduring contract
// this unit test verifies is that the banner keeps its title, subtitle and
// theme toggle (the feature survives any restyle).

import { assert } from "@std/assert";

const INDEX = "docs/index.html";

Deno.test("index.html: banner keeps title, subtitle and theme toggle", async () => {
  const html = await Deno.readTextFile(INDEX);
  assert(
    html.includes("GRQ Validation Dashboard"),
    "the banner title text must remain",
  );
  assert(
    /<p class="lead[^"]*">/.test(html),
    "the lead subtitle must remain",
  );
  assert(
    html.includes('id="theme-toggle"'),
    "the theme-toggle button must remain",
  );
});
