// Behavioural tests for the dashboard's judgement kernel.
//
// History (issue #121): this file used to define local `calculateJudgement`
// (returning "EXCEEDED"/"MET"/"BELOW") and `calculateProgressVsCostOfCapital`
// (returning "ABOVE"/"AT"/"BELOW") functions and assert on those copies. No
// such string mapping exists in the shipped code — the production
// `GRQValidator.calculateJudgement` (docs/app.js) delegates to
// `GRQProjection.computeJudgement` (docs/projection.js), which reports outcomes
// such as "Hit Target", "Partial Success", "Missed Target" and "Early Days".
// The old cases were therefore tautologies asserting on a fictional mapping;
// the cost-of-capital "ABOVE/AT/BELOW" cases and the local Date-arithmetic
// "boundary" steps likewise never touched shipped code.
//
// Per issue #121 (option a) the tests below drive the REAL exported
// `GRQProjection.computeJudgement` and assert on the shipped judgement strings,
// so a regression in the production string mapping (docs/projection.js:385)
// actually fails. The fictional cost-of-capital mapping was deleted (option b):
// the real cost-of-capital figure is the excess-return value computed by
// `GRQValidator.calculateProgressVsCostOfCapitalValue`, not a string bucket.
import { assert, assertEquals } from "@std/assert";
import "../docs/projection.js";

interface Projection {
  projected90DayPerformance: number;
  projectionMethod: string;
  confidence: number;
}

const g = globalThis as unknown as {
  GRQProjection: {
    computeJudgement: (inputs: {
      performance: number | null;
      daysElapsed: number;
      targetPercentage: number | null;
      projection: Projection | null;
    }) => string;
  };
};
const GRQProjection = g.GRQProjection;

Deno.test("computeJudgement - realised outcome from day 90", async (t) => {
  // At/after the 90-day boundary the kernel reports the realised outcome
  // against 80% of target. Target 20% -> threshold 16%.
  const realised = (performance: number) =>
    GRQProjection.computeJudgement({
      performance,
      daysElapsed: 90,
      targetPercentage: 20,
      projection: null,
    });

  await t.step("at or above 80% of target hits the target", () => {
    assertEquals(realised(25.0), "Hit Target"); // above target
    assertEquals(realised(16.0), "Hit Target"); // exactly the 80% threshold
  });

  await t.step("positive but below threshold is a partial success", () => {
    assertEquals(realised(10.0), "Partial Success");
  });

  await t.step("zero or negative misses the target", () => {
    assertEquals(realised(0.0), "Missed Target");
    assertEquals(realised(-5.0), "Missed Target");
  });
});

Deno.test("computeJudgement - pending and early-stage reporting", async (t) => {
  await t.step("null performance is pending", () => {
    assertEquals(
      GRQProjection.computeJudgement({
        performance: null,
        daysElapsed: 5,
        targetPercentage: 20,
        projection: null,
      }),
      "Pending",
    );
  });

  await t.step(
    "before day 30 without a confident projection is early days",
    () => {
      const up = GRQProjection.computeJudgement({
        performance: 3.2,
        daysElapsed: 10,
        targetPercentage: 20,
        projection: null,
      });
      assert(up.startsWith("Early Days"));
      assert(up.includes("+3.2%"));

      const down = GRQProjection.computeJudgement({
        performance: -2.5,
        daysElapsed: 10,
        targetPercentage: 20,
        projection: null,
      });
      assert(down.startsWith("Early Days"));
      assert(down.includes("-2.5%"));
    },
  );
});
