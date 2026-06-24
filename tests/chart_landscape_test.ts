// Tests for the landscape presentation inside the mobile chart pop-out
// (issue #452, part of the full-screen landscape pop-out milestone #446).
//
// Building on the #451 overlay contract, the chart is presented in landscape so
// a wide chart is readable on a portrait phone. Two layers cover every device:
//   - a pure-CSS rotation (the robust baseline that carries iOS Safari, which
//     has no orientation lock), verified by reading docs/styles.css; and
//   - an optional Screen Orientation lock attempted only where supported,
//     driven by pure decision helpers in docs/chart_popout.js that these tests
//     exercise headless via injected screen/viewport stubs.
//
// The helpers are dependency-injected (they touch only the passed screen /
// viewport), so a tiny fake drives the REAL shipped logic rather than a copy.
import { assert, assertEquals } from "@std/assert";
import "../docs/chart_popout.js";

// deno-lint-ignore no-explicit-any
const GRQ = (globalThis as any).GRQChartPopout;

// ---------------------------------------------------------------------------
// Pure helper: isPortraitViewport
// ---------------------------------------------------------------------------
Deno.test("isPortraitViewport - true when taller than wide", () => {
  assertEquals(
    GRQ.isPortraitViewport({ innerWidth: 390, innerHeight: 844 }),
    true,
  );
});

Deno.test("isPortraitViewport - false when wider than tall (landscape)", () => {
  assertEquals(
    GRQ.isPortraitViewport({ innerWidth: 844, innerHeight: 390 }),
    false,
  );
});

Deno.test("isPortraitViewport - false for a square or missing viewport", () => {
  assertEquals(
    GRQ.isPortraitViewport({ innerWidth: 500, innerHeight: 500 }),
    false,
  );
  assertEquals(GRQ.isPortraitViewport(null), false);
  assertEquals(GRQ.isPortraitViewport({}), false);
});

// ---------------------------------------------------------------------------
// Pure helper: supportsOrientationLock (capability detection)
// ---------------------------------------------------------------------------
Deno.test("supportsOrientationLock - true when screen.orientation.lock is a function", () => {
  const screen = {
    orientation: { lock: () => Promise.resolve(), unlock: () => {} },
  };
  assertEquals(GRQ.supportsOrientationLock(screen), true);
});

Deno.test("supportsOrientationLock - false on iOS Safari (orientation present, no lock)", () => {
  // iOS Safari exposes screen.orientation but not .lock().
  const iosScreen = { orientation: { type: "portrait-primary" } };
  assertEquals(GRQ.supportsOrientationLock(iosScreen), false);
});

Deno.test("supportsOrientationLock - false when screen/orientation absent", () => {
  assertEquals(GRQ.supportsOrientationLock(null), false);
  assertEquals(GRQ.supportsOrientationLock({}), false);
});

// ---------------------------------------------------------------------------
// Pure helper: chooseLandscapePresentation (chosen presentation)
// ---------------------------------------------------------------------------
Deno.test("chooseLandscapePresentation - portrait + lock support => orientation-lock", () => {
  assertEquals(
    GRQ.chooseLandscapePresentation({ portrait: true, lockSupported: true }),
    "orientation-lock",
  );
});

Deno.test("chooseLandscapePresentation - portrait without lock => css-rotate fallback", () => {
  assertEquals(
    GRQ.chooseLandscapePresentation({ portrait: true, lockSupported: false }),
    "css-rotate",
  );
});

Deno.test("chooseLandscapePresentation - already landscape => native (no rotation)", () => {
  assertEquals(
    GRQ.chooseLandscapePresentation({ portrait: false, lockSupported: true }),
    "native",
  );
  assertEquals(
    GRQ.chooseLandscapePresentation({ portrait: false, lockSupported: false }),
    "native",
  );
});

// ---------------------------------------------------------------------------
// requestLandscapeLock — attempts the lock, swallows rejection, no-ops on iOS
// ---------------------------------------------------------------------------
Deno.test("requestLandscapeLock - requests landscape where supported", () => {
  let lockedTo: string | null = null;
  const screen = {
    orientation: {
      lock(o: string) {
        lockedTo = o;
        return Promise.resolve();
      },
      unlock() {},
    },
  };
  assertEquals(GRQ.requestLandscapeLock(screen), "requested");
  assertEquals(lockedTo, "landscape");
});

