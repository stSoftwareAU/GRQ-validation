// Tests for the chart pop-out → dashboard reconciliation (issue #453, part of
// the full-screen landscape pop-out milestone #446).
//
// The mobile pop-out re-parents the single live #performanceChart canvas into a
// full-viewport overlay and back (issue #451). While it owns the canvas the
// device class has NOT changed, so the dashboard's viewport sync must stay idle:
// otherwise a resize/orientation event fired while the overlay is open would
// rebuild the chart/summary and clear the mobile colour key behind the overlay,
// leaving it stale when the canvas returns on close.
//
// docs/chart_popout.js owns two pieces of that contract, both exercised here
// against the REAL shipped module:
//   - isPopoutOpen(doc): the predicate the app's syncChartForViewport() consults
//     to suspend the breakpoint reconciliation while the overlay is open;
//   - the onClose hook: run once the canvas is back in the dashboard so the app
//     can reconcile the colour key + native legend to the real viewport.
//
// The dependency-injected core only touches classList / hidden / appendChild /
// focus, so a tiny fake DOM drives it headless, mirroring chart_popout_test.ts.
import { assert, assertEquals } from "@std/assert";
import "../docs/chart_popout.js";

// ---------------------------------------------------------------------------
// Minimal fake DOM — only the surface chart_popout.js actually touches.
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
    if (this.doc) this.doc.activeElement = this;
  }
}

class FakeDocument {
  activeElement: FakeElement | null = null;
  body = new FakeElement("body");
}

const g = globalThis as unknown as {
  GRQChartPopout: {
    BODY_OPEN_CLASS: string;
    // deno-lint-ignore no-explicit-any
    isPopoutOpen: (doc: any) => boolean;
    // deno-lint-ignore no-explicit-any
    openPopout: (ctx: any) => boolean;
    // deno-lint-ignore no-explicit-any
    closePopout: (ctx: any) => boolean;
    createChartPopout: (opts: unknown) => {
      open: () => boolean;
      close: () => boolean;
      isOpen: () => boolean;
    } | null;
  };
};
const GRQChartPopout = g.GRQChartPopout;

