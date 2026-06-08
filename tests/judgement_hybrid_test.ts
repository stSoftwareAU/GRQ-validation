// Judgement-from-hybrid-projection tests (issue #100).
//
// These used to drive a `MockJudgementSystem` that hardcoded projections per
// stock and reimplemented the judgement thresholds (which had drifted from
// production). They now exercise the REAL shared kernels
// `GRQProjection.computeHybridProjection` and `GRQProjection.computeJudgement`
// from docs/projection.js — the same functions the dashboard's GRQValidator
// delegates to.
import { assert, assertEquals } from "@std/assert";
import "../docs/projection.js";

interface Projection {
  projected90DayPerformance: number;
  projectionMethod: string;
  confidence: number;
}

const g = globalThis as unknown as {
  GRQProjection: {
    computeHybridProjection: (inputs: {
      daysElapsed: number;
      currentPerformance: number;
      targetPercentage: number | null;
      trendLine: { slope: number; rSquared: number } | null;
    }) => Projection;
    computeJudgement: (inputs: {
      performance: number | null;
      daysElapsed: number;
      targetPercentage: number | null;
      projection: Projection | null;
    }) => string;
    computeTrendLine: (
      dataPoints: { x: number; y: number }[],
    ) => { slope: number; intercept: number } | null;
  };
};
const GRQProjection = g.GRQProjection;

Deno.test("Judgement with Hybrid Projection - Strong Upward (Below Target)", () => {
  // 30 days elapsed, confident upward trend that still lands below 95% of target.
  const projection = GRQProjection.computeHybridProjection({
    daysElapsed: 30,
    currentPerformance: 25.0,
    targetPercentage: 60.0,
    trendLine: { slope: 1.0, rSquared: 0.5 }, // dampened 0.5 -> 45% at day 90.
  });
  assertEquals(projection.projectionMethod, "dampened_trend");
  assertEquals(projection.projected90DayPerformance, 45.0);

  const judgement = GRQProjection.computeJudgement({
    performance: 25.0,
    daysElapsed: 30,
    targetPercentage: 60.0,
    projection,
  });
  // 45 / 60 = 0.75 of target -> Below Target, reporting the projection.
  assert(judgement.includes("Below Target"), judgement);
  assert(judgement.includes("45.0%"), judgement);
});

Deno.test("Judgement with Hybrid Projection - Strong Downward (Declining)", () => {
  const projection = GRQProjection.computeHybridProjection({
    daysElapsed: 45,
    currentPerformance: -35.0,
    targetPercentage: 20.0,
    trendLine: { slope: -1.2733333, rSquared: 0.5 }, // dampened -> negative.
  });
  assert(projection.projected90DayPerformance < 0);

  const judgement = GRQProjection.computeJudgement({
    performance: -35.0,
    daysElapsed: 45,
    targetPercentage: 20.0,
    projection,
  });
  // Negative projection -> Declining, reporting the projection (not -100%).
  assert(judgement.includes("Declining"), judgement);
  assert(
    judgement.includes(projection.projected90DayPerformance.toFixed(1)),
    judgement,
  );
});

Deno.test("Judgement with Low Confidence - Falls Back to Current Performance", () => {
  // Confidence below the 0.2 threshold -> the judgement ignores the projection
  // and judges current performance instead.
  const projection = GRQProjection.computeHybridProjection({
    daysElapsed: 30,
    currentPerformance: 8.0,
    targetPercentage: 25.0,
    trendLine: { slope: 0.5, rSquared: 0.2 }, // confidence 0.16 (< 0.2).
  });
  assert(projection.confidence < 0.2, `confidence ${projection.confidence}`);

  const judgement = GRQProjection.computeJudgement({
    performance: 8.0,
    daysElapsed: 30,
    targetPercentage: 25.0,
    projection,
  });
  // 30 days, 8% < 80% of 25% target -> Below Target on current performance.
  assert(judgement.includes("Below Target"), judgement);
  assert(judgement.includes("8.0%"), judgement);
});

Deno.test("Judgement with Null Performance", () => {
  const judgement = GRQProjection.computeJudgement({
    performance: null,
    daysElapsed: 30,
    targetPercentage: 20.0,
    projection: null,
  });
  assertEquals(judgement, "Pending");
});

Deno.test("Trend Line Always Starts at Zero", () => {
  // The production trend line is forced through the origin so day 0 reads 0%.
  const trendLine = GRQProjection.computeTrendLine([
    { x: 0, y: 0 },
    { x: 10, y: 12 },
    { x: 20, y: 26 },
  ]);
  assert(trendLine !== null);
  assertEquals(trendLine.intercept, 0, "Trend line must start at zero");
});
