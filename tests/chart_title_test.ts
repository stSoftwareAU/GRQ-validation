// Tests for the dashboard performance-chart heading text (issue #519).
//
// The portfolio (aggregate) view used to show a big "Portfolio Performance
// Over Time" heading — rendered both as the HTML <h2 id="chartTitle"> AND as
// the Chart.js canvas title. On a phone it wrapped onto two lines and simply
// wasted vertical space, so the reporter asked for it to be removed. The
// portfolio view now returns NO title; the stock-specific view keeps its
// informative title (score + target), which was not asked to be removed.
//
// These exercise the REAL shipped helper both the chart and the HTML heading
// resolve through (GRQChartTitle.chartTitle), so the rule cannot drift.
import { assertEquals } from "@std/assert";
import "../docs/chart_title.js";

// deno-lint-ignore no-explicit-any
const g = globalThis as any;
const GRQChartTitle = g.GRQChartTitle;

Deno.test("chartTitle - portfolio (aggregate) view has no heading (issue #519)", () => {
  // The exact regression: with no stock selected the heading is empty so it
  // reserves no vertical space.
  assertEquals(GRQChartTitle.chartTitle({ selectedStock: null }), "");
  assertEquals(GRQChartTitle.chartTitle({ selectedStock: "" }), "");
  assertEquals(GRQChartTitle.chartTitle({}), "");
  assertEquals(GRQChartTitle.chartTitle(), "");
});

Deno.test("chartTitle - stock view keeps the informative score/target title", () => {
  assertEquals(
    GRQChartTitle.chartTitle({
      selectedStock: "AAPL",
      stock: { score: 0.1234, target: 199.5 },
    }),
    "Stock Performance: AAPL (Score: 0.123, Target: $199.50)",
  );
});

Deno.test("chartTitle - stock view without data falls back to the bare label", () => {
  assertEquals(
    GRQChartTitle.chartTitle({ selectedStock: "TSLA" }),
    "Stock Performance: TSLA",
  );
  // A partial stock (missing target) must not produce "undefined" in the title.
  assertEquals(
    GRQChartTitle.chartTitle({ selectedStock: "TSLA", stock: { score: 0.5 } }),
    "Stock Performance: TSLA",
  );
});

Deno.test("chartTitle - score/target are formatted to fixed precision", () => {
  // Score -> 3 dp, target -> 2 dp, regardless of the raw precision supplied.
  assertEquals(
    GRQChartTitle.chartTitle({
      selectedStock: "MSFT",
      stock: { score: 1, target: 10 },
    }),
    "Stock Performance: MSFT (Score: 1.000, Target: $10.00)",
  );
});

// resolveChartHeading drives whether the <h2 id="chartTitle"> heading stays in
// the DOM. The regression (PR #521): the portfolio view returned an empty title
// and the heading was left in the DOM (display:none), which pa11y flagged as
// "Heading tag found with no content" (WCAG2AA H42.2). An empty title must now
// DETACH the heading so no empty heading element can exist.
Deno.test("resolveChartHeading - empty title detaches the heading (issue #519, PR #521)", () => {
  // Whether currently attached or not, an empty title must remove the heading.
  assertEquals(GRQChartTitle.resolveChartHeading("", true), {
    action: "detach",
  });
  assertEquals(GRQChartTitle.resolveChartHeading("", false), {
    action: "detach",
  });
  // A falsy title from chartTitle() (portfolio view) feeds straight through.
  assertEquals(
    GRQChartTitle.resolveChartHeading(
      GRQChartTitle.chartTitle({ selectedStock: null }),
      true,
    ),
    { action: "detach" },
  );
});

Deno.test("resolveChartHeading - non-empty title attaches when absent, updates when present", () => {
  const title = "Stock Performance: AAPL";
  // Heading currently detached -> re-attach and set its text.
  assertEquals(GRQChartTitle.resolveChartHeading(title, false), {
    action: "attach",
    text: title,
  });
  // Heading already present -> just update the text, no re-insert.
  assertEquals(GRQChartTitle.resolveChartHeading(title, true), {
    action: "update",
    text: title,
  });
});
