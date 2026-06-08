// Realistic-trajectory projection tests (issue #100).
//
// These used to drive a `MockGRQValidator` that reimplemented (and forced) the
// long-term projection branch, so they asserted on a copy of the maths rather
// than the shipped code. They now exercise the REAL shared kernel
// `GRQProjection.computeHybridProjection` from docs/projection.js — the same
// function the dashboard's GRQValidator delegates to — for the long-term
// (>= 60 days elapsed) "realistic_trajectory" horizon.
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
  };
};
const GRQProjection = g.GRQProjection;

Deno.test("Realistic Projection - Behind Target Scenario", async (t) => {
  const target = 50.8;

  await t.step(
    "projects a conservative figure when behind but catch-up is still feasible",
    () => {
      // 65 days elapsed, 2% current performance: the required daily catch-up
      // rate (48.8% / 25 days = 1.95%) is below the 2%/day "unrealistic"
      // threshold, so the kernel uses the conservative trajectory branch.
      const projection = GRQProjection.computeHybridProjection({
        daysElapsed: 65,
        currentPerformance: 2.0,
        targetPercentage: target,
        trendLine: null,
      });

      assertEquals(
        projection.projectionMethod,
        "realistic_trajectory",
        "Should use the long-term realistic trajectory method",
      );

      // Conservative branch: min(trajectory, target * 0.8).
      const trajectory = (2.0 / 65) * 90;
      const expected = Math.min(trajectory, target * 0.8);
      assertEquals(
        projection.projected90DayPerformance,
        expected,
        "Should project the conservative trajectory figure",
      );
      assert(
        projection.projected90DayPerformance < target,
        "Projection should be less than the target",
      );
      assert(
        projection.projected90DayPerformance > 2.0,
        "Projection should exceed current performance",
      );
      assert(
        projection.projected90DayPerformance < 10.0,
        "Projection should be realistic (< 10%)",
      );
      assertEquals(
        projection.confidence,
        0.6,
        "Should have moderate confidence",
      );
    },
  );

  await t.step("handles an extremely behind-target scenario", () => {
    // 60 days elapsed, 1% performance: still feasible (required 1.66%/day),
    // conservative branch.
    const projection = GRQProjection.computeHybridProjection({
      daysElapsed: 60,
      currentPerformance: 1.0,
      targetPercentage: target,
      trendLine: null,
    });

    const trajectory = (1.0 / 60) * 90;
    const expected = Math.min(trajectory, target * 0.8);
    assertEquals(projection.projected90DayPerformance, expected);
    assert(
      projection.projected90DayPerformance < 5.0,
      "Projection should be very low (< 5%)",
    );
    assert(
      projection.projected90DayPerformance > 1.0,
      "Projection should exceed current performance",
    );
  });

  await t.step("handles an unrealistic catch-up scenario", () => {
    // 80 days elapsed, 1% performance: required daily rate (49.8% / 10 days =
    // 4.98%) exceeds 2%/day, so the kernel projects a miss with high confidence.
    const projection = GRQProjection.computeHybridProjection({
      daysElapsed: 80,
      currentPerformance: 1.0,
      targetPercentage: target,
      trendLine: null,
    });

    const trajectory = (1.0 / 80) * 90;
    const realisticProjection = Math.min(trajectory, target * 0.6);
    const expected = Math.max(realisticProjection, 1.0 * 1.2);
    assertEquals(
      projection.projected90DayPerformance,
      expected,
      "Should use the floored realistic projection",
    );
    assertEquals(
      projection.confidence,
      0.7,
      "Should have high confidence for an unrealistic catch-up",
    );
  });

  await t.step(
    "yields a 'Declining' judgement for the far-behind-target scenario",
    () => {
      const projection = GRQProjection.computeHybridProjection({
        daysElapsed: 65,
        currentPerformance: 2.0,
        targetPercentage: target,
        trendLine: null,
      });

      const predicted = projection.projected90DayPerformance;
      const pctOfTarget = predicted / target;
      let judgement: string;
      if (predicted < 0 || pctOfTarget < 0.2) {
        judgement = `Declining (${predicted.toFixed(1)}%)`;
      } else if (pctOfTarget >= 0.95) {
        judgement = `On Track (${predicted.toFixed(1)}%)`;
      } else if (pctOfTarget >= 0.2) {
        judgement = `Below Target (${predicted.toFixed(1)}%)`;
      } else {
        judgement = `Declining (${predicted.toFixed(1)}%)`;
      }

      assert(
        judgement.startsWith("Declining"),
        "Judgement should be 'Declining' for this scenario",
      );
    },
  );
});
