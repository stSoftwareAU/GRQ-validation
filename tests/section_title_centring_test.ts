// Tests for centring dashboard section/card titles on one line and using the
// full available width (issue #277, part of milestone #269 item C).
//
// Section titles such as "Market Performance Comparison" live in a
// `.card-header` as a `.card-title` heading. The centring/full-width/one-line
// behaviour is implemented in pure CSS.
//
// Issue #695: the heading tag was changed from `<h5>` to `<h3>` (with an `.h5`
// utility class for identical visual size) to fix the h2 → h5 outline skip.
// The centring CSS targets the `.card-title` class, not the `h5` tag, so the
// enduring contract is the class hook — this test now matches any heading level
// bearing `.card-title` rather than pinning the tag name.
//
// Issue #632: the former assertions read docs/styles.css as text and pinned the
// exact declarations that produce the centring (`text-align: center`,
// `width: 100%`, `white-space: nowrap`, and which `@media` block they lived
// in). That is a source-text grep (a HOW-test): a behaviour-preserving restyle
// — e.g. centring via `display: flex; justify-content: center` instead of
// `text-align: center` — leaves the rendered title identical yet trips the
// grep. The visual centring is exercised by the pa11y gate over the rendered
// dashboard; the enduring contract these unit tests verify is that the section
// headings carry the `h5.card-title` hook the centring rule targets.

import { assert } from "@std/assert";

const INDEX = "docs/index.html";

Deno.test("index.html: section titles carry the card-title hook", async () => {
  const html = await Deno.readTextFile(INDEX);
  assert(
    html.includes("Market Performance Comparison"),
    "the Market Performance Comparison section must exist",
  );
  // The Market Performance Comparison heading carries the `card-title` class on
  // a heading element (h3 since issue #695). (Issue #605 removed the
  // "Individual Stock Performance" heading.)
  const titles = html.match(/<h[1-6][^>]*class="[^"]*card-title[^"]*"/g) ?? [];
  assert(
    titles.length >= 1,
    "section headings must carry the .card-title hook so the centring rule applies",
  );
});
