// Behavioural tests for the minimum-star-rating filter settings helper
// (issue #654, foundation sub-issue of milestone #653).
//
// These import the REAL shipped helpers from docs/star_filter_settings.js — the
// same pure functions the compact min-star control will use to remember the
// user's chosen whole-star threshold (0 = All, or 1–5) across visits and across
// the portfolio and Trend pages via a single localStorage key. The module
// publishes its helpers on globalThis.GRQStarFilter (mirroring
// docs/chart_window_settings.js / docs/trend_settings.js) and guards every
// storage access, so it imports cleanly under Deno and tolerates absent /
// corrupt / unavailable storage.
//
// Storage is injectable: every read/write accepts a storage object so the tests
// drive deterministic behaviour without touching the real localStorage.
import { assert, assertEquals } from "@std/assert";
import "../docs/star_filter_settings.js";

const g = globalThis as unknown as {
  GRQStarFilter: {
    STORAGE_KEY: string;
    CHANGE_EVENT: string;
    DEFAULT_MIN_STARS: number;
    ALLOWED_MIN_STARS: number[];
    normaliseMinStars: (value: unknown) => number;
    minStarsFromSearch: (search: unknown) => number | null;
    readMinStars: (storage?: unknown) => number;
    writeMinStars: (value: unknown, storage?: unknown) => boolean;
    getMinStars: () => number;
    setMinStars: (value: unknown, storage?: unknown) => number;
  };
};

const S = g.GRQStarFilter;

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

Deno.test("GRQStarFilter is published on globalThis", () => {
  assert(
    S,
    "star_filter_settings.js should publish globalThis.GRQStarFilter",
  );
  assertEquals(S.DEFAULT_MIN_STARS, 0);
  assertEquals(S.ALLOWED_MIN_STARS, [0, 1, 2, 3, 4, 5]);
});

Deno.test("STORAGE_KEY is namespaced under grq.filter.*", () => {
  assert(S.STORAGE_KEY.startsWith("grq.filter."));
  assertEquals(S.STORAGE_KEY, "grq.filter.minStars");
});

Deno.test("CHANGE_EVENT is the documented grq:star-filter-change name", () => {
  assertEquals(S.CHANGE_EVENT, "grq:star-filter-change");
});

// --- normaliseMinStars -----------------------------------------------------

Deno.test("normaliseMinStars keeps 0 (All) and the whole stars 1..5", () => {
  for (const n of [0, 1, 2, 3, 4, 5]) {
    assertEquals(S.normaliseMinStars(n), n);
  }
});

Deno.test("normaliseMinStars coerces numeric strings", () => {
  assertEquals(S.normaliseMinStars("0"), 0);
  assertEquals(S.normaliseMinStars("3"), 3);
  assertEquals(S.normaliseMinStars("5"), 5);
});

Deno.test("normaliseMinStars falls back to 0 for out-of-range / junk", () => {
  assertEquals(S.normaliseMinStars(-1), 0);
  assertEquals(S.normaliseMinStars(6), 0);
  assertEquals(S.normaliseMinStars(2.5), 0);
  assertEquals(S.normaliseMinStars("abc"), 0);
  assertEquals(S.normaliseMinStars(""), 0);
  assertEquals(S.normaliseMinStars(null), 0);
  assertEquals(S.normaliseMinStars(undefined), 0);
  assertEquals(S.normaliseMinStars({}), 0);
});

// --- minStarsFromSearch (deep-link param, issue #666) ----------------------

Deno.test("minStarsFromSearch reads a forced 0..5 ?stars value", () => {
  for (const n of [0, 1, 2, 3, 4, 5]) {
    assertEquals(S.minStarsFromSearch(`?stars=${n}`), n);
    // Leading "?" is optional; URLSearchParams tolerates either form.
    assertEquals(S.minStarsFromSearch(`stars=${n}`), n);
  }
});

Deno.test("minStarsFromSearch trims surrounding whitespace", () => {
  assertEquals(S.minStarsFromSearch("?stars=%203%20"), 3);
});

