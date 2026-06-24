// Tests for the ?fullscreen=1 boot parameter (issue #482, part of the
// URL-parameters-for-dashboard-state milestone #450).
//
// A transient `?fullscreen=1` URL parameter opens the existing mobile chart
// pop-out (issue #451) on page load. It is mobile-only — desktop is a hard
// no-op — and visit-only (never persisted), mirroring `?theme=`. The decision
// lives in the pure GRQChartPopout helpers (fullscreenRequested /
// shouldOpenFullscreen / openFullscreenOnLoad), so these tests exercise the
// REAL shipped logic headlessly via a tiny fake pop-out controller — no DOM.
import { assert, assertEquals } from "@std/assert";
import "../docs/chart_popout.js";

const g = globalThis as unknown as {
  GRQChartPopout: {
    fullscreenRequested: (search: string) => boolean;
    // deno-lint-ignore no-explicit-any
    shouldOpenFullscreen: (opts: any) => boolean;
    // deno-lint-ignore no-explicit-any
    openFullscreenOnLoad: (opts: any) => boolean;
  };
};
const GRQChartPopout = g.GRQChartPopout;

// A minimal stand-in for the controller returned by createChartPopout(): just
// the open()/isOpen() surface the boot helper consults, with a call counter.
function makePopout(initiallyOpen = false) {
  let open = initiallyOpen;
  let openCalls = 0;
  return {
    openCalls: () => openCalls,
    open() {
      openCalls++;
      open = true;
      return true;
    },
    isOpen: () => open,
  };
}

Deno.test("chart_popout.js publishes the fullscreen boot helpers", () => {
  assertEquals(typeof GRQChartPopout.fullscreenRequested, "function");
  assertEquals(typeof GRQChartPopout.shouldOpenFullscreen, "function");
  assertEquals(typeof GRQChartPopout.openFullscreenOnLoad, "function");
});

// --- fullscreenRequested ----------------------------------------------------

Deno.test("fullscreenRequested - true only for fullscreen=1", () => {
  assertEquals(GRQChartPopout.fullscreenRequested("?fullscreen=1"), true);
  assertEquals(GRQChartPopout.fullscreenRequested("fullscreen=1"), true);
  assertEquals(
    GRQChartPopout.fullscreenRequested("?theme=dark&fullscreen=1"),
    true,
  );
});

Deno.test("fullscreenRequested - false for any other value", () => {
  assertEquals(GRQChartPopout.fullscreenRequested("?fullscreen=0"), false);
  assertEquals(GRQChartPopout.fullscreenRequested("?fullscreen=2"), false);
  assertEquals(GRQChartPopout.fullscreenRequested("?fullscreen=true"), false);
  assertEquals(GRQChartPopout.fullscreenRequested("?fullscreen="), false);
});

Deno.test("fullscreenRequested - false when the param is absent", () => {
  assertEquals(GRQChartPopout.fullscreenRequested(""), false);
  assertEquals(GRQChartPopout.fullscreenRequested("?theme=dark"), false);
});

Deno.test("fullscreenRequested - degrades to false on bad input", () => {
  // null/undefined are coerced to an empty search rather than throwing.
  assertEquals(
    GRQChartPopout.fullscreenRequested(null as unknown as string),
    false,
  );
  assertEquals(
    GRQChartPopout.fullscreenRequested(undefined as unknown as string),
    false,
  );
});

// --- shouldOpenFullscreen ---------------------------------------------------

Deno.test("shouldOpenFullscreen - true on mobile with the param and a closed pop-out", () => {
  assertEquals(
    GRQChartPopout.shouldOpenFullscreen({
      search: "?fullscreen=1",
      isMobile: true,
      popout: makePopout(false),
    }),
    true,
  );
});

Deno.test("shouldOpenFullscreen - desktop is a hard no-op even with the param", () => {
  assertEquals(
    GRQChartPopout.shouldOpenFullscreen({
      search: "?fullscreen=1",
      isMobile: false,
      popout: makePopout(false),
    }),
    false,
  );
});

Deno.test("shouldOpenFullscreen - false without the param on mobile", () => {
  assertEquals(
    GRQChartPopout.shouldOpenFullscreen({
      search: "?theme=dark",
      isMobile: true,
      popout: makePopout(false),
    }),
    false,
  );
});

Deno.test("shouldOpenFullscreen - false when already open", () => {
  assertEquals(
    GRQChartPopout.shouldOpenFullscreen({
      search: "?fullscreen=1",
      isMobile: true,
      popout: makePopout(true),
    }),
    false,
  );
});

Deno.test("shouldOpenFullscreen - false when the controller is absent", () => {
  assertEquals(
    GRQChartPopout.shouldOpenFullscreen({
      search: "?fullscreen=1",
      isMobile: true,
      popout: null,
    }),
    false,
  );
});

// --- openFullscreenOnLoad ---------------------------------------------------

Deno.test("openFullscreenOnLoad - opens the pop-out on mobile with the param", () => {
  const popout = makePopout(false);
  const opened = GRQChartPopout.openFullscreenOnLoad({
    search: "?fullscreen=1",
    isMobile: true,
    popout,
  });
  assert(opened, "should report it opened");
  assertEquals(popout.openCalls(), 1, "controller.open() called exactly once");
  assertEquals(popout.isOpen(), true);
});

Deno.test("openFullscreenOnLoad - desktop never calls open()", () => {
  const popout = makePopout(false);
  const opened = GRQChartPopout.openFullscreenOnLoad({
    search: "?fullscreen=1",
    isMobile: false,
    popout,
  });
  assertEquals(opened, false, "desktop must be a no-op");
  assertEquals(popout.openCalls(), 0, "open() must never be called on desktop");
  assertEquals(popout.isOpen(), false);
});

Deno.test("openFullscreenOnLoad - no param never calls open()", () => {
  const popout = makePopout(false);
  const opened = GRQChartPopout.openFullscreenOnLoad({
    search: "",
    isMobile: true,
    popout,
  });
  assertEquals(opened, false);
  assertEquals(popout.openCalls(), 0);
});

Deno.test("openFullscreenOnLoad - degrades to a no-op without a controller", () => {
  const opened = GRQChartPopout.openFullscreenOnLoad({
    search: "?fullscreen=1",
    isMobile: true,
    popout: null,
  });
  assertEquals(opened, false, "missing controller must not throw");
});
