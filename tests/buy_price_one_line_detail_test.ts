// Tests for keeping Buy Price + the full 5-moon rating on ONE line in the
// stock detail panel (issue #383, sub-issue of milestone #337).
//
// On a ~375px phone the detail panel's Buy Price value and its moon rating
// share a single `col-6` cell, so `$XX.XX 🌕🌕🌕🌕🌕` wraps onto a second line.
// The fix is pure CSS + a markup hook: the value cell gets a `buy-price-cell`
// class pinned to `white-space: nowrap`, and the rating span gets a
// `star-rating` class rendered compactly so 5 moons + the price fit one line.
//
// The markup hooks the layout depends on are verified by reading docs/app.js
// and asserting on the rendered template — the same approach used by
// header_banner_mobile_test.ts.
//
// Issue #632: the former "buy-price-cell is pinned to white-space: nowrap" and
// "the moon run is rendered compactly" assertions were source-text greps over
// docs/styles.css (pinning the `white-space`, `font-size` and `letter-spacing`
// declarations). A behaviour-preserving restyle that kept the price + moons on
// one line by other means — a wider column, a smaller glyph via `transform`,
// etc. — would trip them without changing what the user sees. The one-line
// rendering is exercised by the pa11y visual gate at mobile viewports; the
// markup-hook contracts below are what these unit tests verify.

import { assert } from "@std/assert";

const APP = "docs/app.js";

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

Deno.test("app.js: detail panel and table render the rating via the same getStarRatingDisplay", async () => {
  const js = await Deno.readTextFile(APP);
  // Acceptance: keep the rating output consistent with the table render.
  const calls = js.match(/getStarRatingDisplay\(stock\.stock\)/g) ?? [];
  assert(
    calls.length >= 2,
    "both the detail panel and the table must source the rating from getStarRatingDisplay(stock.stock)",
  );
});

// --- Issue #549: freshness emoji beside the star rating in the mobile detail card ---
//
// The detail card's compact `.star-rating` span must render the fair-value
// freshness indicator (issue #547) before the moon glyphs, e.g. "🌺 🌕🌕🌕🌕🌕"
// (order flipped to freshness-then-stars for issue #623), mirroring the
// aggregate table cell (issue #548). The freshness prefix is guarded so an
// empty indicator (N/A stars) adds no stray space, and the whole star block is
// already hidden when there is no analysis data — so no emoji renders for N/A.

/** Return the `.star-rating` <span>…</span> markup from the detail card. */
function detailStarRatingSpan(js: string): string | null {
  const m = js.match(
    /<span class="clickable-value star-rating"[\s\S]*?<\/span>/,
  );
  return m ? m[0] : null;
}

Deno.test("app.js: detail-panel star-rating span prepends a guarded freshness indicator", async () => {
  const js = await Deno.readTextFile(APP);
  const span = detailStarRatingSpan(js);
  assert(span, "the detail-panel star-rating span must exist");
  // The freshness emoji is rendered inside the star-rating span, right before
  // the moons, guarded so an empty indicator adds no stray space (issue #623).
  assert(
    /getFreshnessIndicator\(stock\.stock\)\s*\?[\s\S]*?""\}\$\{this\.getStarRatingDisplay\(stock\.stock\)\}/
      .test(span as string),
    "detail card must prepend a guarded getFreshnessIndicator(stock.stock) before the stars",
  );
});

Deno.test("app.js: detail-panel freshness emoji stays inside the star block guard", async () => {
  const js = await Deno.readTextFile(APP);
  // The whole star block (span + emoji) sits behind the `getStarRatingDisplay
  // ? … : ''` guard, so nothing — neither moons nor emoji — renders for N/A.
  const guarded = js.match(
    /\$\{this\.getStarRatingDisplay\(stock\.stock\)\s*\?\s*`[\s\S]*?star-rating[\s\S]*?getFreshnessIndicator\(stock\.stock\)[\s\S]*?`\s*:\s*''\}/,
  );
  assert(
    guarded,
    "the freshness emoji must live inside the star block's truthiness guard so N/A renders nothing",
  );
});
