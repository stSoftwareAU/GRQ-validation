// Regression tests for the Portfolio Target "show the working" popover
// (issue #629).
//
// The popover's per-stock % list previously divided each stock's RAW
// `stock.target` by the split-adjusted buy price — mixing bases. For a
// reverse-split stock (e.g. NYSE:DD, split_coefficient 0.3333) that produced a
// wildly wrong figure (DD: -64.4% instead of +6.8%). The fix routes the popover
// through the shared `calculatePortfolioTargetWorking` helper, which consumes
// the SAME split/dilution-adjusted inputs as the headline
// `calculatePortfolioTargetPercentage`, so the per-stock %, the Total and the
// headline reconcile by construction.
//
// These drive the REAL shipped helper from docs/projection.js with fixture
// inputs and assert on its RETURN VALUES.

import { assertAlmostEquals, assertEquals } from "@std/assert";
import "../docs/projection.js";

const g = globalThis as unknown as {
  GRQProjection: {
    calculatePortfolioTargetWorking: (
      stocks: Array<{
        stock?: string;
        buyPrice: number | null;
        currentPrice: number | null;
        adjustedTarget: number | null;
        score?: number | null;
      }>,
    ) => {
      details: Array<{ stock?: string; targetPercentage: number }>;
      total: number;
      validStocks: number;
    };
    calculatePortfolioTargetPercentage: (
      stocks: Array<{
        buyPrice: number | null;
        currentPrice: number | null;
        adjustedTarget: number | null;
      }>,
    ) => number;
  };
};
const GRQProjection = g.GRQProjection;

// NYSE:DD reverse split (1:3, split_coefficient 0.3333) on 2025-12-29 data.
// Raw target $43.67, score-date mid $40.90. Both are restated to the current
// post-split basis BEFORE reaching the helper:
//   buyPrice      = 40.90 / 0.3333 = 122.74
//   adjustedTarget = 43.67 / 0.3333 = 131.04
// Correct per-stock target = (131.04 - 122.74) / 122.74 = +6.8%.
// The OLD popover did 43.67 / 122.74 = -64.4% (raw target / adjusted buy price).
const DD_BUY_PRICE = 40.90 / 0.3333;
const DD_ADJUSTED_TARGET = 43.67 / 0.3333;

Deno.test("calculatePortfolioTargetWorking - reverse-split stock uses adjusted basis (not raw target)", () => {
  const { details } = GRQProjection.calculatePortfolioTargetWorking([
    {
      stock: "NYSE:DD",
      buyPrice: DD_BUY_PRICE,
      currentPrice: 130,
      adjustedTarget: DD_ADJUSTED_TARGET,
    },
  ]);

  assertEquals(details.length, 1);
  assertEquals(details[0].stock, "NYSE:DD");
  // The correct adjusted figure is +6.8%, NOT the buggy -64.4%.
  assertAlmostEquals(details[0].targetPercentage, 6.8, 0.1);
});

Deno.test("calculatePortfolioTargetWorking - Total reconciles with the headline", () => {
  // A reverse-split name alongside two ordinary names: the popover's
  // Total ÷ validStocks must equal the headline calculatePortfolioTargetPercentage.
  const stocks = [
    {
      stock: "NYSE:DD",
      buyPrice: DD_BUY_PRICE,
      currentPrice: 130,
      adjustedTarget: DD_ADJUSTED_TARGET,
    },
    {
      stock: "NYSE:AAA",
      buyPrice: 100,
      currentPrice: 110,
      adjustedTarget: 120,
    }, // 20%
    { stock: "NYSE:BBB", buyPrice: 50, currentPrice: 55, adjustedTarget: 60 }, // 20%
  ];

  const working = GRQProjection.calculatePortfolioTargetWorking(stocks);
  const headline = GRQProjection.calculatePortfolioTargetPercentage(stocks);

  assertEquals(working.validStocks, 3);
  assertAlmostEquals(working.total / working.validStocks, headline, 1e-9);
});

Deno.test("calculatePortfolioTargetWorking - excludes unpriceable stocks from the list", () => {
  const { details, validStocks } = GRQProjection
    .calculatePortfolioTargetWorking([
      {
        stock: "NYSE:AAA",
        buyPrice: 100,
        currentPrice: 130,
        adjustedTarget: 150,
      }, // 50%
      {
        stock: "NYSE:BAD",
        buyPrice: 100,
        currentPrice: 0,
        adjustedTarget: 999,
      }, // excluded
      {
        stock: "NYSE:NOTGT",
        buyPrice: 100,
        currentPrice: 110,
        adjustedTarget: null,
      }, // no target
    ]);

  assertEquals(validStocks, 1);
  assertEquals(details.length, 1);
  assertEquals(details[0].stock, "NYSE:AAA");
  assertAlmostEquals(details[0].targetPercentage, 50.0);
});

Deno.test("calculatePortfolioTargetWorking - empty / non-array inputs are safe", () => {
  assertEquals(GRQProjection.calculatePortfolioTargetWorking([]), {
    details: [],
    total: 0,
    validStocks: 0,
  });
  assertEquals(
    GRQProjection.calculatePortfolioTargetWorking(
      null as unknown as [],
    ),
    { details: [], total: 0, validStocks: 0 },
  );
});
