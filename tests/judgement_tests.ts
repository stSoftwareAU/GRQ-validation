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

Deno.test(
  "computeJudgement - figures are labelled projected vs current (issue #298)",
  async (t) => {
    // The parenthetical figure must say what it is so a reader cannot mistake a
    // projected 90-day return for the realised gain (or vice versa). Before day
    // 90 a confident projection is labelled "proj." and a current-performance
    // fallback is labelled "current".

    await t.step("a confident projection is labelled proj.", () => {
      const onTrack = GRQProjection.computeJudgement({
        performance: 33.5,
        daysElapsed: 60,
        targetPercentage: 50,
        projection: {
          projected90DayPerformance: 48.0,
          projectionMethod: "dampened_trend",
          confidence: 0.6,
        },
      });
      assert(onTrack.startsWith("On Track"), onTrack);
      assert(onTrack.includes("(proj. 48.0%)"), onTrack);
      assert(!onTrack.includes("current"), onTrack);

      const declining = GRQProjection.computeJudgement({
        performance: -8.0,
        daysElapsed: 60,
        targetPercentage: 20,
        projection: {
          projected90DayPerformance: -8.0,
          projectionMethod: "dampened_trend",
          confidence: 0.6,
        },
      });
      assert(declining.includes("(proj. -8.0%)"), declining);

      const belowTarget = GRQProjection.computeJudgement({
        performance: 10,
        daysElapsed: 30,
        targetPercentage: 60,
        projection: {
          projected90DayPerformance: 45,
          projectionMethod: "dampened_trend",
          confidence: 0.5,
        },
      });
      assert(belowTarget.startsWith("Below Target"), belowTarget);
      assert(belowTarget.includes("(proj. 45.0%)"), belowTarget);
    });

    await t.step(
      "a current-performance fallback is labelled current",
      () => {
        // Early days (< 30) always reports current performance.
        const earlyUp = GRQProjection.computeJudgement({
          performance: 3.2,
          daysElapsed: 10,
          targetPercentage: 20,
          projection: null,
        });
        assert(earlyUp.includes("(current +3.2%)"), earlyUp);
        assert(!earlyUp.includes("proj."), earlyUp);

        const earlyDown = GRQProjection.computeJudgement({
          performance: -2.5,
          daysElapsed: 10,
          targetPercentage: 20,
          projection: null,
        });
        assert(earlyDown.includes("(current -2.5%)"), earlyDown);

        // 30-90 days with no confident projection also reports current.
        const fallback = GRQProjection.computeJudgement({
          performance: 8.0,
          daysElapsed: 30,
          targetPercentage: 25,
          projection: {
            projected90DayPerformance: 20,
            projectionMethod: "target_based",
            confidence: 0.1, // below the 0.2 gate
          },
        });
        assert(fallback.startsWith("Below Target"), fallback);
        assert(fallback.includes("(current 8.0%)"), fallback);
      },
    );

    await t.step(
      "realised buckets from day 90 carry no parenthetical figure",
      () => {
        const hit = GRQProjection.computeJudgement({
          performance: 33.5,
          daysElapsed: 90,
          targetPercentage: 20,
          projection: null,
        });
        assertEquals(hit, "Hit Target");
        assert(!hit.includes("proj."), hit);
        assert(!hit.includes("current"), hit);
      },
    );
  },
);

Deno.test(
  "computeJudgement - positive projection with a non-positive target (issue #297)",
  async (t) => {
    // Regression for the computeJudgement sign-flip. When a stock's model
    // 90-Day Target price sits below its buy price the target return % is
    // negative, so the old `predicted / target` ratio flipped the sign of a
    // healthy positive projection and mislabelled it as a red "Declining".
    // A positive projected return must never read as "Declining".

    await t.step(
      "STLD-like: strong positive projection, negative target",
      () => {
        const result = GRQProjection.computeJudgement({
          performance: 33.5,
          daysElapsed: 60,
          targetPercentage: -2, // target price below buy price
          projection: {
            projected90DayPerformance: 45.5,
            projectionMethod: "dampened_trend",
            confidence: 0.6,
          },
        });
        assert(
          !result.startsWith("Declining"),
          `expected not declining, got "${result}"`,
        );
      },
    );

    await t.step(
      "GE-like: smaller positive projection, negative target",
      () => {
        const result = GRQProjection.computeJudgement({
          performance: 14.7,
          daysElapsed: 60,
          targetPercentage: -1.5,
          projection: {
            projected90DayPerformance: 12.3,
            projectionMethod: "dampened_trend",
            confidence: 0.5,
          },
        });
        assert(
          !result.startsWith("Declining"),
          `expected not declining, got "${result}"`,
        );
      },
    );

    await t.step(
      "a negative projection still declines regardless of target sign",
      () => {
        const result = GRQProjection.computeJudgement({
          performance: -8.0,
          daysElapsed: 60,
          targetPercentage: -2,
          projection: {
            projected90DayPerformance: -8.0,
            projectionMethod: "dampened_trend",
            confidence: 0.6,
          },
        });
        assert(
          result.startsWith("Declining"),
          `expected declining, got "${result}"`,
        );
      },
    );

    await t.step(
      "a small positive projection short of a positive target is below target, not declining",
      () => {
        const result = GRQProjection.computeJudgement({
          performance: 2.0,
          daysElapsed: 60,
          targetPercentage: 20, // predicted 2% is < 0.2 * target
          projection: {
            projected90DayPerformance: 2.0,
            projectionMethod: "dampened_trend",
            confidence: 0.6,
          },
        });
        assert(
          !result.startsWith("Declining"),
          `expected not declining, got "${result}"`,
        );
      },
    );
  },
);
