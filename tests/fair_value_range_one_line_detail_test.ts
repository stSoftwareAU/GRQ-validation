// Tests for keeping the Fair Value Range value on ONE line in the stock detail
// panel (issue #538).
//
// On a ~375px phone the detail panel's Fair Value Range value shares a `col-6`
// cell with the label opposite it. The range string `$179.77...$198.93` was
// breaking mid-number ("$198.9" / "3") even though the half-row cell has ample
// room for the run. The fix mirrors the Buy Price precedent (issue #383): the
// value cell gets a `fair-value-cell` class pinned to `white-space: nowrap` so
// the range never wraps.
//
// Pure-CSS/markup layout is verified by reading docs/app.js and docs/styles.css
// and asserting on the relevant markup hooks and rule bodies — the same approach
// used by buy_price_one_line_detail_test.ts.

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

Deno.test("app.js: detail-panel Fair Value Range value cell carries the fair-value-cell hook", async () => {
  const js = await Deno.readTextFile(APP);
  // The value `col-6` that holds the Fair Value Range must carry the class the
  // nowrap CSS targets.
  assert(
    /col-6 fair-value-cell"|fair-value-cell col-6"/.test(js),
    "the Fair Value Range value col-6 must include the fair-value-cell class",
  );
});

Deno.test("styles.css: fair-value-cell is pinned to white-space: nowrap", async () => {
  const css = await Deno.readTextFile(STYLES);
  const body = ruleBody(css, "#stockDetailCard .fair-value-cell");
  assert(body, "#stockDetailCard .fair-value-cell rule must exist");
  assert(
    /white-space\s*:\s*nowrap/i.test(body as string),
    "fair-value-cell must set white-space: nowrap so the range never wraps",
  );
});
