// Tests for reclaiming the app-wide horizontal margins (issue #382, sub-issue
// of #337 — "Use more of the screen width").
//
// The inset from the screen edge to actual card content is the SUM of several
// stacked horizontal paddings:
//   * `.container-fluid` — Bootstrap default ~0.75rem each side;
//   * the `.row` / column gutters;
//   * the outer `.col-12` page wrapper (docs/index.html:108) — prior mobile work
//     (#316) tightened `.col, .col-md-6, .col-lg-4` but MISSED `.col-12`, so it
//     kept Bootstrap's full 0.75rem and still doubled the margin on phones;
//   * `#card-body.p-4` — Bootstrap p-4 (1.5rem), reduced to 1rem on mobile.
//
// These assertions pin the CSS so that:
//   * on phones (<=768px) the outer container-fluid padding and the un-tightened
//     `.col-12` wrapper are trimmed so card content uses more of a 375px-class
//     screen, consistent with the #315/#316/#317 mobile tightening;
//   * on wide desktops the content keeps a COMFORTABLE max-width (centred) and
//     never goes edge-to-edge full-bleed, while 1440px-class desktops are
//     unchanged (no regression).
//
// Pure-CSS layout is verified by reading docs/styles.css and asserting on the
// relevant rule bodies — the same approach used by
// dashboard_section_spacing_mobile_test.ts and header_banner_mobile_test.ts.

import { assert } from "@std/assert";

const STYLES = "docs/styles.css";

/**
 * Return the body of the FIRST top-level CSS rule for `selector` found within
 * `css`, or null when absent. `selector` is matched literally at a rule head.
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

/** Parse a rem length from a declaration body for the given property. */
function lengthOf(body: string, prop: string): number | null {
  const m = body.match(new RegExp(`${prop}\\s*:\\s*(-?[0-9.]+)\\s*rem`, "i"));
  return m ? parseFloat(m[1]) : null;
}

/**
 * Find the rule whose comma-separated selector list contains `.col-12` and
 * return its declaration body. Selector lists and simple rule bodies contain no
 * nested braces, so a single brace-free regex captures the group reliably.
 */
function colTwelveRuleBody(scope: string): string | null {
  const m = scope.match(/([^{}]*\.col-12\b[^{}]*)\{([^{}]*)\}/);
  return m ? m[2] : null;
}

Deno.test("styles.css: mobile .container-fluid side padding is trimmed below Bootstrap's 0.75rem", async () => {
  const css = await Deno.readTextFile(STYLES);
  const block = mediaBlock(css, "(max-width: 768px)");
  assert(block, "a (max-width: 768px) mobile media block must exist");
  const body = ruleBody(block, ".container-fluid");
  assert(
    body,
    ".container-fluid must be tightened in the mobile block to reclaim the outer side margin",
  );
  const left = lengthOf(body, "padding-left");
  const right = lengthOf(body, "padding-right");
  assert(left !== null, "mobile .container-fluid must set padding-left");
  assert(right !== null, "mobile .container-fluid must set padding-right");
  assert(
    (left as number) < 0.75 && (right as number) < 0.75,
    `mobile .container-fluid side padding (${left}rem / ${right}rem) must be smaller than Bootstrap's 0.75rem`,
  );
});

Deno.test("styles.css: mobile .col-12 page wrapper padding is tightened to match the other columns", async () => {
  const css = await Deno.readTextFile(STYLES);
  const block = mediaBlock(css, "(max-width: 768px)");
  assert(block);
  const body = colTwelveRuleBody(block);
  assert(
    body,
    ".col-12 must be tightened in the mobile block (it was missed by #316's .col/.col-md-6/.col-lg-4 rule)",
  );
  const left = lengthOf(body, "padding-left");
  const right = lengthOf(body, "padding-right");
  assert(left !== null, "mobile .col-12 must set padding-left");
  assert(right !== null, "mobile .col-12 must set padding-right");
  assert(
    (left as number) < 0.75 && (right as number) < 0.75,
    `mobile .col-12 padding (${left}rem / ${right}rem) must be tighter than Bootstrap's 0.75rem`,
  );
  // The outer row gutter is -0.375rem; the col padding should cancel it so the
  // col content aligns with the container edge rather than indenting further.
  assert(
    Math.abs((left as number) - 0.375) < 1e-9,
    `mobile .col-12 padding (${left}rem) should match the -0.375rem row gutter`,
  );
});

Deno.test("styles.css: .container-fluid keeps a comfortable max-width on wide desktops (not full-bleed)", async () => {
  const css = await Deno.readTextFile(STYLES);
  const body = ruleBody(css, ".container-fluid");
  assert(
    body,
    ".container-fluid must declare a max-width so wide desktops are not edge-to-edge full-bleed",
  );
  const maxWidth = body.match(/max-width\s*:\s*([0-9.]+)\s*px/i);
  assert(maxWidth, "wide-desktop .container-fluid must set a px max-width");
  const px = parseFloat(maxWidth[1]);
  // Comfortable but capped: must not be so small it regresses 1440px-class
  // desktops, and must actually cap genuinely wide monitors.
  assert(
    px >= 1440,
    `max-width (${px}px) must be >= 1440px so 1440px-class desktops are not regressed`,
  );
  assert(
    px <= 2000,
    `max-width (${px}px) must cap genuinely wide monitors (not be effectively full-bleed)`,
  );
  // Centred so the reclaimed space is balanced on both sides.
  assert(
    /margin-left\s*:\s*auto/i.test(body) &&
      /margin-right\s*:\s*auto/i.test(body),
    "wide-desktop .container-fluid must be centred with auto side margins",
  );
});

Deno.test("styles.css: the wide-desktop max-width is not nested inside the mobile block", async () => {
  const css = await Deno.readTextFile(STYLES);
  const mobile = mediaBlock(css, "(max-width: 768px)");
  assert(mobile);
  // The max-width cap must apply at desktop widths, so it must NOT be confined
  // to the phone-only media block.
  assert(
    !/\.container-fluid\s*\{[^}]*max-width/i.test(mobile),
    "the comfortable max-width cap must not be trapped inside the mobile block",
  );
});
