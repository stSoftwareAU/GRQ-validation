// Tests for tightening dashboard section/card spacing on mobile (issue #316,
// part of milestone #307 — give data more room on phones).
//
// On a phone the dashboard wastes vertical space in three ways:
//   * the outer body `div.card-body.p-4` keeps Bootstrap's `p-4` 1.5rem padding
//     because the `!important` utility overrides the `.card-body { padding: 1rem }`
//     mobile rule;
//   * the `.mb-4` / `.mb-3` mobile overrides are pinned to Bootstrap's own
//     defaults (1.5rem / 1rem), so they tighten nothing;
//   * the stacked section cards are separated by those `mb-4` gaps.
//
// These assertions pin the mobile-only CSS so the between-section/card gaps and
// the outer body padding shrink, while desktop/tablet (>=768px) is untouched.
//
// Pure-CSS layout is verified by reading docs/styles.css and asserting on the
// relevant rule bodies within the mobile media block — the same approach used by
// header_banner_mobile_test.ts and section_title_centring_test.ts.

import { assert } from "@std/assert";

const INDEX = "docs/index.html";
const STYLES = "docs/styles.css";

/**
 * Return the body of the FIRST top-level CSS rule for `selector` found within
 * `css`, or null when absent. Brace-aware so a nested rule below is not mistaken
 * for the block. `selector` is matched literally at a rule head.
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

Deno.test("styles.css: mobile .mb-4 gap is tighter than Bootstrap's 1.5rem", async () => {
  const css = await Deno.readTextFile(STYLES);
  const block = mediaBlock(css, "(max-width: 768px)");
  assert(block, "a (max-width: 768px) mobile media block must exist");
  const body = ruleBody(block, ".mb-4");
  assert(body, ".mb-4 must be styled in the mobile block");
  const mb = lengthOf(body, "margin-bottom");
  assert(mb !== null, "mobile .mb-4 must set margin-bottom");
  assert(
    (mb as number) < 1.5,
    `mobile .mb-4 margin-bottom (${mb}rem) must be smaller than the 1.5rem default`,
  );
  assert(
    /margin-bottom:[^;]*!important/i.test(body),
    "mobile .mb-4 must use !important to override Bootstrap's utility",
  );
});

Deno.test("styles.css: mobile .mb-3 gap is tighter than Bootstrap's 1rem", async () => {
  const css = await Deno.readTextFile(STYLES);
  const block = mediaBlock(css, "(max-width: 768px)");
  assert(block);
  const body = ruleBody(block, ".mb-3");
  assert(body, ".mb-3 must be styled in the mobile block");
  const mb = lengthOf(body, "margin-bottom");
  assert(mb !== null, "mobile .mb-3 must set margin-bottom");
  assert(
    (mb as number) < 1,
    `mobile .mb-3 margin-bottom (${mb}rem) must be smaller than the 1rem default`,
  );
  assert(
    /margin-bottom:[^;]*!important/i.test(body),
    "mobile .mb-3 must use !important to override Bootstrap's utility",
  );
});

Deno.test("styles.css: mobile outer .card-body.p-4 padding is reduced below 1.5rem", async () => {
  const css = await Deno.readTextFile(STYLES);
  const block = mediaBlock(css, "(max-width: 768px)");
  assert(block);
  const body = ruleBody(block, ".card-body.p-4");
  assert(
    body,
    ".card-body.p-4 must be styled in the mobile block so the p-4 utility is overridden",
  );
  const pad = lengthOf(body, "padding");
  assert(pad !== null, "mobile .card-body.p-4 must set padding");
  assert(
    (pad as number) < 1.5,
    `mobile outer body padding (${pad}rem) must be smaller than the p-4 1.5rem default`,
  );
  assert(
    /padding:[^;]*!important/i.test(body),
    "padding must use !important to override Bootstrap's p-4 utility",
  );
});

Deno.test("styles.css: mobile .row gutters are tightened", async () => {
  const css = await Deno.readTextFile(STYLES);
  const block = mediaBlock(css, "(max-width: 768px)");
  assert(block);
  const body = ruleBody(block, ".row");
  assert(body, ".row must be styled in the mobile block");
  const left = lengthOf(body, "margin-left");
  assert(left !== null, "mobile .row must set a negative margin gutter");
  // Bootstrap's default row gutter is -0.75rem; the prior mobile rule used
  // -0.5rem. Tightening means the negative margin is shallower than -0.5rem.
  assert(
    Math.abs(left as number) < 0.5,
    `mobile .row gutter (${left}rem) must be tighter than the prior -0.5rem`,
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

Deno.test("styles.css: section spacing overrides are confined to the mobile block", async () => {
  const css = await Deno.readTextFile(STYLES);
  // Outside the mobile media blocks the .card-body.p-4 override must not exist,
  // so desktop/tablet (>=768px) rendering is unchanged.
  const nonMobile = withoutMobileBlocks(css);
  assert(
    !/\.card-body\.p-4\s*\{/.test(nonMobile),
    "there must be no non-mobile .card-body.p-4 rule (mobile-only override)",
  );
  const desktop = mediaBlock(css, "(min-width: 768px)");
  if (desktop) {
    assert(
      ruleBody(desktop, ".mb-4") === null &&
        ruleBody(desktop, ".card-body.p-4") === null,
      "the desktop block must not retune section spacing",
    );
  }
});

Deno.test("index.html: dashboard keeps its sections, controls and outer body markup", async () => {
  const html = await Deno.readTextFile(INDEX);
  assert(
    /<div class="card-body p-4">/.test(html),
    "the outer body keeps its card-body p-4 markup (tightened via CSS only)",
  );
  assert(
    html.includes('id="scoreFileSelect"'),
    "the score-file control must remain",
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