Deno.test("requestLandscapeLock - silently swallows a rejected lock promise", () => {
  const screen = {
    orientation: {
      // The API exists but the platform refuses (a common mobile case).
      lock: () => Promise.reject(new Error("not allowed")),
      unlock() {},
    },
  };
  // Must report it attempted and must NOT throw / leave an unhandled rejection.
  assertEquals(GRQ.requestLandscapeLock(screen), "requested");
});

Deno.test("requestLandscapeLock - no-op (unsupported) on iOS Safari", () => {
  const iosScreen = { orientation: { type: "portrait-primary" } };
  assertEquals(GRQ.requestLandscapeLock(iosScreen), "unsupported");
});

Deno.test("requestLandscapeLock - tolerates a throwing lock()", () => {
  const screen = {
    orientation: {
      lock() {
        throw new Error("boom");
      },
      unlock() {},
    },
  };
  assertEquals(GRQ.requestLandscapeLock(screen), "unsupported");
});

// ---------------------------------------------------------------------------
// releaseOrientationLock
// ---------------------------------------------------------------------------
Deno.test("releaseOrientationLock - unlocks where supported", () => {
  let unlocked = 0;
  const screen = {
    orientation: { lock: () => Promise.resolve(), unlock: () => unlocked++ },
  };
  assertEquals(GRQ.releaseOrientationLock(screen), true);
  assertEquals(unlocked, 1);
});

Deno.test("releaseOrientationLock - silent no-op where unlock is absent", () => {
  const iosScreen = { orientation: { type: "portrait-primary" } };
  assertEquals(GRQ.releaseOrientationLock(iosScreen), false);
  assertEquals(GRQ.releaseOrientationLock(null), false);
});

// ---------------------------------------------------------------------------
// createChartPopout wiring: lock on open, unlock on close, resize on rotate.
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
  focus() {}
}

function makeWiring(portrait: boolean, lockSupported: boolean) {
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
  let lockArg: string | null = null;
  let unlockCount = 0;
  if (lockSupported) {
    orientation.lock = (o: string) => {
      lockArg = o;
      return Promise.resolve();
    };
    orientation.unlock = () => {
      unlockCount++;
    };
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
  return {
    controller,
    chart,
    getLockArg: () => lockArg,
    getUnlockCount: () => unlockCount,
  };
}

Deno.test("createChartPopout - attempts a landscape lock on open (portrait + supported)", () => {
  const w = makeWiring(true, true);
  w.controller.open();
  assertEquals(w.getLockArg(), "landscape", "should request landscape lock");
  w.controller.close();
  assertEquals(w.getUnlockCount(), 1, "should release the lock on close");
});

Deno.test("createChartPopout - does NOT lock when already landscape", () => {
  const w = makeWiring(false, true);
  w.controller.open();
  assertEquals(w.getLockArg(), null, "no lock needed when already landscape");
});

Deno.test("createChartPopout - no lock attempt on iOS-style screen (graceful)", () => {
  const w = makeWiring(true, false); // portrait, no lock support
  // Must not throw; CSS fallback carries the presentation.
  w.controller.open();
  assertEquals(w.controller.isOpen(), true);
});

Deno.test("createChartPopout - resizes the chart on rotate/resize while open", () => {
  const w = makeWiring(true, false);
  w.controller.open();
  const before = w.chart.resizeCount;
  globalThis.dispatchEvent(new Event("orientationchange"));
  assert(
    w.chart.resizeCount > before,
    "chart must resize on orientationchange while the pop-out is open",
  );
  w.controller.close();
  const afterClose = w.chart.resizeCount;
  globalThis.dispatchEvent(new Event("orientationchange"));
  assertEquals(
    w.chart.resizeCount,
    afterClose,
    "no resize from this controller once closed",
  );
});

// ---------------------------------------------------------------------------
// Pure-CSS landscape rotation (the robust baseline) in docs/styles.css.
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

Deno.test("styles.css - portrait pop-out rotates the chart into landscape", async () => {
  const css = await Deno.readTextFile(
    new URL("../docs/styles.css", import.meta.url),
  );
  const block = portraitMediaBlock(css);
  assert(block, "a portrait + mobile media block must exist for the pop-out");
  const body = ruleBody(block!, ".chart-popout-body");
  assert(body, ".chart-popout-body must be styled inside the portrait block");
  assert(/rotate\(90deg\)/.test(body!), "chart body must be rotated 90deg");
  // Sized to the SWAPPED viewport so the rotated box fills the screen.
  assert(
    /width:\s*100vh/.test(body!),
    "body width must be the long edge (100vh)",
  );
  assert(
    /height:\s*100vw/.test(body!),
    "body height must be the short edge (100vw)",
  );
});
