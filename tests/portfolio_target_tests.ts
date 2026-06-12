import { assertAlmostEquals, assertEquals } from "@std/assert";
import "../docs/projection.js";

// Portfolio target / 90-day performance tests (issue #109).
//
// These drive the REAL shipped helpers from docs/projection.js with fixture
// inputs and assert on their RETURN VALUES. The former version asserted a
// literal against itself (20.0 ≈ 20.0) and recomputed the portfolio return
// inline against an answer baked into the fixture, exercising no production
// code. Buy prices and targets below model a genuine 20% target spread so the
// shipped target-percentage / performance-return helpers are actually tested.

interface PortfolioStock {
  stock: string;
  target: number;
  buyPrice: number;
  shares: number;
  dividends: { exDivDate: Date; amount: number }[];
}

const g = globalThis as unknown as {
  GRQProjection: {
    calculateTargetPercentage: (
      buyPrice: number | null,
      adjustedTarget: number | null,
    ) => number | null;
    calculatePerformanceReturn: (
      buyPrice: number,
      currentPrice: number,
      totalDividends?: number,
    ) => number | null;
  };
};
const GRQProjection = g.GRQProjection;

Deno.test("Portfolio Target Tests", async (t) => {
  const scoreDate = new Date(2024, 10, 15); // November 15, 2024
  const ninetyDayDate = new Date(
    scoreDate.getTime() + (90 * 24 * 60 * 60 * 1000),
  );

  // Mock portfolio data - equal investment amounts (~$6,000 each). Each stock's
  // target sits ~20% above its buy price (a real spread, not buyPrice == target).
  const mockPortfolio: PortfolioStock[] = [
    {
      stock: "NYSE:WFG",
      target: 98.90,
      buyPrice: 82.42,
      shares: Math.floor(6000 / 82.42), // ~72 shares
      dividends: [
        { exDivDate: new Date("2024-12-19"), amount: 0.135 },
        { exDivDate: new Date("2024-12-27"), amount: 0.32 },
      ],
    },
    {
      stock: "NYSE:CX",
      target: 5.85,
      buyPrice: 4.88,
      shares: Math.floor(6000 / 4.88), // ~1229 shares
      dividends: [
        { exDivDate: new Date("2024-12-10"), amount: 0.02067 },
      ],
    },
    {
      stock: "NASDAQ:KLAC",
      target: 695.01,
      buyPrice: 579.18,
      shares: Math.floor(6000 / 579.18), // ~10 shares
      dividends: [
        { exDivDate: new Date("2024-11-18"), amount: 1.7 },
      ],
    },
  ];

  await t.step("portfolio target calculation", () => {
    // Drive each stock's target through the shipped helper, then average.
    const targetPercentages = mockPortfolio.map((stock) =>
      GRQProjection.calculateTargetPercentage(
        stock.buyPrice,
        stock.target,
      ) as number
    );
    const portfolioTarget = targetPercentages.reduce((sum, t) => sum + t, 0) /
      targetPercentages.length;

    // Each stock targets ~20%, so the portfolio target should be ~20%.
    assertAlmostEquals(
      portfolioTarget,
      20.0,
      0.2,
      "Portfolio target should be ~20%",
    );
  });

  await t.step("portfolio 90-day performance", () => {
    // Mock 90-day prices: a 20% price gain on each stock's buy price.
    const mock90DayPrices: Record<string, number> = {
      "NYSE:WFG": 82.42 * 1.20,
      "NYSE:CX": 4.88 * 1.20,
      "NASDAQ:KLAC": 579.18 * 1.20,
    };

    let totalPortfolioValue = 0;
    let totalInvestment = 0;

    mockPortfolio.forEach((stock) => {
      const investment = stock.shares * stock.buyPrice;
      const totalDividends = stock.dividends.reduce(
        (sum, div) => sum + div.amount,
        0,
      );
      // Per-stock total return (price + dividend) from the shipped helper.
      const returnPct = GRQProjection.calculatePerformanceReturn(
        stock.buyPrice,
        mock90DayPrices[stock.stock],
        totalDividends,
      ) as number;
      const stockValue = investment * (1 + returnPct / 100);

      totalInvestment += investment;
      totalPortfolioValue += stockValue;
    });

    const portfolioReturn =
      ((totalPortfolioValue - totalInvestment) / totalInvestment) * 100;
    // ~20% price gain plus small dividend contributions.
    assertAlmostEquals(
      portfolioReturn,
      20.0,
      2.0,
      "Portfolio return should be close to 20%",
    );
  });

  await t.step("date calculations", () => {
    const daysDiff = Math.round(
      (ninetyDayDate.getTime() - scoreDate.getTime()) / (1000 * 60 * 60 * 24),
    );
    const expected90DayDate = new Date(2025, 1, 13); // February 13, 2025

    assertEquals(daysDiff, 90, "Should be exactly 90 days");
    assertEquals(
      ninetyDayDate.getTime(),
      expected90DayDate.getTime(),
      "90-day date should match expected",
    );
  });

  await t.step("dividend inclusion within 90 days", () => {
    // Test that dividends within 90 days are included
    const testStock = mockPortfolio[0]; // NYSE:WFG
    const dividendsWithin90Days = testStock.dividends.filter((d) =>
      d.exDivDate <= ninetyDayDate
    );

    assertEquals(
      dividendsWithin90Days.length,
      2,
      "NYSE:WFG should have 2 dividends within 90 days",
    );
  });
});
