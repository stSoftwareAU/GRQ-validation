// Tests for centring dashboard section/card titles on one line and using the
// full available width (issue #277, part of milestone #269 item C).
//
// Section titles such as "Market Performance Comparison" live in a
// `.card-header` as an `h5.card-title`. They were left-aligned and wasted the
// container width. These assertions pin the CSS so the titles are centred,
// span the full width, and stay on a single line at desktop widths while
// remaining free to wrap on narrow/mobile screens (no responsive regression).
//
// Pure-CSS layout is verified by reading docs/styles.css and asserting on the
// relevant rule bodies — the same approach used by chart_color_key_test.ts.

import { assert, assertMatch } from "@std/assert";

const INDEX = "docs/index.html";
const STYLES = "docs/styles.css";

/**
 * Return the body of the FIRST top-level CSS rule for `selector` found within
 * `css`, or null when absent. Brace-aware so a nested rule below is not
 * mistaken for the block. `selector` is matched literally at a rule head.
 */
function ruleBody(css: string, selector: string): string | null {
  const head = css.indexOf(selector + " {");
  if (head === -1) return null;
  const open = css.indexOf("{", head);
  const close = css.indexOf("}", open);
  if (open === -1 || close === -1) return null;
  return css.slice(open + 1, close);
}

/** Extract the body of the named `@media (...)` block, or null when absent. */
function mediaBlock(css: string, query: string): string | null {
  const head = css.indexOf(`@media ${query}`);
  if (head === -1) return null;
  const open = css.indexOf("{", head);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  return null;
}

Deno.test("styles.css: card titles are centred", async () => {
  const css = await Deno.readTextFile(STYLES);
  const body = ruleBody(css, ".card-header .card-title");
  assert(body, ".card-header .card-title rule must exist");
  assertMatch(
    body,
    /text-align:\s*center/i,
    "section/card titles must be centred",
  );
});

Deno.test("styles.css: card titles use the full available width", async () => {
  const css = await Deno.readTextFile(STYLES);
  const body = ruleBody(css, ".card-header .card-title");
  assert(body);
  assertMatch(
    body,
    /width:\s*100%/i,
    "the title must span the full container width so it centres across it",
  );
});

Deno.test("styles.css: card titles stay on one line at desktop widths", async () => {
  const css = await Deno.readTextFile(STYLES);
  const block = mediaBlock(css, "(min-width: 768px)");
  assert(block, "a (min-width: 768px) desktop media block must exist");
  const body = ruleBody(block, ".card-header .card-title");
  assert(body, ".card-header .card-title must be styled in the desktop block");
  assertMatch(
    body,
    /white-space:\s*nowrap/i,
    "at desktop widths the title must not wrap (single line)",
  );
});

Deno.test("styles.css: card titles may wrap on narrow/mobile widths", async () => {
  const css = await Deno.readTextFile(STYLES);
  // The nowrap must be confined to the desktop media query; the base rule must
  // not force nowrap, so narrow screens keep the title readable by wrapping.
  const body = ruleBody(css, ".card-header .card-title");
  assert(body);
  assert(
    !/white-space:\s*nowrap/i.test(body),
    "the base rule must not force nowrap, so titles can wrap on mobile",
  );
});

Deno.test("index.html: section titles carry the card-title hook", async () => {
  const html = await Deno.readTextFile(INDEX);
  assert(
    html.includes("Market Performance Comparison"),
    "the Market Performance Comparison section must exist",
  );
  // Both section headings the issue calls out use h5.card-title in a header.
  const titles = html.match(/<h5 class="card-title[^"]*">/g) ?? [];
  assert(
    titles.length >= 2,
    "section headings must use h5.card-title so the centring rule applies",
  );
});