// A stand-in dashboard: a chart whose native legend is toggled by the viewport,
// and a #chartColorKey container the app populates on mobile / clears on desktop.
// `syncViewport` mirrors docs/app.js syncChartForViewport(): it consults the REAL
// isPopoutOpen() to stay idle while the overlay is open, then sets the legend and
// (re)renders the colour key from the live "datasets" for the current device.
function makeDashboard() {
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
  const colorKey = new FakeElement("chartColorKey");
  for (const el of Object.values(elements)) el.doc = doc;
  container.doc = doc;
  colorKey.doc = doc;
  (colorKey as unknown as { innerHTML: string }).innerHTML = "";

  // Live datasets are the single source of truth for both legend and key.
  const colorKeyEl = colorKey as unknown as { innerHTML: string };
  const chart = {
    options: { plugins: { legend: { display: true } } },
    resize() {},
    update() {},
  };

  let isMobile = true;
  let rebuilds = 0;

  // Mirror of app.js renderColorKey(): mobile mirrors the datasets, desktop
  // clears the key (the native legend takes over).
  function renderColorKey() {
    colorKeyEl.innerHTML = isMobile
      ? "<chip>SP500</chip><chip>NASDAQ</chip>"
      : "";
  }

  function syncViewport() {
    // Suspend while the pop-out owns the canvas — the real predicate under test.
    if (GRQChartPopout.isPopoutOpen(doc)) return;
    rebuilds++;
    chart.options.plugins.legend.display = !isMobile;
    renderColorKey();
  }

  const fakeDoc = {
    body: doc.body,
    get activeElement() {
      return doc.activeElement;
    },
    getElementById: (id: string) => elements[id] ?? null,
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  return {
    doc,
    fakeDoc,
    chart,
    colorKey: colorKeyEl,
    syncViewport,
    setMobile: (v: boolean) => (isMobile = v),
    rebuildCount: () => rebuilds,
  };
}

Deno.test("isPopoutOpen - reflects the body contract class", () => {
  const doc = new FakeDocument();
  assertEquals(GRQChartPopout.isPopoutOpen(doc), false, "closed by default");
  doc.body.classList.add(GRQChartPopout.BODY_OPEN_CLASS);
  assertEquals(
    GRQChartPopout.isPopoutOpen(doc),
    true,
    "true once class is set",
  );
  doc.body.classList.remove(GRQChartPopout.BODY_OPEN_CLASS);
  assertEquals(GRQChartPopout.isPopoutOpen(doc), false, "false once removed");
});

Deno.test("isPopoutOpen - tolerates a missing/partial document", () => {
  assertEquals(GRQChartPopout.isPopoutOpen(null), false);
  assertEquals(GRQChartPopout.isPopoutOpen({}), false);
  assertEquals(GRQChartPopout.isPopoutOpen({ body: {} }), false);
});

Deno.test("syncChartForViewport stays idle while the pop-out is open", () => {
  const d = makeDashboard();
  d.setMobile(true);
  d.syncViewport(); // establish the mobile baseline
  const baseRebuilds = d.rebuildCount();

  const controller = GRQChartPopout.createChartPopout({
    document: d.fakeDoc,
    getChart: () => d.chart,
    onClose: () => d.syncViewport(),
  })!;
  assert(controller, "controller must build from the fake dashboard");

  controller.open();

  // A resize fires while open and the device crosses into the desktop class.
  // The sync must be SUSPENDED: no rebuild, legend + colour key left untouched.
  d.setMobile(false);
  d.syncViewport();
  assertEquals(d.rebuildCount(), baseRebuilds, "no rebuild while overlay open");
  assertEquals(
    d.chart.options.plugins.legend.display,
    false,
    "legend must not flip on while the pop-out is open",
  );
  assertEquals(
    d.colorKey.innerHTML,
    "<chip>SP500</chip><chip>NASDAQ</chip>",
    "colour key must not be cleared while the pop-out is open",
  );
});

Deno.test("closing the pop-out preserves the colour key and legend (open/close)", () => {
  const d = makeDashboard();
  d.setMobile(true);
  d.syncViewport();
  const legendBefore = d.chart.options.plugins.legend.display;
  const keyBefore = d.colorKey.innerHTML;
  assertEquals(legendBefore, false, "mobile: native legend hidden");
  assertEquals(keyBefore, "<chip>SP500</chip><chip>NASDAQ</chip>");

  const controller = GRQChartPopout.createChartPopout({
    document: d.fakeDoc,
    getChart: () => d.chart,
    onClose: () => d.syncViewport(),
  })!;

  controller.open();
  controller.close();

  assertEquals(controller.isOpen(), false, "overlay closed");
  assertEquals(
    d.chart.options.plugins.legend.display,
    legendBefore,
    "native legend identical to before opening",
  );
  assertEquals(
    d.colorKey.innerHTML,
    keyBefore,
    "mobile colour key identical to before opening",
  );
});

Deno.test("closing preserves state across an open → rotate → close cycle", () => {
  const d = makeDashboard();
  d.setMobile(true);
  d.syncViewport();
  const legendBefore = d.chart.options.plugins.legend.display;
  const keyBefore = d.colorKey.innerHTML;

  const controller = GRQChartPopout.createChartPopout({
    document: d.fakeDoc,
    getChart: () => d.chart,
    onClose: () => d.syncViewport(),
  })!;

  controller.open();
  // Rotate to landscape while open: a resize crosses the breakpoint but is
  // suspended, so nothing changes behind the overlay.
  d.setMobile(false);
  d.syncViewport();
  // Rotate back to portrait before closing (the device returns to its class).
  d.setMobile(true);

  controller.close();

  assertEquals(
    d.chart.options.plugins.legend.display,
    legendBefore,
    "native legend identical after open → rotate → close",
  );
  assertEquals(
    d.colorKey.innerHTML,
    keyBefore,
    "colour key identical after open → rotate → close",
  );
});

Deno.test("onClose reconcile is optional - close still works without it", () => {
  const d = makeDashboard();
  const controller = GRQChartPopout.createChartPopout({
    document: d.fakeDoc,
    getChart: () => d.chart,
  })!;
  controller.open();
  assertEquals(controller.isOpen(), true);
  controller.close();
  assertEquals(
    controller.isOpen(),
    false,
    "closes cleanly with no onClose hook",
  );
});
