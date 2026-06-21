// Behavioural tests for the dashboard theme selector (issue #233).
//
// These import the REAL shipped helpers from docs/theme.js — the same pure
// functions the dashboard's theme toggle uses to cycle Auto/Light/Dark, pick
// the button icon/title and decide which class to put on <body>. The module
// publishes its helpers on globalThis (mirroring docs/escape.js and
// docs/projection.js) and guards all DOM access, so it imports cleanly under
// Deno where there is no document.
import { assert, assertEquals } from "@std/assert";
import "../docs/theme.js";

const g = globalThis as unknown as {
  GRQTheme: {
    PREFERENCES: string[];
    normalisePreference: (value: unknown) => string;
    nextPreference: (current: unknown) => string;
    iconFor: (preference: unknown) => string;
    titleFor: (preference: unknown) => string;
    bodyClassFor: (preference: unknown) => string;
    toggleClassFor: (preference: unknown) => string;
  };
};

Deno.test("GRQTheme is published on globalThis", () => {
  assert(g.GRQTheme, "theme.js should publish globalThis.GRQTheme");
  assertEquals(g.GRQTheme.PREFERENCES, ["auto", "light", "dark"]);
});

Deno.test("normalisePreference keeps valid values", () => {
  assertEquals(g.GRQTheme.normalisePreference("auto"), "auto");
  assertEquals(g.GRQTheme.normalisePreference("light"), "light");
  assertEquals(g.GRQTheme.normalisePreference("dark"), "dark");
});

Deno.test("normalisePreference falls back to auto for junk", () => {
  // Unknown strings, empty, null, undefined and wrong types all default safely.
  assertEquals(g.GRQTheme.normalisePreference("purple"), "auto");
  assertEquals(g.GRQTheme.normalisePreference(""), "auto");
  assertEquals(g.GRQTheme.normalisePreference(null), "auto");
  assertEquals(g.GRQTheme.normalisePreference(undefined), "auto");
  assertEquals(g.GRQTheme.normalisePreference(42), "auto");
});

Deno.test("nextPreference cycles auto -> light -> dark -> auto", () => {
  assertEquals(g.GRQTheme.nextPreference("auto"), "light");
  assertEquals(g.GRQTheme.nextPreference("light"), "dark");
  assertEquals(g.GRQTheme.nextPreference("dark"), "auto");
});

Deno.test("nextPreference treats junk as auto and advances to light", () => {
  assertEquals(g.GRQTheme.nextPreference("nonsense"), "light");
  assertEquals(g.GRQTheme.nextPreference(undefined), "light");
});

Deno.test("iconFor returns a distinct glyph per preference", () => {
  assertEquals(g.GRQTheme.iconFor("light"), "☀️");
  assertEquals(g.GRQTheme.iconFor("dark"), "🌙");
  assertEquals(g.GRQTheme.iconFor("auto"), "🌓");
  // Junk falls back to the auto glyph.
  assertEquals(g.GRQTheme.iconFor("oops"), "🌓");
});

Deno.test("titleFor describes the current mode and next action", () => {
  assert(g.GRQTheme.titleFor("light").toLowerCase().includes("light"));
  assert(g.GRQTheme.titleFor("dark").toLowerCase().includes("dark"));
  assert(g.GRQTheme.titleFor("auto").toLowerCase().includes("auto"));
});

Deno.test("bodyClassFor maps forced modes and leaves auto unforced", () => {
  assertEquals(g.GRQTheme.bodyClassFor("light"), "light-mode-forced");
  assertEquals(g.GRQTheme.bodyClassFor("dark"), "dark-mode-forced");
  assertEquals(g.GRQTheme.bodyClassFor("auto"), "");
});

Deno.test("toggleClassFor namespaces the button state class", () => {
  assertEquals(g.GRQTheme.toggleClassFor("light"), "theme-toggle-light");
  assertEquals(g.GRQTheme.toggleClassFor("dark"), "theme-toggle-dark");
  assertEquals(g.GRQTheme.toggleClassFor("auto"), "theme-toggle-auto");
  assertEquals(g.GRQTheme.toggleClassFor("junk"), "theme-toggle-auto");
});
