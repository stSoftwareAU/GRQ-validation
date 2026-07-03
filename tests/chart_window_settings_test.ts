// Behavioural tests for the per-device mobile chart-window settings helper
// (issue #447, sub-issue of milestone #445).
//
// These import the REAL shipped helpers from docs/chart_window_settings.js —
// the same pure functions the toggle UI will use to remember the user's mobile
// chart window (90 or 180 days) across visits via localStorage. The module
// publishes its helpers on globalThis.GRQChartWindow (mirroring
// docs/trend_settings.js) and guards every storage access, so it imports
// cleanly under Deno and tolerates absent / corrupt / unavailable storage.
//
// Storage is injectable: every read/write accepts a storage object so the tests
// drive deterministic behaviour without touching the real localStorage.
import { assert, assertEquals } from "@std/assert";
import "../docs/chart_window_settings.js";

const g = globalThis as unknown as {
  GRQChartWindow: {
    STORAGE_KEY: string;
    DESKTOP_STORAGE_KEY: string;
    MOBILE_WINDOW_DAYS_DEFAULT: number;
    DESKTOP_WINDOW_DAYS_DEFAULT: number;
    ALLOWED_WINDOW_DAYS: number[];
    normaliseWindowDays: (value: unknown, fallback?: number) => number;
    readMobileWindowDays: (storage?: unknown) => number;
    writeMobileWindowDays: (value: unknown, storage?: unknown) => boolean;
    readDesktopWindowDays: (storage?: unknown) => number;
    writeDesktopWindowDays: (value: unknown, storage?: unknown) => boolean;
  };
};

const S = g.GRQChartWindow;

// A minimal in-memory Web Storage stand-in for deterministic tests.
function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem(key: string): string | null {
      return map.has(key) ? map.get(key)! : null;
    },
    setItem(key: string, value: string): void {
      map.set(key, String(value));
    },
    removeItem(key: string): void {
      map.delete(key);
    },
    // Test-only peek.
    _dump(): Record<string, string> {
      return Object.fromEntries(map);
    },
  };
}

// Storage that throws on every access — models private mode / disabled storage.
function throwingStorage() {
  return {
    getItem(): string {
      throw new Error("storage unavailable");
    },
    setItem(): void {
      throw new Error("storage unavailable");
    },
    removeItem(): void {
      throw new Error("storage unavailable");
    },
  };
}

Deno.test("GRQChartWindow is published on globalThis", () => {
  assert(
    S,
    "chart_window_settings.js should publish globalThis.GRQChartWindow",
  );
  // Issue #711: the mobile default is now 180 (the full window) on every form
  // factor, matching desktop.
  assertEquals(S.MOBILE_WINDOW_DAYS_DEFAULT, 180);
  assertEquals(S.ALLOWED_WINDOW_DAYS, [90, 180]);
});

Deno.test("STORAGE_KEY is namespaced under grq.chart.*", () => {
  assert(S.STORAGE_KEY.startsWith("grq.chart."));
  assertEquals(S.STORAGE_KEY, "grq.chart.mobileWindowDays");
});

// --- normaliseWindowDays ---------------------------------------------------

Deno.test("normaliseWindowDays keeps the two allowed windows", () => {
  assertEquals(S.normaliseWindowDays(90), 90);
  assertEquals(S.normaliseWindowDays(180), 180);
});

Deno.test("normaliseWindowDays coerces numeric strings", () => {
  assertEquals(S.normaliseWindowDays("90"), 90);
  assertEquals(S.normaliseWindowDays("180"), 180);
});

// Issue #711: with no explicit fallback, junk now normalises to the 180 default
// (previously 90).
Deno.test("normaliseWindowDays falls back to 180 for junk", () => {
  assertEquals(S.normaliseWindowDays("abc"), 180);
  assertEquals(S.normaliseWindowDays(0), 180);
  assertEquals(S.normaliseWindowDays(30), 180);
  assertEquals(S.normaliseWindowDays(""), 180);
  assertEquals(S.normaliseWindowDays(null), 180);
  assertEquals(S.normaliseWindowDays(undefined), 180);
  assertEquals(S.normaliseWindowDays({}), 180);
});