Deno.test("minStarsFromSearch returns null when the param is absent", () => {
  assertEquals(S.minStarsFromSearch("?window=180"), null);
  assertEquals(S.minStarsFromSearch(""), null);
  assertEquals(S.minStarsFromSearch(null), null);
  assertEquals(S.minStarsFromSearch(undefined), null);
});

Deno.test("minStarsFromSearch returns null for out-of-range / junk values", () => {
  assertEquals(S.minStarsFromSearch("?stars=6"), null);
  assertEquals(S.minStarsFromSearch("?stars=-1"), null);
  assertEquals(S.minStarsFromSearch("?stars=2.5"), null);
  assertEquals(S.minStarsFromSearch("?stars=abc"), null);
  assertEquals(S.minStarsFromSearch("?stars="), null);
});

Deno.test("minStarsFromSearch distinguishes a forced All (0) from absence", () => {
  // ?stars=0 is an explicit, valid "All" override (returns 0); a missing param
  // returns null so callers keep the persisted choice.
  assertEquals(S.minStarsFromSearch("?stars=0"), 0);
  assertEquals(S.minStarsFromSearch("?other=1"), null);
});

// --- round-trip ------------------------------------------------------------

Deno.test("write then read round-trips each allowed threshold", () => {
  for (const n of [0, 1, 2, 3, 4, 5]) {
    const store = fakeStorage();
    assertEquals(S.writeMinStars(n, store), true);
    assertEquals(S.readMinStars(store), n);
    assertEquals(store._dump()[S.STORAGE_KEY], String(n));
  }
});

Deno.test("writeMinStars normalises out-of-range to 0 before persisting", () => {
  const store = fakeStorage();
  assertEquals(S.writeMinStars(9, store), true);
  assertEquals(store._dump()[S.STORAGE_KEY], "0");
  assertEquals(S.readMinStars(store), 0);
});

Deno.test("readMinStars returns the default (0) when storage is empty", () => {
  assertEquals(S.readMinStars(fakeStorage()), 0);
});

Deno.test("readMinStars tolerates a corrupt stored value (→0)", () => {
  const store = fakeStorage({ [S.STORAGE_KEY]: "garbage" });
  assertEquals(S.readMinStars(store), 0);
});

// --- unavailable storage (private mode) ------------------------------------

Deno.test("read falls back to default when storage throws", () => {
  assertEquals(S.readMinStars(throwingStorage()), 0);
});

Deno.test("write reports failure (not throw) when storage is unavailable", () => {
  assertEquals(S.writeMinStars(3, throwingStorage()), false);
});

Deno.test("read/write fall back to default when no storage is available", () => {
  // Passing an explicit null storage models a non-browser / no-localStorage
  // environment without depending on the ambient global.
  assertEquals(S.readMinStars(null), 0);
  assertEquals(S.writeMinStars(3, null), false);
});

// --- accessor + change-event contract --------------------------------------

Deno.test("setMinStars normalises and returns the chosen threshold", () => {
  // Inject a no-op storage so this never touches the ambient localStorage.
  const store = fakeStorage();
  assertEquals(S.setMinStars(3, store), 3);
  assertEquals(S.setMinStars(9, store), 0); // out of range -> All
  assertEquals(store._dump()[S.STORAGE_KEY], "0");
});

Deno.test("setMinStars dispatches grq:star-filter-change with the new threshold", () => {
  const store = fakeStorage();
  const seen: number[] = [];
  const handler = (event: Event) => {
    seen.push((event as CustomEvent).detail.minStars);
  };
  globalThis.addEventListener(S.CHANGE_EVENT, handler);
  try {
    S.setMinStars(4, store);
    S.setMinStars(2, store);
  } finally {
    globalThis.removeEventListener(S.CHANGE_EVENT, handler);
  }
  assertEquals(seen, [4, 2]);
});

Deno.test("getMinStars reads the ambient localStorage default of 0", () => {
  // With no value persisted in the ambient store, getMinStars must report All.
  assertEquals(S.getMinStars(), 0);
});
