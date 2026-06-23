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
    MOBILE_WINDOW_DAYS_DEFAULT: number;
    ALLOWED_WINDOW_DAYS: number[];
    normaliseWindowDays: (value: unknown) => number;
    readMobileWindowDays: (storage?: unknown) => number;
    writeMobileWindowDays: (value: unknown, storage?: unknown) => boolean;
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
  assertEquals(S.MOBILE_WINDOW_DAYS_DEFAULT, 90);
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

Deno.test("normaliseWindowDays falls back to 90 for junk", () => {
  assertEquals(S.normaliseWindowDays("abc"), 90);
  assertEquals(S.normaliseWindowDays(0), 90);
  assertEquals(S.normaliseWindowDays(30), 90);
  assertEquals(S.normaliseWindowDays(""), 90);
  assertEquals(S.normaliseWindowDays(null), 90);
  assertEquals(S.normaliseWindowDays(undefined), 90);
  assertEquals(S.normaliseWindowDays({}), 90);
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

Deno.test("writeMobileWindowDays normalises junk to 90 before persisting", () => {
  const store = fakeStorage();
  assertEquals(S.writeMobileWindowDays(365, store), true);
  assertEquals(store._dump()[S.STORAGE_KEY], "90");
  assertEquals(S.readMobileWindowDays(store), 90);
});

Deno.test("readMobileWindowDays returns the default when storage is empty", () => {
  assertEquals(S.readMobileWindowDays(fakeStorage()), 90);
});

Deno.test("readMobileWindowDays tolerates a corrupt stored value", () => {
  const store = fakeStorage({ [S.STORAGE_KEY]: "garbage" });
  assertEquals(S.readMobileWindowDays(store), 90);
});

// --- unavailable storage (private mode) ------------------------------------

Deno.test("read falls back to default when storage throws", () => {
  const store = throwingStorage();
  assertEquals(S.readMobileWindowDays(store), 90);
});

Deno.test("write reports failure (not throw) when storage is unavailable", () => {
  const store = throwingStorage();
  assertEquals(S.writeMobileWindowDays(180, store), false);
});

Deno.test("read/write fall back to default when no storage is available", () => {
  // Passing an explicit null storage models a non-browser / no-localStorage
  // environment without depending on the ambient global.
  assertEquals(S.readMobileWindowDays(null), 90);
  assertEquals(S.writeMobileWindowDays(180, null), false);
});