// --- round-trip ------------------------------------------------------------

Deno.test("write then read round-trips 90", () => {
  const store = fakeStorage();
  assertEquals(S.writeMobileWindowDays(90, store), true);
  assertEquals(S.readMobileWindowDays(store), 90);
  assertEquals(store._dump()[S.STORAGE_KEY], "90");
});

Deno.test("write then read round-trips 180", () => {
  const store = fakeStorage();
  assertEquals(S.writeMobileWindowDays(180, store), true);
  assertEquals(S.readMobileWindowDays(store), 180);
  assertEquals(store._dump()[S.STORAGE_KEY], "180");
});

Deno.test("writeMobileWindowDays normalises junk to 180 before persisting", () => {
  // Issue #711: an out-of-range write falls back to the 180 default, not 90.
  const store = fakeStorage();
  assertEquals(S.writeMobileWindowDays(365, store), true);
  assertEquals(store._dump()[S.STORAGE_KEY], "180");
  assertEquals(S.readMobileWindowDays(store), 180);
});

Deno.test("readMobileWindowDays returns the 180 default when storage is empty", () => {
  // Issue #711: fresh device with nothing saved shows the full 180-day window.
  assertEquals(S.readMobileWindowDays(fakeStorage()), 180);
});

Deno.test("readMobileWindowDays tolerates a corrupt stored value (→180)", () => {
  const store = fakeStorage({ [S.STORAGE_KEY]: "garbage" });
  assertEquals(S.readMobileWindowDays(store), 180);
});

Deno.test("readMobileWindowDays returns an explicit saved 90 (opt-in preserved)", () => {
  // The user can still opt into 90; a valid saved choice is honoured over the
  // new 180 default.
  const store = fakeStorage({ [S.STORAGE_KEY]: "90" });
  assertEquals(S.readMobileWindowDays(store), 90);
});

// --- unavailable storage (private mode) ------------------------------------

Deno.test("read falls back to default when storage throws", () => {
  const store = throwingStorage();
  assertEquals(S.readMobileWindowDays(store), 180);
});

Deno.test("write reports failure (not throw) when storage is unavailable", () => {
  const store = throwingStorage();
  assertEquals(S.writeMobileWindowDays(180, store), false);
});

Deno.test("read/write fall back to default when no storage is available", () => {
  // Passing an explicit null storage models a non-browser / no-localStorage
  // environment without depending on the ambient global.
  assertEquals(S.readMobileWindowDays(null), 180);
  assertEquals(S.writeMobileWindowDays(180, null), false);
});

// --- desktop chart window (issue #465) -------------------------------------

Deno.test("GRQChartWindow publishes desktop helpers and a 180 default", () => {
  assertEquals(S.DESKTOP_WINDOW_DAYS_DEFAULT, 180);
  assertEquals(typeof S.readDesktopWindowDays, "function");
  assertEquals(typeof S.writeDesktopWindowDays, "function");
});

Deno.test("DESKTOP_STORAGE_KEY is its own grq.chart.* key", () => {
  assert(S.DESKTOP_STORAGE_KEY.startsWith("grq.chart."));
  assertEquals(S.DESKTOP_STORAGE_KEY, "grq.chart.desktopWindowDays");
  // Desktop must not reuse the mobile key, or a desktop write would regress
  // mobile's 90-day default.
  assert(S.DESKTOP_STORAGE_KEY !== S.STORAGE_KEY);
});

Deno.test("normaliseWindowDays honours an explicit desktop fallback of 180", () => {
  assertEquals(S.normaliseWindowDays("junk", 180), 180);
  assertEquals(S.normaliseWindowDays(30, 180), 180);
  assertEquals(S.normaliseWindowDays(null, 180), 180);
  // Allowed values still pass through unchanged.
  assertEquals(S.normaliseWindowDays(90, 180), 90);
  assertEquals(S.normaliseWindowDays(180, 180), 180);
});

