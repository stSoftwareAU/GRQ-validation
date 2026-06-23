// Behavioural tests for the Trend-view settings helper (issue #432, part of
// milestone #422).
//
// These import the REAL shipped helpers from docs/trend_settings.js — the same
// pure functions the Trend view will use to remember the user's grouping
// granularity and per-index on/off toggles across visits via localStorage. The
// module publishes its helpers on globalThis.GRQTrendSettings (mirroring
// docs/theme.js and docs/index_overlay.js) and guards every storage access, so
// it imports cleanly under Deno and tolerates absent / corrupt / unavailable
// storage.
//
// Storage is injectable: every read/write accepts a storage object so the tests
// drive deterministic behaviour without touching the real localStorage.
import { assert, assertEquals } from "@std/assert";
import "../docs/trend_settings.js";

const g = globalThis as unknown as {
  GRQTrendSettings: {
    GRANULARITIES: string[];
    DEFAULT_GROUPING: string;
    STORAGE_KEYS: { grouping: string; indices: string };
    normaliseGrouping: (value: unknown) => string;
    normaliseToggles: (
      toggles: unknown,
    ) => Record<string, boolean>;
    readGrouping: (storage?: unknown) => string;
    writeGrouping: (value: unknown, storage?: unknown) => boolean;
    readToggles: (storage?: unknown) => Record<string, boolean>;
    writeToggles: (toggles: unknown, storage?: unknown) => boolean;
    setIndexToggle: (
      key: string,
      on: unknown,
      storage?: unknown,
    ) => Record<string, boolean>;
    readTrendSettings: (
      storage?: unknown,
    ) => { grouping: string; toggles: Record<string, boolean> };
    writeTrendSettings: (settings: unknown, storage?: unknown) => boolean;
  };
};

const S = g.GRQTrendSettings;

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

Deno.test("GRQTrendSettings is published on globalThis", () => {
  assert(S, "trend_settings.js should publish globalThis.GRQTrendSettings");
  assertEquals(S.GRANULARITIES, ["day", "week", "month", "quarter"]);
  assertEquals(S.DEFAULT_GROUPING, "month");
});

Deno.test("STORAGE_KEYS are namespaced under grq.trend.*", () => {
  assert(S.STORAGE_KEYS.grouping.startsWith("grq.trend."));
  assert(S.STORAGE_KEYS.indices.startsWith("grq.trend."));
});

// --- normaliseGrouping -----------------------------------------------------

Deno.test("normaliseGrouping keeps the four valid granularities", () => {
  assertEquals(S.normaliseGrouping("day"), "day");
  assertEquals(S.normaliseGrouping("week"), "week");
  assertEquals(S.normaliseGrouping("month"), "month");
  assertEquals(S.normaliseGrouping("quarter"), "quarter");
});

Deno.test("normaliseGrouping falls back to month for junk", () => {
  assertEquals(S.normaliseGrouping("year"), "month");
  assertEquals(S.normaliseGrouping(""), "month");
  assertEquals(S.normaliseGrouping(null), "month");
  assertEquals(S.normaliseGrouping(undefined), "month");
  assertEquals(S.normaliseGrouping(42), "month");
});

// --- normaliseToggles ------------------------------------------------------

Deno.test("normaliseToggles defaults every index to off", () => {
  assertEquals(S.normaliseToggles(null), {
    sp500: false,
    nasdaq: false,
    russell2000: false,
  });
  assertEquals(S.normaliseToggles(undefined), {
    sp500: false,
    nasdaq: false,
    russell2000: false,
  });
});

Deno.test("normaliseToggles coerces values and ignores unknown keys", () => {
  assertEquals(
    S.normaliseToggles({ sp500: 1, nasdaq: "", bogus: true }),
    { sp500: true, nasdaq: false, russell2000: false },
  );
});

// --- grouping round-trip ---------------------------------------------------

Deno.test("writeGrouping then readGrouping round-trips a valid value", () => {
  const store = fakeStorage();
  assertEquals(S.writeGrouping("week", store), true);
  assertEquals(S.readGrouping(store), "week");
  assertEquals(store._dump()[S.STORAGE_KEYS.grouping], "week");
});

Deno.test("writeGrouping normalises junk to month before persisting", () => {
  const store = fakeStorage();
  assertEquals(S.writeGrouping("decade", store), true);
  assertEquals(store._dump()[S.STORAGE_KEYS.grouping], "month");
  assertEquals(S.readGrouping(store), "month");
});

Deno.test("readGrouping returns the default when storage is empty", () => {
  assertEquals(S.readGrouping(fakeStorage()), "month");
});

