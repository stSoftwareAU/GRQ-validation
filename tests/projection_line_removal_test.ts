// Issue #688: on the single-stock "Stock Performance" chart the projection
// series exist only to ESTIMATE the 90-day outcome before it is known. Once the
// 90-day window has elapsed and the real actuals are in, the three projection
// datasets must disappear, leaving just the actuals against the target:
//   - "Projection (Trend Line)"        (green dashed trend)
//   - "Hybrid Projection (…)"          (every variant: Target-Based / Upward / Downward)
//   - "Hybrid 90-Day Point"            (the projected 90-day dot)
//
// The decision is a pure function of calendar days elapsed since the score
// date: show the projections only while the prediction is UNDER 90 days old.
// This pins GRQProjection.shouldShowProjectionLines, the single source of truth
// the single-stock branch of prepareChartData() gates all three pushes behind.
import { assertEquals } from "@std/assert";
import "../docs/projection.js";

const g = globalThis as unknown as {
  GRQProjection: {
    shouldShowProjectionLines: (daysElapsed: number) => boolean;
  };
};
const GRQProjection = g.GRQProjection;

Deno.test("shouldShowProjectionLines - under 90 days keeps projections", () => {
  assertEquals(GRQProjection.shouldShowProjectionLines(0), true);
  assertEquals(GRQProjection.shouldShowProjectionLines(1), true);
  assertEquals(GRQProjection.shouldShowProjectionLines(45), true);
  assertEquals(GRQProjection.shouldShowProjectionLines(89), true);
});

Deno.test("shouldShowProjectionLines - at/after 90 days removes projections", () => {
  // Day 90 is the target itself: the window has elapsed, actuals are in.
  assertEquals(GRQProjection.shouldShowProjectionLines(90), false);
  assertEquals(GRQProjection.shouldShowProjectionLines(91), false);
  assertEquals(GRQProjection.shouldShowProjectionLines(180), false);
  assertEquals(GRQProjection.shouldShowProjectionLines(365), false);
});

// Model the single-stock branch's three gated dataset pushes so the intended
// chart composition is pinned end-to-end: actuals + target always present,
// projections present ONLY while under 90 days old.
interface Dataset {
  label: string;
}

function singleStockDatasets(daysElapsed: number): Dataset[] {
  const datasets: Dataset[] = [];
  // Always-present series (unchanged by this issue).
  datasets.push({ label: "Actual" });
  datasets.push({ label: "Target" });
  // Projection series — gated behind the shared helper.
  if (GRQProjection.shouldShowProjectionLines(daysElapsed)) {
    datasets.push({ label: "Projection (Trend Line)" });
    datasets.push({ label: "Hybrid Projection (Target-Based)" });
    datasets.push({ label: "Hybrid 90-Day Point" });
  }
  return datasets;
}

Deno.test("single-stock chart under 90 days shows projection series", () => {
  const labels = singleStockDatasets(45).map((d) => d.label);
  assertEquals(labels.includes("Projection (Trend Line)"), true);
  assertEquals(labels.includes("Hybrid Projection (Target-Based)"), true);
  assertEquals(labels.includes("Hybrid 90-Day Point"), true);
  // Actuals and target remain.
  assertEquals(labels.includes("Actual"), true);
  assertEquals(labels.includes("Target"), true);
});

Deno.test("single-stock chart at 90+ days hides all projection series", () => {
  const labels = singleStockDatasets(90).map((d) => d.label);
  assertEquals(labels.includes("Projection (Trend Line)"), false);
  assertEquals(labels.includes("Hybrid Projection (Target-Based)"), false);
  assertEquals(labels.includes("Hybrid 90-Day Point"), false);
  // Actuals and target still stand for actual-vs-target comparison.
  assertEquals(labels.includes("Actual"), true);
  assertEquals(labels.includes("Target"), true);
});
