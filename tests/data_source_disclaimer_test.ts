// Tests for compacting the Yahoo Finance data-source disclaimer (issue #280,
// part of milestone #269 item H).
//
// The attribution previously rendered as a full-width `alert alert-info`
// banner that wasted vertical space. It must stay discoverable (Yahoo Finance
// terms generally require source attribution) but in a compact footer note,
// not a banner. These assertions read the REAL committed docs/index.html and
// docs/styles.css — the same file-reading approach used by
// section_title_centring_test.ts.

import { assert, assertMatch, assertStringIncludes } from "@std/assert";

const INDEX = "docs/index.html";
const STYLES = "docs/styles.css";

const ATTRIBUTION =
  "Market data is fetched from Yahoo Finance and shows performance from the score date to current date.";

/** Return the element markup containing `needle`, walking out to the nearest
 * enclosing `<div ...>` opening tag, so we can inspect its classes. */
function enclosingDivClasses(html: string, needle: string): string {
  const at = html.indexOf(needle);
  assert(at !== -1, `attribution text must be present in ${INDEX}`);
  // Walk backwards to the most recent <div ...> opening tag.
  const open = html.lastIndexOf("<div", at);
  assert(open !== -1, "attribution must live inside a <div>");
  const close = html.indexOf(">", open);
  return html.slice(open, close + 1);
}

Deno.test("index.html: Yahoo Finance attribution is still present in the DOM", async () => {
  const html = await Deno.readTextFile(INDEX);
  assertStringIncludes(
    html,
    ATTRIBUTION,
    "the Yahoo Finance attribution text must remain discoverable",
  );
});

Deno.test("index.html: attribution is no longer a full-width alert banner", async () => {
  const html = await Deno.readTextFile(INDEX);
  const classes = enclosingDivClasses(html, ATTRIBUTION);
  assert(
    !/alert/.test(classes),
    `attribution must not sit in an alert banner; found: ${classes}`,
  );
});

Deno.test("index.html: attribution uses the compact data-source-note", async () => {
  const html = await Deno.readTextFile(INDEX);
  const classes = enclosingDivClasses(html, ATTRIBUTION);
  assertMatch(
    classes,
    /data-source-note/,
    "attribution must render as the compact .data-source-note footer",
  );
});

Deno.test("styles.css: compact note keeps a small footnote font-size", async () => {
  const css = await Deno.readTextFile(STYLES);
  const head = css.indexOf(".data-source-note {");
  assert(head !== -1, ".data-source-note rule must exist");
  const open = css.indexOf("{", head);
  const closeBrace = css.indexOf("}", open);
  const body = css.slice(open + 1, closeBrace);
  assertMatch(
    body,
    /font-size:/i,
    "the compact note must pin a small footnote font-size",
  );
});
