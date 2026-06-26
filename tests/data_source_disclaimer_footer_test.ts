// Tests for relocating the Yahoo Finance data-source disclaimer into the
// page footer (issue #566).
//
// The compact attribution note previously rendered in the middle of the page,
// inside the market-index comparison card. The issue asks for it to live in
// the page footer instead. These assertions read the REAL committed
// docs/index.html so they verify the rendered placement, not the method.

import { assert, assertStringIncludes } from "@std/assert";

const INDEX = "docs/index.html";

const ATTRIBUTION =
  "Market data is fetched from Yahoo Finance and shows performance from the score date to current date.";

/** Return the substring of `html` between the page `<footer ...>` opening tag
 * and its matching `</footer>` close. */
function footerMarkup(html: string): string {
  const open = html.indexOf("<footer");
  assert(open !== -1, "page must have a <footer> element");
  const openEnd = html.indexOf(">", open);
  const close = html.indexOf("</footer>", openEnd);
  assert(close !== -1, "<footer> must be closed");
  return html.slice(openEnd + 1, close);
}

Deno.test("index.html: attribution lives inside the page footer", async () => {
  const html = await Deno.readTextFile(INDEX);
  const footer = footerMarkup(html);
  assertStringIncludes(
    footer,
    ATTRIBUTION,
    "the Yahoo Finance attribution must render inside the page <footer>",
  );
});

Deno.test("index.html: attribution no longer sits in the market-index card", async () => {
  const html = await Deno.readTextFile(INDEX);
  // The attribution text must appear exactly once, and after the footer opens,
  // so it cannot also remain in the market-index comparison card above.
  const occurrences = html.split(ATTRIBUTION).length - 1;
  assert(
    occurrences === 1,
    `attribution must appear exactly once; found ${occurrences}`,
  );
  const footerOpen = html.indexOf("<footer");
  const attributionAt = html.indexOf(ATTRIBUTION);
  assert(
    attributionAt > footerOpen,
    "attribution must appear after the footer opens, not in the page body",
  );
});
