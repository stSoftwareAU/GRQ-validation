// Tests for striking out excluded stock rows on the dashboard (issue #290,
// part of the exclusion milestone #270).
//
// An excluded stock — one that fails the shared inclusion predicate
// `isStockIncluded` (missing/non-positive buy OR current price) — is dropped
// from EVERY portfolio calculation. Issue #290 signals this on the aggregate
// table by adding an `excluded-stock` class to the stock's <tr>, which the
// stylesheet renders with `text-decoration: line-through`.
//
// Two things are pinned here:
//   1. The row-exclusion DECISION mirrors the production predicate
//      (isStockIncluded), exercised through the REAL shipped helper so the
//      strikethrough cannot drift from what the portfolio maths excludes.
//   2. The CSS DELIVERABLE: `.excluded-stock` strikes the row through and is
//      theme-safe — it must NOT dim the text (no contrast-reducing opacity),
//      so the row keeps the same WCAG 2 AA contrast as a normal row in both
//      the light and dark themes (coordinates with issue #281).
//
// Pure-CSS assertions read docs/styles.css and inspect the relevant rule body,
// the same approach used by section_title_centring_test.ts and
// chart_color_key_test.ts.

import { assert, assertEquals, assertMatch } from "@std/assert";
import "../docs/projection.js";

const STYLES = "docs/styles.css";

const g = globalThis as unknown as {
  GRQProjection: {
    isStockIncluded: (
      buyPrice: number | null | undefined,
      currentPrice: number | null | undefined,
      splitReliable?: boolean,
    ) => boolean;
  };
};
const GRQProjection = g.GRQProjection;

/**
 * The class list the aggregate row receives for a given (buyPrice, currentPrice)
 * pair, mirroring docs/app.js: an excluded stock (per the shared predicate)
 * gets the `excluded-stock` strikethrough class; an included one does not.
 */
function rowClassesFor(
  buyPrice: number | null,
  currentPrice: number | null,
): string[] {
  return GRQProjection.isStockIncluded(buyPrice, currentPrice)
    ? []
    : ["excluded-stock"];
}

/**
 * Return the body of the FIRST top-level CSS rule for `selector`, or null.
 * Brace-aware so a later/nested rule is not mistaken for the block.
 */
function ruleBody(css: string, selector: string): string | null {
  const head = css.indexOf(selector + " {");
  if (head === -1) return null;
  const open = css.indexOf("{", head);
  const close = css.indexOf("}", open);
  if (open === -1 || close === -1) return null;
  return css.slice(open + 1, close);
}

// --- Row-exclusion decision -------------------------------------------------

Deno.test("excluded row - included stock is NOT struck through", () => {
  assertEquals(rowClassesFor(10.5, 12.0), []);
});

Deno.test("excluded row - missing buy price is struck through", () => {
  assertEquals(rowClassesFor(null, 12.0), ["excluded-stock"]);
});

Deno.test("excluded row - missing current price is struck through", () => {
  assertEquals(rowClassesFor(10.5, null), ["excluded-stock"]);
});

Deno.test("excluded row - non-positive prices are struck through", () => {
  assertEquals(rowClassesFor(0, 12.0), ["excluded-stock"]);
  assertEquals(rowClassesFor(10.5, 0), ["excluded-stock"]);
});

// --- CSS deliverable --------------------------------------------------------

Deno.test("styles.css: excluded rows are struck through", async () => {
  const css = await Deno.readTextFile(STYLES);
  const body = ruleBody(css, ".excluded-stock td") ??
    ruleBody(css, ".excluded-stock");
  assert(body, ".excluded-stock rule must exist");
  assertMatch(
    body,
    /text-decoration:\s*line-through/i,
    "excluded rows must be struck through",
  );
});

Deno.test("styles.css: strikethrough is theme-safe (no contrast-reducing dim)", async () => {
  const css = await Deno.readTextFile(STYLES);
  const body = (ruleBody(css, ".excluded-stock td") ?? "") +
    (ruleBody(css, ".excluded-stock") ?? "");
  assert(body.length > 0, ".excluded-stock rule must exist");
  // Dimming the text (opacity < 1) would lower the contrast ratio and risk
  // failing WCAG 2 AA in one or both themes. The strikethrough must keep the
  // inherited theme text colour at full strength.
  const opacityMatch = body.match(/opacity:\s*([0-9.]+)/i);
  if (opacityMatch) {
    assert(
      parseFloat(opacityMatch[1]) >= 1,
      "excluded-stock must not dim text (opacity < 1) — it would break AA contrast",
    );
  }
});
