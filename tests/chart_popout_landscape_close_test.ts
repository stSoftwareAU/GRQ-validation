// Tests for closing the mobile chart pop-out in landscape and keeping it open
// across an orientation change (issue #494, part of milestone #484).
//
// Builds on #451 (pop-out lifecycle) and #452 (landscape presentation). The gap
// this covers: on iOS the landscape look is a CSS-rotate fallback (no
// screen.orientation.lock()), which rotates the overlay's coordinate space and
// can strand the ✕ close hit target in the rotated frame. The fixes are:
//   - docs/styles.css pins the close toolbar above the rotated chart so the ✕
//     stays upright and tappable (verified by reading the portrait media block);
//   - docs/chart_popout.js keeps the overlay open across rotation and restores
//     the single shared canvas to its inline container on close regardless of
//     the orientation it was closed in (verified headless via the REAL wiring).
import { assert, assertEquals } from "@std/assert";
import "../docs/chart_popout.js";

// deno-lint-ignore no-explicit-any
const GRQ = (globalThis as any).GRQChartPopout;

// ---------------------------------------------------------------------------
// Fake DOM — only the surface createChartPopout actually touches. Unlike the
// barebones fakes elsewhere, this one exposes `parentNode` so the close path's
// canvas-restore (chartContainer = canvas.parentNode) is exercised for real.
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
  hidden = false;
  classList = new FakeClassList();
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  attrs: Record<string, string> = {};
  listeners: Record<string, Array<(e: unknown) => void>> = {};
  constructor(public id = "") {}
  get parentNode() {
    return this.parent;
  }
  get parentElement() {
    return this.parent;
  }
  appendChild(child: FakeElement) {
    if (child.parent) {
      child.parent.children = child.parent.children.filter((c) => c !== child);
    }
    child.parent = this;
    this.children.push(child);
    return child;
  }
  setAttribute(k: string, v: string) {
    this.attrs[k] = v;
  }
  getAttribute(k: string) {
    return k in this.attrs ? this.attrs[k] : null;
  }
  addEventListener(type: string, fn: (e: unknown) => void) {
    (this.listeners[type] ||= []).push(fn);
  }
  removeEventListener() {}
  // Invoke the wired handlers for an event type, mirroring a real dispatch.
  fire(type: string, event: unknown = {}) {
    (this.listeners[type] || []).forEach((fn) => fn(event));
  }
  focus() {}
}

