// Tests for keeping Buy Price + the full 5-moon rating on ONE line in the
// stock detail panel (issue #383, sub-issue of milestone #337).
//
// On a ~375px phone the detail panel's Buy Price value and its moon rating
// share a single `col-6` cell, so `$XX.XX 🌕🌕🌕🌕🌕` wraps onto a second line.
// The fix is pure CSS + a markup hook: the value cell gets a `buy-price-cell`
// class pinned to `white-space: nowrap`, and the rating span gets a
// `star-rating` class rendered compactly so 5 moons + the price fit one line.
//
// Pure-CSS/markup layout is verified by reading docs/app.js and docs/styles.css
// and asserting on the relevant markup hooks and rule bodies — the same approach
// used by header_banner_mobile_test.ts and dashboard_section_spacing_mobile_test.ts.

import { assert } from "@std/assert";

const APP = "docs/app.js";
const STYLES = "docs/styles.css";

/**
 * Return the body of the FIRST top-level CSS rule for `selector` found within
 * `css`, or null when absent. Brace-aware. `selector` is matched literally at a
 * rule head (i.e. immediately followed by " {").
 */
function ruleBody(css: string, selector: string): string | null {
  const head = css.indexOf(selector + " {");
  if (head === -1) return null;
  const open = css.indexOf("{", head);
  const close = css.indexOf("}", open);
  if (open === -1 || close === -1) return null;
  return css.slice(open + 1, close);
}

/** Parse a unit-less or em multiplier for `prop` from a declaration body. */
function emOf(body: string, prop: string): number | null {
  const m = body.match(new RegExp(`${prop}\\s*:\\s*(-?[0-9.]+)\\s*em`, "i"));
  return m ? parseFloat(m[1]) : null;
}

Deno.test("app.js: detail-panel Buy Price value cell carries the buy-price-cell hook", async () => {
  const js = await Deno.readTextFile(APP);
  // The value `col-6` that holds the price + rating must carry the class the
  // nowrap CSS targets.
  assert(
    /col-6 buy-price-cell"|buy-price-cell col-6"/.test(js),
    "the Buy Price value col-6 must include the buy-price-cell class",
  );
});

Deno.test("app.js: detail-panel rating span carries the star-rating hook", async () => {
  const js = await Deno.readTextFile(APP);
  // The stars span (data-field=\"stars\") inside the detail panel must carry the
  // star-rating class so it can be rendered compactly.
  const starsSpans = js.match(/<span[^>]*data-field="stars"[^>]*>/g) ?? [];
  assert(starsSpans.length > 0, "a stars span must exist");
  assert(
    starsSpans.some((s) => /class="[^"]*\bstar-rating\b[^"]*"/.test(s)),
    "the detail-panel stars span must include the star-rating class",
  );
});

Deno.test("styles.css: buy-price-cell is pinned to white-space: nowrap", async () => {
  const css = await Deno.readTextFile(STYLES);
  const body = ruleBody(css, "#stockDetailCard .buy-price-cell");
  assert(body, "#stockDetailCard .buy-price-cell rule must exist");
  assert(
    /white-space\s*:\s*nowrap/i.test(body as string),
    "buy-price-cell must set white-space: nowrap so price + moons never wrap",
  );
});

Deno.test("styles.css: the moon run is rendered compactly so 5 moons + price fit", async () => {
  const css = await Deno.readTextFile(STYLES);
  const body = ruleBody(css, "#stockDetailCard .buy-price-cell .star-rating");
  assert(
    body,
    "#stockDetailCard .buy-price-cell .star-rating rule must exist",
  );
  const fontEm = emOf(body as string, "font-size");
  const spacingEm = emOf(body as string, "letter-spacing");
  assert(
    fontEm !== null && (fontEm as number) < 1,
    `star-rating font-size (${fontEm}em) must be smaller than 1em to compact the glyphs`,
  );
  assert(
    spacingEm !== null && (spacingEm as number) < 0,
    `star-rating letter-spacing (${spacingEm}em) must be negative to tighten the run`,
  );
});

Deno.test("app.js: detail panel and table render the rating via the same getStarRatingDisplay", async () => {
  const js = await Deno.readTextFile(APP);
  // Acceptance: keep the rating output consistent with the table render.
  const calls = js.match(/getStarRatingDisplay\(stock\.stock\)/g) ?? [];
  assert(
    calls.length >= 2,
    "both the detail panel and the table must source the rating from getStarRatingDisplay(stock.stock)",
  );
});