Deno.test("readDesktopWindowDays returns 180 when storage is empty", () => {
  assertEquals(S.readDesktopWindowDays(fakeStorage()), 180);
});

Deno.test("readDesktopWindowDays returns 180 when no storage is available", () => {
  assertEquals(S.readDesktopWindowDays(null), 180);
});

Deno.test("desktop write then read round-trips 90", () => {
  const store = fakeStorage();
  assertEquals(S.writeDesktopWindowDays(90, store), true);
  assertEquals(S.readDesktopWindowDays(store), 90);
  assertEquals(store._dump()[S.DESKTOP_STORAGE_KEY], "90");
});

Deno.test("desktop write then read round-trips 180", () => {
  const store = fakeStorage();
  assertEquals(S.writeDesktopWindowDays(180, store), true);
  assertEquals(S.readDesktopWindowDays(store), 180);
  assertEquals(store._dump()[S.DESKTOP_STORAGE_KEY], "180");
});

Deno.test("writeDesktopWindowDays normalises out-of-range to 180 before persisting", () => {
  const store = fakeStorage();
  assertEquals(S.writeDesktopWindowDays(365, store), true);
  assertEquals(store._dump()[S.DESKTOP_STORAGE_KEY], "180");
  assertEquals(S.readDesktopWindowDays(store), 180);
});

Deno.test("readDesktopWindowDays tolerates a corrupt stored value (→180)", () => {
  const store = fakeStorage({ [S.DESKTOP_STORAGE_KEY]: "garbage" });
  assertEquals(S.readDesktopWindowDays(store), 180);
});

Deno.test("desktop read falls back to 180 when storage throws", () => {
  assertEquals(S.readDesktopWindowDays(throwingStorage()), 180);
});

Deno.test("desktop write reports failure (not throw) when storage is unavailable", () => {
  assertEquals(S.writeDesktopWindowDays(90, throwingStorage()), false);
  assertEquals(S.writeDesktopWindowDays(90, null), false);
});

// --- independence: desktop and mobile never cross-contaminate ---------------

Deno.test("writing the desktop key never changes readMobileWindowDays", () => {
  const store = fakeStorage();
  assertEquals(S.writeDesktopWindowDays(90, store), true);
  // Mobile still reads its own default (180, issue #711) — the desktop write of
  // 90 did not touch the mobile key.
  assertEquals(S.readMobileWindowDays(store), 180);
  // Only the desktop key was written.
  assertEquals(store._dump()[S.STORAGE_KEY], undefined);
  assertEquals(store._dump()[S.DESKTOP_STORAGE_KEY], "90");
});

Deno.test("writing the mobile key never changes readDesktopWindowDays", () => {
  const store = fakeStorage();
  assertEquals(S.writeMobileWindowDays(90, store), true);
  // Desktop still reads its own 180 default — the mobile write did not touch it.
  assertEquals(S.readDesktopWindowDays(store), 180);
  assertEquals(store._dump()[S.DESKTOP_STORAGE_KEY], undefined);
  assertEquals(store._dump()[S.STORAGE_KEY], "90");
});

Deno.test("desktop and mobile choices coexist independently", () => {
  const store = fakeStorage();
  assertEquals(S.writeMobileWindowDays(180, store), true);
  assertEquals(S.writeDesktopWindowDays(90, store), true);
  assertEquals(S.readMobileWindowDays(store), 180);
  assertEquals(S.readDesktopWindowDays(store), 90);
});

// --- issue #711: 180 is the default on every form factor -------------------

Deno.test("issue #711: both mobile and desktop default to 180 with nothing saved", () => {
  const store = fakeStorage();
  assertEquals(S.readMobileWindowDays(store), 180);
  assertEquals(S.readDesktopWindowDays(store), 180);
  assertEquals(S.MOBILE_WINDOW_DAYS_DEFAULT, 180);
  assertEquals(S.DESKTOP_WINDOW_DAYS_DEFAULT, 180);
});