Deno.test("readGrouping tolerates a corrupt stored value", () => {
  const store = fakeStorage({ [S.STORAGE_KEYS.grouping]: "garbage" });
  assertEquals(S.readGrouping(store), "month");
});

// --- toggles round-trip ----------------------------------------------------

Deno.test("writeToggles then readToggles round-trips a full map", () => {
  const store = fakeStorage();
  assertEquals(
    S.writeToggles({ sp500: true, nasdaq: false, russell2000: true }, store),
    true,
  );
  assertEquals(S.readToggles(store), {
    sp500: true,
    nasdaq: false,
    russell2000: true,
  });
});

Deno.test("readToggles returns all-off defaults when storage is empty", () => {
  assertEquals(S.readToggles(fakeStorage()), {
    sp500: false,
    nasdaq: false,
    russell2000: false,
  });
});

Deno.test("readToggles tolerates corrupt (non-JSON) stored value", () => {
  const store = fakeStorage({ [S.STORAGE_KEYS.indices]: "{not json" });
  assertEquals(S.readToggles(store), {
    sp500: false,
    nasdaq: false,
    russell2000: false,
  });
});

Deno.test("readToggles normalises a partial stored object", () => {
  const store = fakeStorage({
    [S.STORAGE_KEYS.indices]: JSON.stringify({ nasdaq: true }),
  });
  assertEquals(S.readToggles(store), {
    sp500: false,
    nasdaq: true,
    russell2000: false,
  });
});

// --- setIndexToggle (write-on-change convenience) --------------------------

Deno.test("setIndexToggle flips a single index and persists the rest", () => {
  const store = fakeStorage();
  let toggles = S.setIndexToggle("sp500", true, store);
  assertEquals(toggles, { sp500: true, nasdaq: false, russell2000: false });

  toggles = S.setIndexToggle("russell2000", true, store);
  assertEquals(toggles, { sp500: true, nasdaq: false, russell2000: true });
  // Persisted across the two writes.
  assertEquals(S.readToggles(store), {
    sp500: true,
    nasdaq: false,
    russell2000: true,
  });

  toggles = S.setIndexToggle("sp500", false, store);
  assertEquals(toggles.sp500, false);
});

Deno.test("setIndexToggle ignores an unknown index key", () => {
  const store = fakeStorage();
  const toggles = S.setIndexToggle("dowjones", true, store);
  assertEquals(toggles, { sp500: false, nasdaq: false, russell2000: false });
});

// --- combined settings -----------------------------------------------------

Deno.test("writeTrendSettings then readTrendSettings round-trips both", () => {
  const store = fakeStorage();
  assertEquals(
    S.writeTrendSettings(
      { grouping: "quarter", toggles: { nasdaq: true } },
      store,
    ),
    true,
  );
  assertEquals(S.readTrendSettings(store), {
    grouping: "quarter",
    toggles: { sp500: false, nasdaq: true, russell2000: false },
  });
});

Deno.test("readTrendSettings returns defaults on first visit", () => {
  assertEquals(S.readTrendSettings(fakeStorage()), {
    grouping: "month",
    toggles: { sp500: false, nasdaq: false, russell2000: false },
  });
});

// --- unavailable storage (private mode) ------------------------------------

Deno.test("reads fall back to defaults when storage throws", () => {
  const store = throwingStorage();
  assertEquals(S.readGrouping(store), "month");
  assertEquals(S.readToggles(store), {
    sp500: false,
    nasdaq: false,
    russell2000: false,
  });
  assertEquals(S.readTrendSettings(store), {
    grouping: "month",
    toggles: { sp500: false, nasdaq: false, russell2000: false },
  });
});

Deno.test("writes report failure (not throw) when storage is unavailable", () => {
  const store = throwingStorage();
  assertEquals(S.writeGrouping("week", store), false);
  assertEquals(S.writeToggles({ sp500: true }, store), false);
  assertEquals(S.writeTrendSettings({ grouping: "day" }, store), false);
  // setIndexToggle still returns a sane in-memory map even when it cannot save.
  assertEquals(S.setIndexToggle("sp500", true, store), {
    sp500: true,
    nasdaq: false,
    russell2000: false,
  });
});

Deno.test("reads fall back to defaults when no storage is available", () => {
  // Passing an explicit null storage models a non-browser / no-localStorage
  // environment without depending on the ambient global.
  assertEquals(S.readGrouping(null), "month");
  assertEquals(S.readToggles(null), {
    sp500: false,
    nasdaq: false,
    russell2000: false,
  });
  assertEquals(S.writeGrouping("week", null), false);
});
