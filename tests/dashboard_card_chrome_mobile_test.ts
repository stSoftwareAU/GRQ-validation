// Tests for flattening dashboard card chrome on mobile (issue #317, part of
// milestone #307 — give data more room on phones).
//
// Each dashboard section is a Bootstrap `.card` with a 1px border and
// 0.375rem rounded corners, and the outer wrapper adds `shadow-sm`
// (docs/index.html:109). On a phone the borders, rounded corners and drop
// shadow box the figures/tables in and waste edge space.
//
// These assertions pin the mobile-only CSS so the section cards read flat
// (no/minimal border, no rounded corners, no drop shadow), while
// desktop/tablet (>=768px) rendering is untouched.
//
// Pure-CSS layout is verified by reading docs/styles.css and asserting on the
// relevant rule bodies within the mobile media block — the same approach used
// by dashboard_section_spacing_mobile_test.ts and header_banner_mobile_test.ts.

import { assert } from "@std/assert";

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

/**
 * Concatenate the bodies of EVERY `@media (...)` block matching `query`, or
 * null when none exist. styles.css splits its mobile rules across several
 * `@media (max-width: 768px)` blocks, so all must be considered.
 */
function mediaBlock(css: string, query: string): string | null {
  const needle = `@media ${query}`;
  const bodies: string[] = [];
  let from = 0;
  for (;;) {
    const head = css.indexOf(needle, from);
    if (head === -1) break;
    const open = css.indexOf("{", head);
    if (open === -1) break;
    let depth = 0;
    let end = -1;
    for (let i = open; i < css.length; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) break;
    bodies.push(css.slice(open + 1, end));
    from = end + 1;
  }
  return bodies.length ? bodies.join("\n") : null;
}

Deno.test("styles.css: mobile .card border-radius is flattened to 0", async () => {
  const css = await Deno.readTextFile(STYLES);
  const block = mediaBlock(css, "(max-width: 768px)");
  assert(block, "a (max-width: 768px) mobile media block must exist");
  const body = ruleBody(block, ".card");
  assert(body, ".card must be styled in the mobile block");
  const m = body.match(/border-radius\s*:\s*(-?[0-9.]+)\s*(rem|px)?/i);
  assert(m, "mobile .card must set border-radius");
  assert(
    parseFloat(m[1]) === 0,
    `mobile .card border-radius (${m[1]}${
      m[2] ?? ""
    }) must be 0 so corners read flat`,
  );
});

Deno.test("styles.css: mobile .card border is removed or softened", async () => {
  const css = await Deno.readTextFile(STYLES);
  const block = mediaBlock(css, "(max-width: 768px)");
  assert(block);
  const body = ruleBody(block, ".card");
  assert(body, ".card must be styled in the mobile block");
  assert(
    /border\s*:\s*none/i.test(body) || /border\s*:\s*0/i.test(body),
    "mobile .card must remove its border (border: none/0)",
  );
});

Deno.test("styles.css: mobile .shadow-sm drop shadow is removed", async () => {
  const css = await Deno.readTextFile(STYLES);
  const block = mediaBlock(css, "(max-width: 768px)");
  assert(block);
  const body = ruleBody(block, ".shadow-sm");
  assert(
    body,
    ".shadow-sm must be styled in the mobile block so the outer drop shadow is dropped",
  );
  assert(
    /box-shadow\s*:\s*none/i.test(body),
    "mobile .shadow-sm must set box-shadow: none to drop the outer drop shadow",
  );
  assert(
    /box-shadow:[^;]*!important/i.test(body),
    "box-shadow must use !important to override Bootstrap's .shadow-sm utility",
  );
});

/** Remove every `@media (max-width: 768px)` block, returning the remainder. */
function withoutMobileBlocks(css: string): string {
  const needle = "@media (max-width: 768px)";
  let out = css;
  for (;;) {
    const head = out.indexOf(needle);
    if (head === -1) break;
    const open = out.indexOf("{", head);
    if (open === -1) break;
    let depth = 0;
    let end = -1;
    for (let i = open; i < out.length; i++) {
      if (out[i] === "{") depth++;
      else if (out[i] === "}") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) break;
    out = out.slice(0, head) + out.slice(end + 1);
  }
  return out;
}

Deno.test("styles.css: card chrome overrides are confined to the mobile block", async () => {
  const css = await Deno.readTextFile(STYLES);
  // Outside the mobile media blocks there must be no .shadow-sm override, so
  // desktop/tablet (>=768px) rendering is unchanged.
  const nonMobile = withoutMobileBlocks(css);
  assert(
    !/\.shadow-sm\s*\{/.test(nonMobile),
    "there must be no non-mobile .shadow-sm rule (mobile-only override)",
  );
  const desktop = mediaBlock(css, "(min-width: 768px)");
  if (desktop) {
    assert(
      ruleBody(desktop, ".shadow-sm") === null,
      "the desktop block must not retune card chrome",
    );
  }
});

Deno.test("index.html: card-header titles and section markup remain intact", async () => {
  const html = await Deno.readTextFile(INDEX);
  assert(
    html.includes("Market Performance Comparison"),
    "the market-comparison card-header title must remain",
  );
  assert(
    html.includes("Individual Stock Performance"),
    "the stock-table card-header title must remain",
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
