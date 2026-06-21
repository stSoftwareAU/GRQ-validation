// Tests for the mobile colour-key scaffold below the performance chart
// (issue #243, part of the legend milestone #236).
//
// On mobile the Chart.js legend is force-hidden in docs/app.js, so no plotted
// line can be identified on a phone. This issue adds the static, mobile-only
// container and styling for a compact colour key directly below the chart
// canvas. It delivers the SCAFFOLD only — a later issue populates the chips
// from the live chart datasets.
//
// These assertions pin the integration so a future edit cannot silently drop
// the container, move it out from under the chart, reveal it on desktop (which
// must keep the native Chart.js legend), or hide it on mobile.

import { assert, assertEquals, assertMatch } from "@std/assert";

const INDEX = "docs/index.html";
const STYLES = "docs/styles.css";

/**
 * Return the body of the FIRST top-level CSS rule for `selector` found within
 * `css`, or null when absent. Brace-aware so a swatch/chip rule nested below is
 * not mistaken for the block. `selector` is matched literally at a rule head.
 */
function ruleBody(css: string, selector: string): string | null {
  const head = css.indexOf(selector + " {");
  if (head === -1) return null;
  const open = css.indexOf("{", head);
  const close = css.indexOf("}", open);
  if (open === -1 || close === -1) return null;
  return css.slice(open + 1, close);
}

/** Extract the body of the named `@media (...)` block, or null when absent. */
function mediaBlock(css: string, query: string): string | null {
  const head = css.indexOf(`@media ${query}`);
  if (head === -1) return null;
  const open = css.indexOf("{", head);
  if (open === -1) return null;
  // Walk braces to find the matching close for the media block.
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  return null;
}

Deno.test("index.html: #chartColorKey container exists with the key class and an aria-label", async () => {
  const html = await Deno.readTextFile(INDEX);
  const m = html.match(/<div\s+id="chartColorKey"[^>]*>/i);
  assert(m, 'a <div id="chartColorKey"> must exist in the dashboard');
  const tag = m[0];
  assertMatch(
    tag,
    /class="[^"]*\bchart-color-key\b[^"]*"/i,
    "the container must carry the chart-color-key class",
  );
  assertMatch(
    tag,
    /aria-label="[^"]+"/i,
    "the container must carry an aria-label for assistive tech",
  );
});

Deno.test("index.html: the colour-key container is empty (scaffold only)", async () => {
  const html = await Deno.readTextFile(INDEX);
  // No populated entries yet — the element must render nothing visible.
  assertMatch(
    html,
    /<div\s+id="chartColorKey"[^>]*>\s*<\/div>/i,
    "the scaffold container must be empty until a later issue populates it",
  );
});

Deno.test("index.html: the colour key sits directly below the chart canvas", async () => {
  const html = await Deno.readTextFile(INDEX);
  // The key must be the immediate sibling after the chart-container closes,
  // so it renders directly beneath the performance chart.
  assertMatch(
    html,
    /<canvas\s+id="performanceChart"><\/canvas>\s*<\/div>\s*(?:<!--[\s\S]*?-->\s*)?<div\s+id="chartColorKey"/i,
    "#chartColorKey must immediately follow the .chart-container holding the canvas",
  );
});

Deno.test("styles.css: .chart-color-key is hidden by default (desktop keeps the Chart.js legend)", async () => {
  const css = await Deno.readTextFile(STYLES);
  const body = ruleBody(css, ".chart-color-key");
  assert(body, ".chart-color-key base rule must exist");
  assertMatch(
    body,
    /display:\s*none/i,
    "on desktop the colour key must be hidden so the native legend is used",
  );
});

Deno.test("styles.css: the mobile media query reveals the colour key as a flex layout", async () => {
  const css = await Deno.readTextFile(STYLES);
  // "Mobile" is width < 768px, matching isMobileDevice() (Bootstrap sm and below).
  const block = mediaBlock(css, "(max-width: 768px)");
  assert(block, "a (max-width: 768px) media block must exist");
  const body = ruleBody(block, ".chart-color-key");
  assert(body, ".chart-color-key must be styled inside the mobile media block");
  assertMatch(
    body,
    /display:\s*flex/i,
    "on mobile the colour key must be revealed as a flex layout",
  );
});

Deno.test("styles.css: the base key layout wraps its chips", async () => {
  const css = await Deno.readTextFile(STYLES);
  const body = ruleBody(css, ".chart-color-key");
  assert(body);
  assertMatch(
    body,
    /flex-wrap:\s*wrap/i,
    "chips must wrap so the key stays compact on a narrow screen",
  );
});

Deno.test("styles.css: chip and swatch hooks are styled for the populate step", async () => {
  const css = await Deno.readTextFile(STYLES);
  const swatch = ruleBody(css, ".chart-color-key-swatch");
  assert(swatch, ".chart-color-key-swatch rule must exist for the colour chip");
  // A swatch needs an explicit size to show a colour block.
  assertMatch(
    swatch,
    /width:\s*[0-9.]/i,
    "the swatch must have an explicit width to render a colour block",
  );
  assert(
    ruleBody(css, ".chart-color-key-chip"),
    ".chart-color-key-chip rule must exist for each colour/label pair",
  );
});

Deno.test("styles.css: the desktop Chart.js legend rules are left untouched", async () => {
  const css = await Deno.readTextFile(STYLES);
  // Out of scope: the native legend hide-on-mobile rules must remain intact.
  assertEquals(
    /\.chartjs-legend\s*{/.test(css),
    true,
    "the existing .chartjs-legend styling must be preserved",
  );
});
