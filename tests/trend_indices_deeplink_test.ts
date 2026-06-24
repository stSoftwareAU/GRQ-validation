// Behavioural tests for the Trend-view `?indices=` deep-link helper
// (issue #480, part of milestone #450).
//
// These import the REAL shipped helpers from docs/trend_indices_deeplink.js —
// the same pure functions trend.js uses to turn benchmark-index overlays ON/OFF
// from a `?indices=` URL parameter for a single visit. The module publishes its
// helpers on globalThis.GRQTrendDeepLink and reuses
// GRQTrendSettings.normaliseToggles, so we import the settings module first to
// give it that single source of truth (mirroring the load order in trend.html).
//
// The helpers are pure: no DOM, no storage. Tests assert on the returned
// normalised boolean maps for valid / invalid / absent input.
import { assert, assertEquals } from "@std/assert";
import "../docs/trend_settings.js";
import "../docs/trend_indices_deeplink.js";

const g = globalThis as unknown as {
  GRQTrendDeepLink: {
    INDEX_KEYS: string[];
    togglesFromSearch: (
      search: string,
    ) => Record<string, boolean> | null;
    effectiveToggles: (
      search: string,
      savedToggles: unknown,
    ) => Record<string, boolean>;
  };
};

const { togglesFromSearch, effectiveToggles, INDEX_KEYS } = g.GRQTrendDeepLink;

const ALL_OFF = { sp500: false, nasdaq: false, russell2000: false };

Deno.test("INDEX_KEYS exposes the three canonical benchmark keys", () => {
  assertEquals([...INDEX_KEYS].sort(), ["nasdaq", "russell2000", "sp500"]);
});

// --- togglesFromSearch: valid input --------------------------------------

Deno.test("togglesFromSearch - single key turns only that index ON", () => {
  assertEquals(togglesFromSearch("?indices=sp500"), {
    sp500: true,
    nasdaq: false,
    russell2000: false,
  });
});

Deno.test("togglesFromSearch - multiple keys turn each listed index ON", () => {
  assertEquals(togglesFromSearch("?indices=sp500,nasdaq"), {
    sp500: true,
    nasdaq: true,
    russell2000: false,
  });
});

Deno.test("togglesFromSearch - all three keys turn every overlay ON", () => {
  assertEquals(togglesFromSearch("?indices=sp500,nasdaq,russell2000"), {
    sp500: true,
    nasdaq: true,
    russell2000: true,
  });
});

Deno.test("togglesFromSearch - keys are trimmed and case-insensitive", () => {
  assertEquals(togglesFromSearch("?indices= SP500 , NasDaq "), {
    sp500: true,
    nasdaq: true,
    russell2000: false,
  });
});

Deno.test("togglesFromSearch - works without a leading '?'", () => {
  assertEquals(togglesFromSearch("indices=russell2000"), {
    sp500: false,
    nasdaq: false,
    russell2000: true,
  });
});

// --- togglesFromSearch: invalid input ------------------------------------

Deno.test("togglesFromSearch - unknown keys are ignored", () => {
  assertEquals(togglesFromSearch("?indices=sp500,dogecoin"), {
    sp500: true,
    nasdaq: false,
    russell2000: false,
  });
});

Deno.test("togglesFromSearch - only-unknown keys yield an all-off map", () => {
  assertEquals(togglesFromSearch("?indices=bogus,unknown"), ALL_OFF);
});

Deno.test("togglesFromSearch - present-but-empty value turns all overlays OFF", () => {
  assertEquals(togglesFromSearch("?indices="), ALL_OFF);
});

// --- togglesFromSearch: absent input -------------------------------------

Deno.test("togglesFromSearch - absent param returns null", () => {
  assertEquals(togglesFromSearch("?theme=dark"), null);
});

Deno.test("togglesFromSearch - empty search returns null", () => {
  assertEquals(togglesFromSearch(""), null);
});

// --- effectiveToggles: precedence ----------------------------------------

Deno.test("effectiveToggles - URL override wins over saved toggles", () => {
  const saved = { sp500: false, nasdaq: false, russell2000: true };
  assertEquals(effectiveToggles("?indices=sp500,nasdaq", saved), {
    sp500: true,
    nasdaq: true,
    russell2000: false,
  });
});

Deno.test("effectiveToggles - absent param falls back to saved toggles", () => {
  const saved = { sp500: true, nasdaq: false, russell2000: true };
  assertEquals(effectiveToggles("", saved), saved);
});

Deno.test("effectiveToggles - absent param normalises a partial saved map", () => {
  assertEquals(effectiveToggles("?theme=dark", { sp500: true }), {
    sp500: true,
    nasdaq: false,
    russell2000: false,
  });
});

Deno.test("effectiveToggles - present-but-empty URL value overrides saved to all-off", () => {
  const saved = { sp500: true, nasdaq: true, russell2000: true };
  assertEquals(effectiveToggles("?indices=", saved), ALL_OFF);
});

Deno.test("effectiveToggles - never mutates the saved toggles argument", () => {
  const saved = { sp500: true, nasdaq: false, russell2000: false };
  const snapshot = { ...saved };
  effectiveToggles("?indices=nasdaq", saved);
  assertEquals(saved, snapshot);
});

Deno.test("effectiveToggles - returns a full normalised map for all inputs", () => {
  const result = effectiveToggles("?indices=sp500", null);
  assert("sp500" in result && "nasdaq" in result && "russell2000" in result);
});
