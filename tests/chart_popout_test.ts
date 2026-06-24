// Tests for the mobile chart pop-out overlay engine (issue #451, part of the
// full-screen landscape pop-out milestone #446).
//
// docs/chart_popout.js holds the open/close lifecycle for the mobile-only
// full-viewport overlay that hosts the single live #performanceChart canvas.
// The browser wiring (event listeners, history back-gesture) is a thin layer
// around the pure openPopout()/closePopout()/togglePopout() core, so these
// tests exercise the REAL shipped state transitions rather than a copy:
//   - on open: the overlay is shown, the body scroll-lock class is added, the
//     canvas is re-parented into the overlay, focus moves to the close button,
//     and the chart is resized;
//   - on close: the canvas is restored to the chart container, the overlay is
//     hidden, the body class is removed, focus is restored to the trigger, and
//     the chart is resized back.
//
// The core is dependency-injected (it only touches classList / hidden /
// appendChild / focus / getAttribute), so a tiny fake DOM drives it headless,
// mirroring docs/popover_dismiss.js and its test.
import { assert, assertEquals } from "@std/assert";
import { checkJsSyntax } from "../helpers/js_syntax.ts";
import "../docs/chart_popout.js";

// ---------------------------------------------------------------------------
// Minimal fake DOM — only the surface chart_popout.js actually uses.
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
  focusCount = 0;
  doc: FakeDocument | null = null;
  constructor(public id = "") {}
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
  focus() {
    this.focusCount++;
    if (this.doc) this.doc.activeElement = this;
  }
}

class FakeDocument {
  activeElement: FakeElement | null = null;
  body = new FakeElement("body");
}

interface FakeChart {
  resizeCount: number;
  updateCount: number;
  resize: () => void;
  update: () => void;
}

function makeChart(): FakeChart {
  const chart: FakeChart = {
    resizeCount: 0,
    updateCount: 0,
    resize() {
      chart.resizeCount++;
    },
    update() {
      chart.updateCount++;
    },
  };
  return chart;
}

// Build a fresh open/close context wired to a fake DOM. The canvas starts in
// the chart container, exactly as the static dashboard markup has it.
function makeContext(chart: FakeChart | null = makeChart()) {
  const doc = new FakeDocument();
  const overlay = new FakeElement("chartPopout");
  overlay.doc = doc;
  overlay.hidden = true;
  const overlayBody = new FakeElement("chartPopoutBody");
  overlayBody.doc = doc;
  const chartContainer = new FakeElement("chart-container");
  chartContainer.doc = doc;
  const canvas = new FakeElement("performanceChart");
  canvas.doc = doc;
  chartContainer.appendChild(canvas);
  const trigger = new FakeElement("chartPopoutExpand");
  trigger.doc = doc;
  const closeButton = new FakeElement("chartPopoutClose");
  closeButton.doc = doc;
  // The trigger has focus when the user taps it open.
  trigger.focus();

  return {
    doc,
    overlay,
    overlayBody,
    chartContainer,
    canvas,
    trigger,
    closeButton,
    getChart: () => chart,
    isOpen: false,
    previousFocus: null,
  };
}

const g = globalThis as unknown as {
  GRQChartPopout: {
    BODY_OPEN_CLASS: string;
    // deno-lint-ignore no-explicit-any
    openPopout: (ctx: any) => boolean;
    // deno-lint-ignore no-explicit-any
    closePopout: (ctx: any) => boolean;
    // deno-lint-ignore no-explicit-any
    togglePopout: (ctx: any) => boolean;
    createChartPopout: (opts: unknown) => unknown;
  };
};
const GRQChartPopout = g.GRQChartPopout;

Deno.test("chart_popout.js publishes the lifecycle helpers on globalThis", () => {
  assertEquals(typeof GRQChartPopout.openPopout, "function");
  assertEquals(typeof GRQChartPopout.closePopout, "function");
  assertEquals(typeof GRQChartPopout.togglePopout, "function");
  assertEquals(typeof GRQChartPopout.createChartPopout, "function");
  assertEquals(GRQChartPopout.BODY_OPEN_CLASS, "chart-popout-open");
});

Deno.test("openPopout - shows the overlay and locks background scroll", () => {
  const ctx = makeContext();
  const opened = GRQChartPopout.openPopout(ctx);

  assert(opened, "openPopout should report it opened");
  assertEquals(ctx.isOpen, true);
  assertEquals(ctx.overlay.hidden, false, "overlay must be revealed");
  assertEquals(ctx.overlay.getAttribute("aria-hidden"), "false");
  assert(
    ctx.doc.body.classList.contains(GRQChartPopout.BODY_OPEN_CLASS),
    "body must carry the scroll-lock class while open",
  );
});

Deno.test("openPopout - re-parents the live canvas into the overlay", () => {
  const ctx = makeContext();
  assertEquals(ctx.canvas.parent, ctx.chartContainer, "starts in container");

  GRQChartPopout.openPopout(ctx);

  assertEquals(ctx.canvas.parent, ctx.overlayBody, "canvas moves to overlay");
  assert(
    ctx.overlayBody.children.includes(ctx.canvas),
    "overlay body must hold the canvas",
  );
  assert(
    !ctx.chartContainer.children.includes(ctx.canvas),
    "canvas must leave the chart container",
  );
});

Deno.test("openPopout - moves focus into the overlay and resizes the chart", () => {
  const chart = makeChart();
  const ctx = makeContext(chart);
  GRQChartPopout.openPopout(ctx);

  assertEquals(ctx.doc.activeElement, ctx.closeButton, "focus -> close button");
  assert(chart.resizeCount > 0, "chart must be resized to fill the overlay");
  assert(chart.updateCount > 0, "chart must be updated after the resize");
});

