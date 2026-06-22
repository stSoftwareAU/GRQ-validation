// WHAT-tests for the series label↔line colour-pairing logic (issue #278,
// part of milestone #269 item A).
//
// docs/series_label_colour.js holds the PURE logic that derives a market
// series' title/label colour from the SAME Chart.js dataset `borderColor` that
// docs/color_key.js uses to draw the chart line — the single source of truth.
// The browser dashboard (docs/app.js) is a thin DOM wrapper that reads the live
// datasets and paints each title element, so these tests exercise the real
// shipped decision logic rather than a copy.
//
// Acceptance criteria covered:
//   - a series' title colour is derived from its own chart line borderColor
//     (SP500 red, NASDAQ blue, Russell 2000 teal), not a static colour table;
//   - the lookup pairs a title label with the matching dataset, in both the
//     aggregate and single-stock dataset shapes;
//   - the resulting colour meets WCAG 2 AA contrast (>= 4.5:1) against both the
//     light and dark theme card backgrounds, while keeping the line's hue.
import { assert, assertEquals } from "@std/assert";
import "../docs/series_label_colour.js";

interface Rgb {
  r: number;
  g: number;
  b: number;
}

const g = globalThis as unknown as {
  GRQSeriesLabelColour: {
    parseRgb: (colour: unknown) => (Rgb & { a: number }) | null;
    relativeLuminance: (rgb: Rgb) => number;
    contrastRatio: (a: Rgb, b: Rgb) => number;
    LIGHT_BG: Rgb;
    DARK_BG: Rgb;
    accessibleColour: (colour: unknown, theme: unknown) => string;
    lookupSeriesColour: (datasets: unknown, label: unknown) => string;
    seriesLabelColour: (
      datasets: unknown,
      label: unknown,
      theme: unknown,
    ) => string;
  };
};
const M = g.GRQSeriesLabelColour;

// The live chart's market datasets — copied verbatim from docs/app.js so the
// tests break if the line colours and the label-colour source ever diverge.
const SP500_LINE = "rgba(255, 99, 132, 0.8)";
const NASDAQ_LINE = "rgba(54, 162, 235, 0.8)";
const RUSSELL_LINE = "rgba(75, 192, 192, 0.8)";

const aggregateDatasets = [
  { label: "Portfolio Average", borderColor: "rgba(102, 126, 234, 1)" },
  { label: "SP500", borderColor: SP500_LINE },
  { label: "NASDAQ", borderColor: NASDAQ_LINE },
  { label: "Russell 2000", borderColor: RUSSELL_LINE },
];

Deno.test("series_label_colour.js publishes its helpers on globalThis", () => {
  assertEquals(typeof M.parseRgb, "function");
  assertEquals(typeof M.relativeLuminance, "function");
  assertEquals(typeof M.contrastRatio, "function");
  assertEquals(typeof M.accessibleColour, "function");
  assertEquals(typeof M.lookupSeriesColour, "function");
  assertEquals(typeof M.seriesLabelColour, "function");
});

Deno.test("parseRgb - parses rgba(), rgb() and hex into channels", () => {
  assertEquals(M.parseRgb("rgba(255, 99, 132, 0.8)"), {
    r: 255,
    g: 99,
    b: 132,
    a: 0.8,
  });
  assertEquals(M.parseRgb("rgb(54,162,235)"), { r: 54, g: 162, b: 235, a: 1 });
  assertEquals(M.parseRgb("#4bc0c0"), { r: 75, g: 192, b: 192, a: 1 });
  assertEquals(M.parseRgb("not a colour"), null);
  assertEquals(M.parseRgb(null), null);
});

Deno.test("contrastRatio - white on black is the maximum 21:1", () => {
  const ratio = M.contrastRatio({ r: 255, g: 255, b: 255 }, {
    r: 0,
    g: 0,
    b: 0,
  });
  assert(Math.abs(ratio - 21) < 0.01, `expected ~21, got ${ratio}`);
});

