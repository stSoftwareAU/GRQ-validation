// Tests for further compacting the dashboard top-of-page chrome on mobile
// (issue #492, part of milestone #484 — reclaim vertical space on phones).
//
// Issue #315 already shrank the gradient banner on phones (padding 0.75rem,
// title 1.75rem, subtitle 0.95rem). #492 pushes the four top-of-page targets
// tighter still so the valuation content — not the chrome — surfaces on first
// paint:
//   * `.card-header.header-gradient` vertical padding (was 0.75rem);
//   * `.header-gradient .display-4` title font-size (was 1.75rem);
//   * `.header-gradient .lead` subtitle font-size (was 0.95rem);
//   * the `Score File:` label spacing (`.form-label` margin-bottom, was
//     0.25rem) so the control row sits closer to the banner.
//
// All overrides stay gated behind the existing `(max-width: 768px)` mobile
// breakpoint so desktop/tablet (>=768px) rendering is unchanged. Pure-CSS
// layout is verified by reading docs/styles.css and asserting on the relevant
// rule bodies — the same approach used by header_banner_mobile_test.ts.

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

/** Parse a rem length from a declaration body for the given property. */
function lengthOf(body: string, prop: string): number | null {
  const m = body.match(new RegExp(`${prop}\\s*:\\s*(-?[0-9.]+)\\s*rem`, "i"));
  return m ? parseFloat(m[1]) : null;
}

// The #315 baseline this issue tightens past.
const PRIOR_PADDING = 0.75;
const PRIOR_TITLE = 1.75;
const PRIOR_SUBTITLE = 0.95;
const PRIOR_LABEL_GAP = 0.25;

Deno.test("styles.css: #492 mobile banner padding is tighter than the #315 0.75rem", async () => {
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
  assert(top !== null && bottom !== null, "banner must set padding-top/bottom");
  assert(
    (top as number) < PRIOR_PADDING && (bottom as number) < PRIOR_PADDING,
    `mobile banner padding (${top}/${bottom}rem) must be tighter than the #315 ${PRIOR_PADDING}rem`,
  );
  assert(
    /padding-top:[^;]*!important/i.test(body),
    "padding must use !important to override Bootstrap's py-4 utility",
  );
});

Deno.test("styles.css: #492 mobile title is tighter than the #315 1.75rem", async () => {
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
  assert(
    (size as number) < PRIOR_TITLE,
    `mobile title (${size}rem) must be tighter than the #315 ${PRIOR_TITLE}rem`,
  );
});

Deno.test("styles.css: #492 mobile subtitle is tighter than the #315 0.95rem", async () => {
  const css = await Deno.readTextFile(STYLES);
  const block = mediaBlock(css, "(max-width: 768px)");
  assert(block);
  const body = ruleBody(block, ".header-gradient .lead");
  assert(body, ".header-gradient .lead must be styled in the mobile block");
  const size = lengthOf(body, "font-size");
  assert(size !== null, "mobile subtitle must set a font-size");
  assert(
    (size as number) < PRIOR_SUBTITLE,
    `mobile subtitle (${size}rem) must be tighter than the #315 ${PRIOR_SUBTITLE}rem`,
  );
});

Deno.test("styles.css: #492 tightens the Score File label spacing on mobile", async () => {
  const css = await Deno.readTextFile(STYLES);
  const block = mediaBlock(css, "(max-width: 768px)");
  assert(block);
  const body = ruleBody(block, ".form-label");
  assert(body, ".form-label must be styled in the mobile block");
  const gap = lengthOf(body, "margin-bottom");
  assert(gap !== null, "mobile .form-label must set margin-bottom");
  assert(
    (gap as number) < PRIOR_LABEL_GAP,
    `mobile label gap (${gap}rem) must be tighter than the prior ${PRIOR_LABEL_GAP}rem`,
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

Deno.test("styles.css: #492 chrome overrides stay confined to the mobile block (desktop unchanged)", async () => {
  const css = await Deno.readTextFile(STYLES);
  const base = ruleBody(css, ".header-gradient");
  assert(base, ".header-gradient base rule must exist");
  assert(
    !/font-size/i.test(base),
    "the base .header-gradient rule must not set a font-size (desktop unchanged)",
  );
  const nonMobile = withoutMobileBlocks(css);
  assert(
    !/\.header-gradient \.display-4\s*\{/.test(nonMobile),
    "the display-4 size override must be mobile-only",
  );
  assert(
    !/\.header-gradient \.lead\s*\{/.test(nonMobile),
    "the lead size override must be mobile-only",
  );
  const desktop = mediaBlock(css, "(min-width: 768px)");
  if (desktop) {
    assert(
      ruleBody(desktop, ".card-header.header-gradient") === null &&
        ruleBody(desktop, ".header-gradient .display-4") === null,
      "the desktop block must not shrink the banner",
    );
  }
});

Deno.test("index.html: banner keeps its h1, lead subtitle, theme toggle and Prediction Date control", async () => {
  const html = await Deno.readTextFile(INDEX);
  assert(
    /<h1 class="display-4[^"]*">GRQ Validation Dashboard<\/h1>/.test(html),
    "the title must remain an <h1> for accessibility",
  );
  assert(/<p class="lead[^"]*">/.test(html), "the lead subtitle must remain");
  assert(html.includes('id="theme-toggle"'), "the theme toggle must remain");
  // Issue #530: the user-facing label reads "Prediction Date", not the
  // implementation detail "Score File", but it must keep its association
  // with the #scoreFileSelect control.
  assert(
    /<label for="scoreFileSelect"[^>]*>Prediction Date:<\/label>/.test(html),
    "the Prediction Date control must keep its associated <label>",
  );
});
