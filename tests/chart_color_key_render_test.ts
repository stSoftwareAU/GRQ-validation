// WHAT-tests for the mobile colour-key entry builder (issue #244, part of the
// legend milestone #236).
//
// docs/color_key.js holds the pure logic that turns the live Chart.js dataset
// list into colour-key entries. The browser dashboard's renderColorKey() (in
// docs/app.js) is a thin DOM wrapper around colorKeyEntries(), so these tests
// exercise the REAL shipped decision logic rather than a copy: which datasets
// become chips, and what colour/label each chip shows.
//
// Acceptance criteria covered:
//   - one entry per VISIBLE data series, in dataset order;
//   - colour and label read from each dataset's own borderColor/label (single
//     source of truth — no hard-coded colour table);
//   - hidden and unlabelled "spacer" datasets are excluded;
//   - aggregate-view per-stock projection series each become their own entry.
import { assert, assertEquals } from "@std/assert";
import "../docs/color_key.js";

interface Entry {
  label: string;
  colour: string;
}

const g = globalThis as unknown as {
  GRQColorKey: {
    colorKeyEntries: (datasets: unknown) => Entry[];
    normaliseSwatchColour: (borderColor: unknown) => string;
  };
};
const GRQColorKey = g.GRQColorKey;

Deno.test("color_key.js publishes the helper on globalThis", () => {
  assertEquals(typeof GRQColorKey.colorKeyEntries, "function");
  assertEquals(typeof GRQColorKey.normaliseSwatchColour, "function");
});

Deno.test("colorKeyEntries - one entry per series, in dataset order, using its own label+colour", () => {
  // Mirrors the single-stock view's core series.
  const datasets = [
    { label: "Performance", borderColor: "rgba(102,126,234,1)" },
    {
      label: "Performance (After 90 Days)",
      borderColor: "rgba(108,117,125,0.5)",
    },
    { label: "Target", borderColor: "rgba(255,193,7,1)" },
    { label: "Projection (Trend Line)", borderColor: "rgba(40,167,69,1)" },
    { label: "Cost of Capital", borderColor: "rgba(108,117,125,0.8)" },
  ];
  assertEquals(GRQColorKey.colorKeyEntries(datasets), [
    { label: "Performance", colour: "rgba(102,126,234,1)" },
    {
      label: "Performance (After 90 Days)",
      colour: "rgba(108,117,125,0.5)",
    },
    { label: "Target", colour: "rgba(255,193,7,1)" },
    { label: "Projection (Trend Line)", colour: "rgba(40,167,69,1)" },
    { label: "Cost of Capital", colour: "rgba(108,117,125,0.8)" },
  ]);
});

Deno.test("colorKeyEntries - includes the benchmark series with their own colours", () => {
  const datasets = [
    { label: "SP500", borderColor: "rgba(220,53,69,1)" },
    { label: "NASDAQ", borderColor: "rgba(0,123,255,1)" },
    { label: "Russell 2000", borderColor: "rgba(23,162,184,1)" },
  ];
  assertEquals(GRQColorKey.colorKeyEntries(datasets), [
    { label: "SP500", colour: "rgba(220,53,69,1)" },
    { label: "NASDAQ", colour: "rgba(0,123,255,1)" },
    { label: "Russell 2000", colour: "rgba(23,162,184,1)" },
  ]);
});

Deno.test("colorKeyEntries - aggregate per-stock projection series each become an entry", () => {
  // In the aggregate view each stock pushes its own projection series via
  // getColor(...). Driving the key off the live list means they appear too.
  const datasets = [
    { label: "AAPL Projection", borderColor: "hsl(10, 70%, 50%)" },
    { label: "MSFT Projection", borderColor: "hsl(120, 70%, 50%)" },
    { label: "GOOG Projection", borderColor: "hsl(230, 70%, 50%)" },
  ];
  const entries = GRQColorKey.colorKeyEntries(datasets);
  assertEquals(entries.length, 3);
  assertEquals(entries.map((e) => e.label), [
    "AAPL Projection",
    "MSFT Projection",
    "GOOG Projection",
  ]);
  assertEquals(entries[1].colour, "hsl(120, 70%, 50%)");
});

Deno.test("colorKeyEntries - hidden datasets are excluded", () => {
  const datasets = [
    { label: "Performance", borderColor: "rgba(102,126,234,1)" },
    { label: "Toggled Off", borderColor: "rgba(0,0,0,1)", hidden: true },
    { label: "Target", borderColor: "rgba(255,193,7,1)" },
  ];
  assertEquals(GRQColorKey.colorKeyEntries(datasets).map((e) => e.label), [
    "Performance",
    "Target",
  ]);
});

Deno.test("colorKeyEntries - layout-only spacer datasets (empty/absent label) are excluded", () => {
  const datasets = [
    { label: "Performance", borderColor: "rgba(102,126,234,1)" },
    { label: "", borderColor: "rgba(0,0,0,0)" }, // empty-label spacer
    { label: "   ", borderColor: "rgba(0,0,0,0)" }, // whitespace-only spacer
    { borderColor: "rgba(0,0,0,0)" }, // absent label
    { label: "Target", borderColor: "rgba(255,193,7,1)" },
  ];
  assertEquals(GRQColorKey.colorKeyEntries(datasets).map((e) => e.label), [
    "Performance",
    "Target",
  ]);
});

Deno.test("colorKeyEntries - a labelled series with no usable colour is skipped", () => {
  const datasets = [
    { label: "Performance", borderColor: "rgba(102,126,234,1)" },
    { label: "No Colour" }, // absent borderColor
    { label: "Bad Colour", borderColor: 42 }, // non-string/array colour
    { label: "Target", borderColor: "rgba(255,193,7,1)" },
  ];
  assertEquals(GRQColorKey.colorKeyEntries(datasets).map((e) => e.label), [
    "Performance",
    "Target",
  ]);
});

Deno.test("colorKeyEntries - array borderColor collapses to its first colour", () => {
  const datasets = [
    {
      label: "Per-point",
      borderColor: ["rgba(1,2,3,1)", "rgba(4,5,6,1)"],
    },
  ];
  assertEquals(GRQColorKey.colorKeyEntries(datasets), [
    { label: "Per-point", colour: "rgba(1,2,3,1)" },
  ]);
});

Deno.test("colorKeyEntries - non-array / empty input yields no entries", () => {
  assertEquals(GRQColorKey.colorKeyEntries(undefined), []);
  assertEquals(GRQColorKey.colorKeyEntries(null), []);
  assertEquals(GRQColorKey.colorKeyEntries("nope"), []);
  assertEquals(GRQColorKey.colorKeyEntries([]), []);
  // Stray null/non-object entries are tolerated, not thrown on.
  assertEquals(GRQColorKey.colorKeyEntries([null, 5, "x"]), []);
});

Deno.test("normaliseSwatchColour - trims strings, collapses arrays, rejects the rest", () => {
  assertEquals(
    GRQColorKey.normaliseSwatchColour("  rgba(1,2,3,1) "),
    "rgba(1,2,3,1)",
  );
  assertEquals(GRQColorKey.normaliseSwatchColour(["#fff", "#000"]), "#fff");
  assertEquals(GRQColorKey.normaliseSwatchColour([]), "");
  assertEquals(GRQColorKey.normaliseSwatchColour(7), "");
  assertEquals(GRQColorKey.normaliseSwatchColour(null), "");
  assert(GRQColorKey.normaliseSwatchColour(undefined) === "");
});
