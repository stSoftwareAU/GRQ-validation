// Tests for removing the redundant on-screen "opens in a new tab" hint from the
// Yahoo Finance confirm link (issue #618). The visible note beneath the link
// added clutter and duplicated the ↗ external-link cue, so it is removed. The
// accessibility affordance is kept: the link's aria-label still tells screen
// reader users the link opens in a new tab.
//
// The GRQValidator class in docs/app.js instantiates at module load and touches
// the DOM, so it cannot be imported under Deno. Like the other app.js display
// tests (e.g. return_above_cost_of_capital_label_test.ts), these guard the
// rendered markup and stylesheet by reading the published assets directly.

import { assert } from "@std/assert";

const APP_JS = "docs/app.js";
const STYLES_CSS = "docs/styles.css";

async function read(path: string): Promise<string> {
  return await Deno.readTextFile(path);
}

Deno.test("app.js no longer renders the visible 'opens in a new tab' hint", async () => {
  const js = await read(APP_JS);
  assert(
    !js.includes('class="yahoo-finance-hint"'),
    "app.js must not render the visible yahoo-finance-hint span",
  );
});

Deno.test("app.js keeps the accessible aria-label for the new-tab link", async () => {
  const js = await read(APP_JS);
  // Screen reader users still need to know the link opens a new tab; the
  // accessible name is the right place for that, not on-screen text.
  assert(
    js.includes("opens in a new tab)"),
    "app.js must keep the aria-label announcing the link opens in a new tab",
  );
});

Deno.test("styles.css drops the now-unused yahoo-finance-hint rule", async () => {
  const css = await read(STYLES_CSS);
  assert(
    !css.includes("yahoo-finance-hint"),
    "styles.css must not retain the unused .yahoo-finance-hint rule",
  );
});