// Build a real createChartPopout controller wired to a fake DOM, at the given
// orientation. `lockSupported:false` models iOS (the CSS-rotate path).
function makeController(
  { portrait, lockSupported }: { portrait: boolean; lockSupported: boolean },
) {
  const elements: Record<string, FakeElement> = {
    chartPopout: Object.assign(new FakeElement("chartPopout"), {
      hidden: true,
    }),
    chartPopoutBody: new FakeElement("chartPopoutBody"),
    chartPopoutExpand: new FakeElement("chartPopoutExpand"),
    chartPopoutClose: new FakeElement("chartPopoutClose"),
    performanceChart: new FakeElement("performanceChart"),
  };
  const container = new FakeElement("chart-container");
  container.appendChild(elements.performanceChart);

  const body = new FakeElement("body");
  const fakeDoc = {
    body,
    activeElement: null as FakeElement | null,
    getElementById: (id: string) => elements[id] ?? null,
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  const chart = {
    resizeCount: 0,
    updateCount: 0,
    resize() {
      chart.resizeCount++;
    },
    update() {
      chart.updateCount++;
    },
  };

  const orientation: Record<string, unknown> = { type: "portrait-primary" };
  if (lockSupported) {
    orientation.lock = () => Promise.resolve();
    orientation.unlock = () => {};
  }
  const screen = { orientation };
  const viewport = portrait
    ? { innerWidth: 390, innerHeight: 844 }
    : { innerWidth: 844, innerHeight: 390 };

  const controller = GRQ.createChartPopout({
    document: fakeDoc,
    getChart: () => chart,
    screen,
    viewport,
  });
  return { controller, elements, container, chart };
}

// ---------------------------------------------------------------------------
// Open directly in landscape → ✕ closes and the canvas returns to its
// container (acceptance: "Open in landscape directly → ✕ closes it").
// ---------------------------------------------------------------------------
Deno.test("createChartPopout - ✕ closes the pop-out opened in landscape", () => {
  const { controller, elements, container } = makeController({
    portrait: false,
    lockSupported: false,
  });

  assertEquals(controller.open(), true, "opens in landscape");
  assertEquals(controller.isOpen(), true);
  assertEquals(
    elements.performanceChart.parent,
    elements.chartPopoutBody,
    "canvas re-parented into the overlay while open",
  );

  // The ✕ button's click handler is the controller's close path.
  controller.close();
  assertEquals(controller.isOpen(), false, "✕ closes in landscape");
  assertEquals(elements.chartPopout.hidden, true, "overlay hidden after close");
  assertEquals(
    elements.performanceChart.parent,
    container,
    "canvas returns to its inline .chart-container on landscape close",
  );
});

// ---------------------------------------------------------------------------
// Open in portrait, rotate to landscape → stays open AND ✕ still closes it
// (acceptance: "Open in portrait, rotate to landscape → stays open AND ✕
// closes it"). The single shared canvas must still return on close.
// ---------------------------------------------------------------------------
Deno.test("createChartPopout - stays open across rotation and ✕ then closes it", () => {
  const { controller, elements, container } = makeController({
    portrait: true,
    lockSupported: false, // iOS CSS-rotate path
  });

  assertEquals(controller.open(), true, "opens in portrait");
  assertEquals(controller.isOpen(), true);

  // Rotate the device to landscape while open. The wiring listens on globalThis
  // for orientationchange/resize; a real dispatch drives the shipped handler.
  globalThis.dispatchEvent(new Event("orientationchange"));
  globalThis.dispatchEvent(new Event("resize"));

  assertEquals(
    controller.isOpen(),
    true,
    "pop-out stays open across the orientation change",
  );

  controller.close();
  assertEquals(controller.isOpen(), false, "✕ closes after rotation");
  assertEquals(
    elements.performanceChart.parent,
    container,
    "canvas returns to its container regardless of the orientation closed in",
  );
});

// ---------------------------------------------------------------------------
// The close affordance must stay reachable in the CSS-rotate landscape frame:
// the portrait media block pins the toolbar above the rotated chart so the ✕
// is not stranded behind the rotated coordinate space (issue #494).
// ---------------------------------------------------------------------------
function portraitMediaBlock(css: string): string | null {
  const needle = "@media (max-width: 767.98px) and (orientation: portrait)";
  const head = css.indexOf(needle);
  if (head === -1) return null;
  const open = css.indexOf("{", head);
  if (open === -1) return null;
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

function ruleBody(css: string, selector: string): string | null {
  const head = css.indexOf(selector + " {");
  if (head === -1) return null;
  const open = css.indexOf("{", head);
  const close = css.indexOf("}", open);
  if (open === -1 || close === -1) return null;
  return css.slice(open + 1, close);
}

Deno.test("styles.css - close toolbar is pinned above the rotated chart in portrait", async () => {
  const css = await Deno.readTextFile(
    new URL("../docs/styles.css", import.meta.url),
  );
  const block = portraitMediaBlock(css);
  assert(block, "the portrait pop-out media block must exist");
  const toolbar = ruleBody(block!, ".chart-popout-toolbar");
  assert(
    toolbar,
    ".chart-popout-toolbar must be styled inside the portrait block",
  );
  // Pinned out of the flex flow that the absolutely-positioned rotated body
  // removes, so the ✕ floats above the rotated chart rather than being stranded.
  assert(
    /position:\s*(fixed|absolute)/.test(toolbar!),
    "close toolbar must be pinned (fixed/absolute) so the ✕ stays reachable",
  );
  // Stacked above both the overlay (z-index 1080) and the rotated body.
  const z = /z-index:\s*(\d+)/.exec(toolbar!);
  assert(z, "close toolbar must declare a z-index in the portrait block");
  assert(
    Number(z![1]) >= 1080,
    "close toolbar z-index must sit above the overlay (>= 1080)",
  );
});
