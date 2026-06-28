// Tests for further compacting the dashboard top-of-page chrome on mobile
// (issue #492, part of milestone #484 — reclaim vertical space on phones).
//
// Issue #315 shrank the gradient banner on phones; #492 pushes the banner
// padding, title, subtitle and the control-row label spacing tighter still so
// the valuation content surfaces on first paint. All overrides stay gated
// behind the existing `(max-width: 768px)` mobile breakpoint.
//
// Issue #632: the former assertions read docs/styles.css as text and pinned the
// exact mobile-only declarations against historical baseline constants
// (0.75rem padding, 1.75rem title, 0.95rem subtitle, 0.25rem label gap),
// `!important` tokens, and which `@media` block they lived in. That is a
// source-text grep (a HOW-test) that a behaviour-preserving restyle breaks
// without changing what the user sees. The compacted mobile rendering is
// exercised by the pa11y visual gate at a 390px viewport; the enduring contract
// this unit test verifies is the accessible top-of-page structure — the <h1>
// title, the lead subtitle, the theme toggle and the labelled Prediction Date
// control — which survives any restyle.

import { assert } from "@std/assert";

const INDEX = "docs/index.html";

Deno.test("index.html: banner keeps its h1, lead subtitle, theme toggle and Prediction Date control", async () => {
  const html = await Deno.readTextFile(INDEX);
  assert(
    /<h1 class="display-4[^"]*">GRQ Validation Dashboard<\/h1>/.test(html),
    "the title must remain an <h1> for accessibility",
  );
  assert(/<p class="lead[^"]*">/.test(html), "the lead subtitle must remain");
  assert(html.includes('id="theme-toggle"'), "the theme toggle must remain");
  // Issue #530: the user-facing label reads "Prediction Date", not the
  // implementation detail "Score File", but it must keep its association
  // with the #scoreFileSelect control.
  assert(
    /<label for="scoreFileSelect"[^>]*>Prediction Date:<\/label>/.test(html),
    "the Prediction Date control must keep its associated <label>",
  );
});
