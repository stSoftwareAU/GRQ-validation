// Tests for shrinking the dashboard header banner on mobile (issue #315,
// part of milestone #307 — reclaim vertical space on phones).
//
// The top banner `div.card-header.header-gradient ... py-4` uses Bootstrap's
// `py-4` (1.5rem top/bottom padding) with an `h1.display-4` title and a
// `p.lead` subtitle. On a phone this gradient banner eats a large slice of the
// first screen before any data shows. These assertions pin the mobile-only CSS
// so the banner's vertical footprint shrinks (smaller padding, title and
// subtitle) while the desktop/tablet layout is untouched.
//
// Pure-CSS layout is verified by reading docs/styles.css and asserting on the
// relevant rule bodies within the mobile media block — the same approach used
// by section_title_centring_test.ts and chart_color_key_test.ts.

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

/** Parse a rem length from a declaration body for the given property. */
function lengthOf(body: string, prop: string): number | null {
  const m = body.match(new RegExp(`${prop}\\s*:\\s*([0-9.]+)\\s*rem`, "i"));
  return m ? parseFloat(m[1]) : null;
}

Deno.test("styles.css: mobile banner reduces vertical padding below py-4 (1.5rem)", async () => {
  const css = await Deno.readTextFile(STYLES);
  const block = mediaBlock(css, "(max-width: 768px)");
  assert(block, "a (max-width: 768px) mobile media block must exist");
  const body = ruleBody(block, ".card-header.header-gradient");
  assert(
    body,
    ".card-header.header-gradient must be styled in the mobile block",
  );
  const top = lengthOf(body, "padding-top");
  const bottom = lengthOf(body, "padding-bottom");
  assert(top !== null, "mobile banner must set padding-top");
  assert(bottom !== null, "mobile banner must set padding-bottom");
  assert(
    (top as number) < 1.5 && (bottom as number) < 1.5,
    "mobile banner padding must be smaller than the py-4 1.5rem default",
  );
  assertMatch(
    body,
    /padding-top:[^;]*!important/i,
    "padding must use !important to override Bootstrap's py-4 utility",
  );
});

Deno.test("styles.css: mobile banner shrinks the display-4 title", async () => {
  const css = await Deno.readTextFile(STYLES);
  const block = mediaBlock(css, "(max-width: 768px)");
  assert(block);
  const body = ruleBody(block, ".header-gradient .display-4");
  assert(
    body,
    ".header-gradient .display-4 must be styled in the mobile block",
  );
  const size = lengthOf(body, "font-size");
  assert(size !== null, "mobile title must set a font-size");
  // Bootstrap's .display-4 is ~3.5rem; mobile must be noticeably smaller.
  assert(
    (size as number) < 3.5,
    "mobile title font-size must be smaller than the desktop display-4",
  );
});

Deno.test("styles.css: mobile banner shrinks the lead subtitle", async () => {
  const css = await Deno.readTextFile(STYLES);
  const block = mediaBlock(css, "(max-width: 768px)");
  assert(block);
  const body = ruleBody(block, ".header-gradient .lead");
  assert(body, ".header-gradient .lead must be styled in the mobile block");
  const size = lengthOf(body, "font-size");
  assert(size !== null, "mobile subtitle must set a font-size");
  // Bootstrap's .lead is ~1.25rem; mobile must condense it.
  assert(
    (size as number) < 1.25,
    "mobile subtitle font-size must be smaller than the desktop lead",
  );
});

Deno.test("styles.css: desktop/tablet banner sizing is left untouched", async () => {
  const css = await Deno.readTextFile(STYLES);
  // The banner overrides must be confined to the mobile media query: the base
  // rules must not shrink the banner, so >=768px rendering is unchanged.
  const base = ruleBody(css, ".header-gradient");
  assert(base, ".header-gradient base rule must exist");
  assert(
    !/font-size/i.test(base),
    "the base .header-gradient rule must not set a font-size (desktop unchanged)",
  );
  const desktop = mediaBlock(css, "(min-width: 768px)");
  if (desktop) {
    assert(
      ruleBody(desktop, ".card-header.header-gradient") === null,
      "the desktop block must not shrink the banner",
    );
  }
});

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
  assertMatch(
    html,
    /class="card-header header-gradient[^"]*py-4/,
    "the banner keeps its header-gradient/py-4 markup (shrunk via CSS only)",
  );
});
