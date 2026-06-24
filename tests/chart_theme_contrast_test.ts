// Contrast guard for Chart.js-drawn CANVAS text (issue #497, milestone #484).
//
// The dark-mode bug the reporter hit: the main dashboard chart's title/axis/
// tick/legend text is painted onto the <canvas>, which DOM accessibility
// checkers (pa11y / axe) cannot inspect — so a dark-on-dark `color: '#333'`
// chart title slipped past the a11y gate and was unreadable in dark mode.
//
// docs/chart_theme.js is the single source of truth for those canvas colours.
// These tests import it and assert the themed text clears WCAG 2.1 AA (>= 4.5:1)
// against the chart's card background in BOTH themes. They are the canvas-side
// half of the closed CI gap: re-introducing a low-contrast colour here FAILS.
//
// Contrast maths is reused from docs/series_label_colour.js (the existing
// single source of truth for WCAG luminance/contrast), so this test exercises
// the real shipped helpers rather than a re-implementation.
import { assert } from "@std/assert";
import "../docs/series_label_colour.js";
import "../docs/chart_theme.js";

interface Rgb {
  r: number;
  g: number;
  b: number;
}

const g = globalThis as unknown as {
  GRQSeriesLabelColour: {
    parseRgb: (colour: unknown) => (Rgb & { a: number }) | null;
    contrastRatio: (a: Rgb, b: Rgb) => number;
  };
  GRQChartTheme: {
    AA_CONTRAST: number;
    chartTextColour: (theme: unknown) => string;
    chartGridColour: (theme: unknown) => string;
    chartBackground: (theme: unknown) => string;
    chartTheme: (
      theme: unknown,
    ) => { text: string; grid: string; background: string };
  };
};

const colour = g.GRQSeriesLabelColour;
const theme = g.GRQChartTheme;

function ratio(fg: string, bg: string): number {
  const f = colour.parseRgb(fg);
  const b = colour.parseRgb(bg);
  assert(f !== null, `unparseable foreground: ${fg}`);
  assert(b !== null, `unparseable background: ${bg}`);
  return colour.contrastRatio(f!, b!);
}

Deno.test("chart_theme.js publishes its helpers on globalThis", () => {
  assert(typeof theme.chartTextColour === "function");
  assert(typeof theme.chartGridColour === "function");
  assert(typeof theme.chartBackground === "function");
  assert(typeof theme.chartTheme === "function");
});

Deno.test("canvas chart text meets WCAG 2.1 AA on the light card background", () => {
  const fg = theme.chartTextColour("light");
  const bg = theme.chartBackground("light");
  const r = ratio(fg, bg);
  assert(
    r >= theme.AA_CONTRAST,
    `light chart text ${fg} on ${bg} is ${r.toFixed(2)}:1, need >= 4.5`,
  );
});

Deno.test("canvas chart text meets WCAG 2.1 AA on the dark card background", () => {
  const fg = theme.chartTextColour("dark");
  const bg = theme.chartBackground("dark");
  const r = ratio(fg, bg);
  assert(
    r >= theme.AA_CONTRAST,
    `dark chart text ${fg} on ${bg} is ${r.toFixed(2)}:1, need >= 4.5`,
  );
});

Deno.test("chartTheme() bundles text/grid/background and the text clears AA", () => {
  for (const t of ["light", "dark"] as const) {
    const bundle = theme.chartTheme(t);
    assert(typeof bundle.text === "string" && bundle.text !== "");
    assert(typeof bundle.grid === "string" && bundle.grid !== "");
    assert(typeof bundle.background === "string" && bundle.background !== "");
    const r = ratio(bundle.text, bundle.background);
    assert(r >= theme.AA_CONTRAST, `${t}: ${r.toFixed(2)}:1 < 4.5`);
  }
});

Deno.test("an unknown/missing theme falls back to the AA-compliant light palette", () => {
  // Never silently serve the dark (low-contrast on a light page) palette.
  assert(theme.chartTextColour(undefined) === theme.chartTextColour("light"));
  assert(theme.chartBackground("weird") === theme.chartBackground("light"));
});

// Wiring guard: the module values clearing AA only protect the real chart if
// the chart actually consumes them. Confirm app.js sources its canvas text
// colour from GRQChartTheme and no longer hard-codes the dark-on-dark '#333'
// chart title — so a bypass that re-hard-codes a low-contrast literal regresses
// this test too, not just a change to the module.
Deno.test("app.js drives its canvas chart colours from GRQChartTheme", async () => {
  const appJs = await Deno.readTextFile(
    new URL("../docs/app.js", import.meta.url),
  );
  assert(
    /GRQChartTheme\s*\.\s*chartTheme/.test(appJs) ||
      appJs.includes("GRQChartTheme.chartTheme"),
    "app.js must resolve its chart text colour from the GRQChartTheme source " +
      "of truth (issue #497)",
  );
  assert(
    !/color:\s*['"]#333['"]/.test(appJs),
    "app.js must not hard-code the dark-on-dark '#333' chart title colour " +
      "(issue #497) — derive it from the theme instead",
  );
});

// Regression demonstration: the PRE-FIX hard-coded chart title colour ('#333')
// is dark-on-dark and must FAIL AA on the dark card background. This documents
// the exact low-contrast the fix removes — if the canvas text ever regresses to
// such a colour, the AA assertions above fail in CI.
Deno.test("pre-fix chart title colour '#333' fails AA on the dark card (regression)", () => {
  const r = ratio("#333333", theme.chartBackground("dark"));
  assert(
    r < theme.AA_CONTRAST,
    `expected the old '#333' title to fail AA on dark, got ${r.toFixed(2)}:1`,
  );
});