Deno.test("contrastRatio - identical colours give the minimum 1:1", () => {
  const c = { r: 123, g: 45, b: 67 };
  assertEquals(M.contrastRatio(c, c), 1);
});

Deno.test("lookupSeriesColour - pairs a title label with its own line colour", () => {
  assertEquals(M.lookupSeriesColour(aggregateDatasets, "SP500"), SP500_LINE);
  assertEquals(M.lookupSeriesColour(aggregateDatasets, "NASDAQ"), NASDAQ_LINE);
  assertEquals(
    M.lookupSeriesColour(aggregateDatasets, "Russell 2000"),
    RUSSELL_LINE,
  );
});

Deno.test("lookupSeriesColour - trims and ignores case when matching", () => {
  assertEquals(
    M.lookupSeriesColour(aggregateDatasets, "  sp500  "),
    SP500_LINE,
  );
});

Deno.test("lookupSeriesColour - returns '' for an unknown or invalid series", () => {
  assertEquals(M.lookupSeriesColour(aggregateDatasets, "Dow Jones"), "");
  assertEquals(M.lookupSeriesColour(null, "SP500"), "");
  assertEquals(M.lookupSeriesColour(aggregateDatasets, ""), "");
});

Deno.test("accessibleColour - keeps the line hue (R dominant for SP500 red)", () => {
  const css = M.accessibleColour(SP500_LINE, "light");
  const rgb = M.parseRgb(css);
  assert(rgb !== null, `expected a colour, got ${css}`);
  // Red channel stays the strongest so the title reads as the same red line.
  assert(rgb!.r > rgb!.g, `expected red dominant, got ${css}`);
  assert(rgb!.r > rgb!.b, `expected red dominant, got ${css}`);
});

Deno.test("accessibleColour - meets AA (>=4.5) on the light card background", () => {
  for (const line of [SP500_LINE, NASDAQ_LINE, RUSSELL_LINE]) {
    const rgb = M.parseRgb(M.accessibleColour(line, "light"));
    assert(rgb !== null);
    const ratio = M.contrastRatio(rgb!, M.LIGHT_BG);
    assert(ratio >= 4.5, `light AA failed for ${line}: ${ratio.toFixed(2)}:1`);
  }
});

Deno.test("accessibleColour - meets AA (>=4.5) on the dark card background", () => {
  for (const line of [SP500_LINE, NASDAQ_LINE, RUSSELL_LINE]) {
    const rgb = M.parseRgb(M.accessibleColour(line, "dark"));
    assert(rgb !== null);
    const ratio = M.contrastRatio(rgb!, M.DARK_BG);
    assert(ratio >= 4.5, `dark AA failed for ${line}: ${ratio.toFixed(2)}:1`);
  }
});

Deno.test("seriesLabelColour - end-to-end: SP500 title is an AA red in both themes", () => {
  const light = M.seriesLabelColour(aggregateDatasets, "SP500", "light");
  const dark = M.seriesLabelColour(aggregateDatasets, "SP500", "dark");

  for (
    const [css, bg, mode] of [[light, M.LIGHT_BG, "light"], [
      dark,
      M.DARK_BG,
      "dark",
    ]] as const
  ) {
    const rgb = M.parseRgb(css);
    assert(rgb !== null, `${mode}: expected a colour, got ${css}`);
    assert(
      rgb!.r > rgb!.g && rgb!.r > rgb!.b,
      `${mode}: expected red, got ${css}`,
    );
    assert(
      M.contrastRatio(rgb!, bg) >= 4.5,
      `${mode}: AA failed: ${css}`,
    );
  }
});

Deno.test("seriesLabelColour - returns '' when the series is absent (no recolour)", () => {
  assertEquals(
    M.seriesLabelColour(aggregateDatasets, "Dow Jones", "light"),
    "",
  );
  assertEquals(M.seriesLabelColour([], "SP500", "light"), "");
});
