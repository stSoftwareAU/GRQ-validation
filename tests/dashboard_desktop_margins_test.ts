// Tests for reducing the DESKTOP left/right margins so the data — score tables
// and the performance chart — gets more horizontal room (issue #559, milestone
// #545).
//
// Mobile margins were already trimmed by #316/#382 (see
// dashboard_horizontal_margins_test.ts). On tablet/desktop widths the dashboard
// still carried Bootstrap's full insets stacked together:
//   * `.container-fluid` — 0.75rem each side;
//   * the `.row` / column gutters (0.75rem);
//   * `#card-body.p-4` — Bootstrap p-4 (1.5rem).
//
// These assertions pin the CSS so that at desktop widths (min-width: 769px):
//   * the outer container-fluid side padding is trimmed below 0.75rem;
//   * the outer `.col-12` page wrapper padding is tightened to cancel the
//     trimmed row gutter (so content stays aligned, never overflows);
//   * the dashboard `.card-body.p-4` HORIZONTAL padding is reduced below the
//     1.5rem default while keeping comfortable vertical padding;
//   * the wide-desktop max-width cap is widened so genuinely wide monitors
//     reclaim side margin for the data.
//
// Pure-CSS layout is verified by reading docs/styles.css and asserting on the
// relevant rule bodies — the same approach used by
// dashboard_horizontal_margins_test.ts.

import { assert } from "@std/assert";

const STYLES = "docs/styles.css";

/** Body of the FIRST top-level CSS rule for `selector`, or null when absent. */
function ruleBody(css: string, selector: string): string | null {
  const head = css.indexOf(selector + " {");
  if (head === -1) return null;
  const open = css.indexOf("{", head);
  const close = css.indexOf("}", open);
  if (open === -1 || close === -1) return null;
  return css.slice(open + 1, close);
}

/** Concatenate the bodies of EVERY `@media (...)` block matching `query`. */
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

/** Parse a rem length from a declaration body for the given property. */
function lengthOf(body: string, prop: string): number | null {
  const m = body.match(new RegExp(`${prop}\\s*:\\s*(-?[0-9.]+)\\s*rem`, "i"));
  return m ? parseFloat(m[1]) : null;
}

/** Body of the rule whose comma-separated selector list contains `selector`. */
function selectorListRuleBody(scope: string, selector: string): string | null {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = scope.match(
    new RegExp(`([^{}]*${esc}\\b[^{}]*)\\{([^{}]*)\\}`),
  );
  return m ? m[2] : null;
}

Deno.test("styles.css: desktop .container-fluid side padding is trimmed below Bootstrap's 0.75rem", async () => {
  const css = await Deno.readTextFile(STYLES);
  const block = mediaBlock(css, "(min-width: 769px)");
  assert(block, "a (min-width: 769px) desktop media block must exist");
  const body = ruleBody(block, ".container-fluid");
  assert(
    body,
    ".container-fluid must be tightened in the desktop block to reclaim the outer side margin",
  );
  const left = lengthOf(body, "padding-left");
  const right = lengthOf(body, "padding-right");
  assert(
    left !== null && right !== null,
    "must set padding-left and padding-right",
  );
  assert(
    (left as number) < 0.75 && (right as number) < 0.75,
    `desktop .container-fluid side padding (${left}rem / ${right}rem) must be smaller than Bootstrap's 0.75rem`,
  );
});

Deno.test("styles.css: desktop .col-12 wrapper padding cancels the trimmed row gutter (no overflow)", async () => {
  const css = await Deno.readTextFile(STYLES);
  const block = mediaBlock(css, "(min-width: 769px)");
  assert(block);

  const colBody = selectorListRuleBody(block, ".col-12");
  assert(colBody, "desktop .col-12 wrapper padding must be tightened");
  const colPad = lengthOf(colBody, "padding-left");
  assert(
    colPad !== null && (colPad as number) < 0.75,
    "col padding must be < 0.75rem",
  );

  const rowBody = ruleBody(block, ".row");
  assert(rowBody, "desktop .row gutter must be trimmed alongside the columns");
  const rowMargin = lengthOf(rowBody, "margin-left");
  assert(rowMargin !== null, ".row must set a negative margin-left gutter");
  // The negative row gutter must be cancelled by the column padding so content
  // aligns to the container edge rather than overflowing it.
  assert(
    Math.abs((colPad as number) + (rowMargin as number)) < 1e-9,
    `col padding (${colPad}rem) must cancel the row gutter (${rowMargin}rem)`,
  );
  // And the row must never pull wider than the trimmed container padding.
  const containerBody = ruleBody(block, ".container-fluid");
  const containerPad = lengthOf(containerBody as string, "padding-left");
  assert(
    Math.abs(rowMargin as number) <= (containerPad as number) + 1e-9,
    `row gutter magnitude (${rowMargin}rem) must not exceed container padding (${containerPad}rem)`,
  );
});

Deno.test("styles.css: desktop .card-body.p-4 horizontal padding is reduced below 1.5rem", async () => {
  const css = await Deno.readTextFile(STYLES);
  const block = mediaBlock(css, "(min-width: 769px)");
  assert(block);
  const body = ruleBody(block, ".card-body.p-4");
  assert(
    body,
    ".card-body.p-4 must be tightened in the desktop block to give the data more room",
  );
  const left = lengthOf(body, "padding-left");
  const right = lengthOf(body, "padding-right");
  assert(left !== null && right !== null, "must set horizontal padding");
  assert(
    (left as number) < 1.5 && (right as number) < 1.5,
    `desktop .card-body.p-4 horizontal padding (${left}rem / ${right}rem) must be smaller than Bootstrap's 1.5rem`,
  );
});

Deno.test("styles.css: wide-desktop max-width is widened to reclaim side margin for the data", async () => {
  const css = await Deno.readTextFile(STYLES);
  const body = ruleBody(css, ".container-fluid");
  assert(body);
  const maxWidth = body.match(/max-width\s*:\s*([0-9.]+)\s*px/i);
  assert(maxWidth, "wide-desktop .container-fluid must set a px max-width");
  const px = parseFloat(maxWidth[1]);
  // Reclaim more width than the previous 1600px cap, but stay within the
  // <=2000px ceiling pinned by dashboard_horizontal_margins_test.ts.
  assert(
    px > 1600 && px <= 2000,
    `max-width (${px}px) must be widened beyond 1600px (and stay <= 2000px)`,
  );
});