Deno.test("openPopout - is a no-op when already open", () => {
  const ctx = makeContext();
  GRQChartPopout.openPopout(ctx);
  const again = GRQChartPopout.openPopout(ctx);
  assertEquals(again, false, "second open must report no-op");
  assertEquals(ctx.isOpen, true);
});

Deno.test("closePopout - hides the overlay and unlocks background scroll", () => {
  const ctx = makeContext();
  GRQChartPopout.openPopout(ctx);

  const closed = GRQChartPopout.closePopout(ctx);
  assert(closed, "closePopout should report it closed");
  assertEquals(ctx.isOpen, false);
  assertEquals(ctx.overlay.hidden, true, "overlay must be hidden again");
  assertEquals(ctx.overlay.getAttribute("aria-hidden"), "true");
  assert(
    !ctx.doc.body.classList.contains(GRQChartPopout.BODY_OPEN_CLASS),
    "body scroll-lock class must be removed on close",
  );
});

Deno.test("closePopout - restores the canvas to the chart container", () => {
  const ctx = makeContext();
  GRQChartPopout.openPopout(ctx);
  GRQChartPopout.closePopout(ctx);

  assertEquals(ctx.canvas.parent, ctx.chartContainer, "canvas restored");
  assert(
    ctx.chartContainer.children.includes(ctx.canvas),
    "chart container must hold the canvas again",
  );
  assert(
    !ctx.overlayBody.children.includes(ctx.canvas),
    "overlay body must release the canvas",
  );
});

Deno.test("closePopout - restores focus to the trigger and resizes the chart back", () => {
  const chart = makeChart();
  const ctx = makeContext(chart);
  GRQChartPopout.openPopout(ctx);
  const resizesAtOpen = chart.resizeCount;

  GRQChartPopout.closePopout(ctx);
  assertEquals(ctx.doc.activeElement, ctx.trigger, "focus restored to trigger");
  assert(
    chart.resizeCount > resizesAtOpen,
    "chart must be resized again on close",
  );
});

Deno.test("closePopout - is a no-op when not open", () => {
  const ctx = makeContext();
  const closed = GRQChartPopout.closePopout(ctx);
  assertEquals(closed, false, "closing a closed overlay must report no-op");
  assertEquals(ctx.isOpen, false);
});

Deno.test("togglePopout - opens then closes across calls", () => {
  const ctx = makeContext();
  assertEquals(GRQChartPopout.togglePopout(ctx), true, "first toggle opens");
  assertEquals(ctx.isOpen, true);
  assertEquals(GRQChartPopout.togglePopout(ctx), true, "second toggle closes");
  assertEquals(ctx.isOpen, false);
});

Deno.test("openPopout - tolerates a missing chart instance", () => {
  const ctx = makeContext(null);
  // Must not throw when no chart has been built yet.
  const opened = GRQChartPopout.openPopout(ctx);
  assert(opened, "overlay still opens with no chart present");
  assertEquals(ctx.overlay.hidden, false);
});

Deno.test("createChartPopout - resolves elements and toggles state via the document", () => {
  const doc = new FakeDocument();
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
  for (const el of Object.values(elements)) el.doc = doc;
  container.doc = doc;

  const listeners: Record<string, Array<(e: unknown) => void>> = {};
  const fakeDoc = {
    body: doc.body,
    get activeElement() {
      return doc.activeElement;
    },
    getElementById: (id: string) => elements[id] ?? null,
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      (listeners[type] ||= []).push(fn);
    },
    removeEventListener: () => {},
  };

  const chart = makeChart();
  const controller = GRQChartPopout.createChartPopout({
    document: fakeDoc,
    getChart: () => chart,
  }) as {
    open: () => boolean;
    close: () => boolean;
    isOpen: () => boolean;
  };

  assertEquals(controller.isOpen(), false);
  controller.open();
  assertEquals(controller.isOpen(), true);
  assertEquals(elements.chartPopout.hidden, false);
  assert(doc.body.classList.contains("chart-popout-open"));
  controller.close();
  assertEquals(controller.isOpen(), false);
  assertEquals(elements.chartPopout.hidden, true);
  assert(!doc.body.classList.contains("chart-popout-open"));
});

Deno.test("production docs/chart_popout.js parses as valid JavaScript", async () => {
  const source = await Deno.readTextFile(
    new URL("../docs/chart_popout.js", import.meta.url),
  );
  assertEquals(checkJsSyntax(source).valid, true, checkJsSyntax(source).error);
});

Deno.test("index.html loads chart_popout.js before the app bootstrap", async () => {
  const html = await Deno.readTextFile(
    new URL("../docs/index.html", import.meta.url),
  );
  const popoutIndex = html.indexOf('src="chart_popout.js"');
  const bootIndex = html.indexOf('src="dashboard_boot.js"');
  assert(popoutIndex !== -1, "index.html must load chart_popout.js");
  assert(bootIndex !== -1, "index.html must load dashboard_boot.js");
  assert(
    popoutIndex < bootIndex,
    "chart_popout.js must load before dashboard_boot.js",
  );
});

Deno.test("index.html exposes the overlay contract for the sibling sub-issues", async () => {
  const html = await Deno.readTextFile(
    new URL("../docs/index.html", import.meta.url),
  );
  assert(html.includes('id="chartPopout"'), "overlay container #chartPopout");
  assert(
    html.includes('id="chartPopoutExpand"'),
    "mobile expand trigger #chartPopoutExpand",
  );
});

Deno.test("sw.js precaches chart_popout.js so mobile users get the feature", async () => {
  const sw = await Deno.readTextFile(
    new URL("../docs/sw.js", import.meta.url),
  );
  assert(
    sw.includes('"./chart_popout.js"'),
    "sw.js STATIC_ASSETS must precache chart_popout.js",
  );
});
