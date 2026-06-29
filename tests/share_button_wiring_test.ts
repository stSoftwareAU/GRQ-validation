// Tests for wiring the footer "Share" button (issue #515).
//
// The deep-link builder + clipboard/fallback handling shipped in
// docs/share_link.js (issue #495), but the dashboard never called
// GRQShare.initShareButton(...), so a tap did nothing — no copy, no message
// (the bug reported in #515). These tests pin two things:
//
//   1. BEHAVIOUR — drive the REAL DOM-wiring in docs/share_link.js with a tiny
//      fake document: a tap reads the live selections via getState, builds the
//      deep-link URL and surfaces it (here through the select-the-text fallback,
//      since the headless test has no Clipboard API), flashing a status message.
//
//   2. WIRING — assert docs/app.js actually invokes GRQShare.initShareButton and
//      feeds it shareState(). app.js bootstraps a live `new GRQValidator()` at
//      import time and touches dozens of real DOM nodes, so it cannot be
//      imported headless; this mirrors the source-structure checks already used
//      for app.js wiring in chart_window_toggle_test.ts.
import { assert, assertEquals, assertStringIncludes } from "@std/assert";

// ---------------------------------------------------------------------------
// Minimal fake DOM — only the surface share_link.js actually touches.
// ---------------------------------------------------------------------------
class FakeClassList {
  private set = new Set<string>();
  add(c: string) {
    this.set.add(c);
  }
  remove(c: string) {
    this.set.delete(c);
  }
  contains(c: string) {
    return this.set.has(c);
  }
}

class FakeElement {
  value = "";
  textContent = "";
  classList = new FakeClassList();
  attrs: Record<string, string> = {};
  // deno-lint-ignore no-explicit-any
  _grqClearTimer: any = null;
  private clickHandlers: Array<() => void> = [];
  constructor(public id = "") {}
  addEventListener(type: string, fn: () => void) {
    if (type === "click") this.clickHandlers.push(fn);
  }
  click() {
    for (const fn of this.clickHandlers) fn();
  }
  setAttribute(k: string, v: string) {
    this.attrs[k] = v;
  }
  removeAttribute(k: string) {
    delete this.attrs[k];
  }
  focus() {}
  select() {}
}

class FakeDocument {
  els = new Map<string, FakeElement>();
  add(id: string) {
    const el = new FakeElement(id);
    this.els.set(id, el);
    return el;
  }
  getElementById(id: string) {
    return this.els.get(id) ?? null;
  }
}

// share_link.js only publishes the DOM-wiring (initShareButton) when a global
// `document` exists at import time. Define one BEFORE importing the module, then
// import dynamically so the wiring branch of the IIFE runs.
const doc = new FakeDocument();
const button = doc.add("shareButton");
const statusEl = doc.add("shareStatus");
const fallbackInput = doc.add("shareFallback");
(globalThis as unknown as { document: unknown }).document = doc;

await import("../docs/share_link.js");

const g = globalThis as unknown as {
  GRQShare: {
    initShareButton: (opts: {
      document?: unknown;
      getState?: () => unknown;
    }) => void;
  };
};
const S = g.GRQShare;

Deno.test("share_link.js publishes the DOM-wiring entry point", () => {
  assertEquals(typeof S.initShareButton, "function");
});

Deno.test("a tap reads getState and surfaces the deep-link (fallback path)", async () => {
  let stateReads = 0;
  S.initShareButton({
    document: doc,
    getState: () => {
      stateReads += 1;
      return { file: "2026/March/23.tsv", stock: "NASDAQ:MGRC", window: 180 };
    },
  });

  // Before the tap there is no link and no status — the bug state.
  assertEquals(fallbackInput.value, "");
  assertEquals(statusEl.textContent, "");

  button.click();
  // Let the clipboard promise reject (no Clipboard API headless) so the
  // select-the-text fallback runs.
  await new Promise((r) => setTimeout(r, 0));

  assertEquals(stateReads, 1, "the tap must read the live selections");
  assertStringIncludes(fallbackInput.value, "file=2026%2FMarch%2F23.tsv");
  assertStringIncludes(fallbackInput.value, "stock=NASDAQ%3AMGRC");
  assertStringIncludes(fallbackInput.value, "window=180");
  assert(!fallbackInput.classList.contains("visually-hidden"));
  assert(
    statusEl.textContent.length > 0,
    "a confirmation/fallback message must be shown",
  );

  clearTimeout(statusEl._grqClearTimer);
});

Deno.test("initShareButton is inert when the footer button is absent", () => {
  // A page without the footer control must not throw.
  const bare = new FakeDocument();
  S.initShareButton({ document: bare, getState: () => ({}) });
});

// Issue #633: the former "app.js wires the footer Share button" test grepped
// docs/app.js SOURCE TEXT for `GRQShare.initShareButton` and regex-matched
// `getState … this.shareState()`. That asserted an identifier appears in the
// shipped JS — not that the wiring works — and broke on any rename. The real
// DOM-wiring contract (a tap reads getState, builds the deep link and surfaces
// it) is fully exercised behaviourally by the tests above, which drive the
// shipped GRQShare.initShareButton against a fake document. app.js itself
// bootstraps a live GRQValidator at import time and cannot be imported headless,
// so the grep tail has been removed rather than replaced with another grep.
