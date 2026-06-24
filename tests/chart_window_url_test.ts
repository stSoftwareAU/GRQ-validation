// Behavioural tests for the transient `?window=90|180` deep-link override
// (issue #467, coordinating with #450 which owns the parser).
//
// A `?window=` deep link switches the chart (and aligned summary) window for a
// VISIT only — it is never persisted to localStorage. These tests exercise the
// REAL shipped helpers from docs/chart_window_settings.js:
//   - windowDaysFromSearch() — the single shared `?window=` parser (#450/#467),
//     mirroring theme.js's preferenceFromSearch();
//   - effectiveWindowDays()  — the visit-only precedence resolver:
//     `?window=` (transient) > saved per-device choice > device default.
//
// They follow the `?theme=` / `?date=` transient-precedence pattern: the URL
// value wins for the visit, an absent/invalid value falls back to the saved
// value, and nothing is written.
import { assertEquals } from "@std/assert";
import "../docs/chart_window_settings.js";

const g = globalThis as unknown as {
  GRQChartWindow: {
    ALLOWED_WINDOW_DAYS: number[];
    windowDaysFromSearch: (search: unknown) => number | null;
    effectiveWindowDays: (search: unknown, saved: number) => number;
  };
};

const S = g.GRQChartWindow;

// --- the shared parser is published (single implementation for #450) --------

Deno.test("GRQChartWindow publishes the shared ?window= parser + resolver", () => {
  assertEquals(typeof S.windowDaysFromSearch, "function");
  assertEquals(typeof S.effectiveWindowDays, "function");
});

// --- windowDaysFromSearch ---------------------------------------------------

Deno.test("windowDaysFromSearch returns 90 for ?window=90", () => {
  assertEquals(S.windowDaysFromSearch("?window=90"), 90);
  // The leading '?' is optional (URLSearchParams tolerates either form).
  assertEquals(S.windowDaysFromSearch("window=90"), 90);
});

Deno.test("windowDaysFromSearch returns 180 for ?window=180", () => {
  assertEquals(S.windowDaysFromSearch("?window=180"), 180);
});

Deno.test("windowDaysFromSearch ignores surrounding whitespace", () => {
  assertEquals(S.windowDaysFromSearch("?window=%2090%20"), 90);
});

Deno.test("windowDaysFromSearch returns null when the param is absent", () => {
  assertEquals(S.windowDaysFromSearch(""), null);
  assertEquals(S.windowDaysFromSearch("?theme=dark"), null);
  assertEquals(S.windowDaysFromSearch("?date=2026-03-23"), null);
});

Deno.test("windowDaysFromSearch returns null for a blank value", () => {
  assertEquals(S.windowDaysFromSearch("?window="), null);
  assertEquals(S.windowDaysFromSearch("?window=%20"), null);
});

Deno.test("windowDaysFromSearch returns null for a disallowed window", () => {
  // Only 90 and 180 are permitted; anything else falls through to null so the
  // caller keeps the saved/default choice.
  assertEquals(S.windowDaysFromSearch("?window=45"), null);
  assertEquals(S.windowDaysFromSearch("?window=360"), null);
  assertEquals(S.windowDaysFromSearch("?window=abc"), null);
  assertEquals(S.windowDaysFromSearch("?window=0"), null);
});

Deno.test("windowDaysFromSearch tolerates rubbish input without throwing", () => {
  assertEquals(S.windowDaysFromSearch(null), null);
  assertEquals(S.windowDaysFromSearch(undefined), null);
  assertEquals(S.windowDaysFromSearch(123), null);
});

// --- effectiveWindowDays: visit-only precedence -----------------------------

Deno.test("effectiveWindowDays: ?window=90 overrides a saved desktop 180", () => {
  // Desktop acceptance: a shared 90-day link narrows the desktop window for the
  // visit, even though the saved value is 180.
  assertEquals(S.effectiveWindowDays("?window=90", 180), 90);
});

Deno.test("effectiveWindowDays: ?window=180 overrides a saved desktop 90", () => {
  // A link can widen a saved desktop-90 choice back to 180 for the visit only.
  assertEquals(S.effectiveWindowDays("?window=180", 90), 180);
});

Deno.test("effectiveWindowDays: absent ?window= keeps the saved value", () => {
  assertEquals(S.effectiveWindowDays("", 180), 180);
  assertEquals(S.effectiveWindowDays("?theme=dark", 90), 90);
});

Deno.test("effectiveWindowDays: invalid ?window= falls back to the saved value", () => {
  assertEquals(S.effectiveWindowDays("?window=45", 180), 180);
  assertEquals(S.effectiveWindowDays("?window=", 90), 90);
});

Deno.test("effectiveWindowDays: mobile default 90 is preserved when no override", () => {
  // The mobile invariant: with no `?window=` the saved/default mobile 90 stands.
  assertEquals(S.effectiveWindowDays("", 90), 90);
  // A `?window=180` link is per-visit only — it returns 180 for the visit but
  // writes nothing (this function is pure), so mobile's stored 90 is untouched.
  assertEquals(S.effectiveWindowDays("?window=180", 90), 180);
});
