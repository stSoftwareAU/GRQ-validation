// Tests for reducing the detail card's left (label) column width so the Buy
// Price value and its star rating get more horizontal room (issue #611).
//
// On a ~375px phone the stock detail card lays each fact out as a `.row.mb-2`
// with two equal `.col-6` cells: the label on the left, the value on the right.
// The 50/50 split pushes the value cell to start at the half-way mark, so
// `$XX.XX 🌺 🌕🌕🌕🌕🌕` (Buy Price + freshness + stars) clips off the right
// edge. The fix narrows the left label column below 50% and widens the value
// column above 50% on mobile, reclaiming the wasted left space for the value.
//
// Pure-CSS layout is verified by reading docs/styles.css and asserting on the
// relevant rule bodies — the same approach used by
// dashboard_horizontal_margins_test.ts and buy_price_one_line_detail_test.ts.

import { assert } from "@std/assert";

const STYLES = "docs/styles.css";

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

/**
 * Find the FIRST rule within `scope` whose selector list contains `selector`
 * and return its declaration body. Rule bodies here contain no nested braces.
 */
function ruleBodyContaining(scope: string, selector: string): string | null {
  const idx = scope.indexOf(selector);
  if (idx === -1) return null;
  const open = scope.indexOf("{", idx);
  const close = scope.indexOf("}", open);
  if (open === -1 || close === -1) return null;
  return scope.slice(open + 1, close);
}

/** Parse a percentage value for `prop` from a declaration body. */
function percentOf(body: string, prop: string): number | null {
  const m = body.match(new RegExp(`${prop}\\s*:\\s*([0-9.]+)\\s*%`, "i"));
  return m ? parseFloat(m[1]) : null;
}

Deno.test("styles.css: mobile detail-card label column is narrowed below 50%", async () => {
  const css = await Deno.readTextFile(STYLES);
  const block = mediaBlock(css, "(max-width: 768px)");
  assert(block, "a (max-width: 768px) mobile media block must exist");
  const body = ruleBodyContaining(
    block,
    "#stockDetailCard .row .row > .col-6:first-child",
  );
  assert(
    body,
    "the detail card's label (first) col-6 must be width-tuned on mobile",
  );
  const width = percentOf(body, "width");
  assert(width !== null, "the label column must set an explicit width");
  assert(
    (width as number) < 50,
    `label column width (${width}%) must be narrower than the default 50% to free room for the value`,
  );
});

Deno.test("styles.css: mobile detail-card value column is widened above 50%", async () => {
  const css = await Deno.readTextFile(STYLES);
  const block = mediaBlock(css, "(max-width: 768px)");
  assert(block);
  const body = ruleBodyContaining(
    block,
    "#stockDetailCard .row .row > .col-6:last-child",
  );
  assert(
    body,
    "the detail card's value (last) col-6 must be width-tuned on mobile",
  );
  const width = percentOf(body, "width");
  assert(width !== null, "the value column must set an explicit width");
  assert(
    (width as number) > 50,
    `value column width (${width}%) must be wider than the default 50% so the Buy Price + stars fit`,
  );
});

Deno.test("styles.css: detail-card label and value columns still sum to the full row width", async () => {
  const css = await Deno.readTextFile(STYLES);
  const block = mediaBlock(css, "(max-width: 768px)");
  assert(block);
  const labelBody = ruleBodyContaining(
    block,
    "#stockDetailCard .row .row > .col-6:first-child",
  );
  const valueBody = ruleBodyContaining(
    block,
    "#stockDetailCard .row .row > .col-6:last-child",
  );
  assert(labelBody && valueBody);
  const label = percentOf(labelBody as string, "width");
  const value = percentOf(valueBody as string, "width");
  assert(label !== null && value !== null);
  assert(
    Math.abs((label as number) + (value as number) - 100) < 1e-9,
    `label (${label}%) + value (${value}%) must total 100% so the row neither overflows nor underfills`,
  );
});
