// Behavioural (WHAT) tests for the dividend-window kernels (issue #145).
//
// These import the REAL shipped helpers from docs/projection.js — the same
// code the dashboard's GRQValidator delegates to via
// `getDividendsWithin90Days` and the performance/return path — and assert on
// their observable output. They replace the previous tautological tests that
// reimplemented the filter / 90-day sum / `<=` comparison inline and asserted
// the copy against itself, exercising zero shipped code.
import { assertAlmostEquals, assertEquals } from "@std/assert";
import "../docs/projection.js";

interface Dividend {
  exDivDate: Date;
  amount: number;
}

const g = globalThis as unknown as {
  GRQProjection: {
    filterDividendsWithin90Days: (
      dividends: Dividend[] | undefined,
      scoreDate: Date,
    ) => Dividend[];
    sumDividends: (dividends: Dividend[] | undefined) => number;
    calculatePerformanceReturn: (
      buyPrice: number | null,
      currentPrice: number,
      totalDividends: number,
    ) => number | null;
  };
};
const GRQProjection = g.GRQProjection;

// Fixture: NYSE:WFG from the 2024-11-15 score file. The 90-day window from the
// score date ends 2025-02-13, so the first two ex-dividend dates fall inside
// the window and the March payment falls outside it.
const SCORE_DATE = new Date(2024, 10, 15); // 15 November 2024.
const WFG_DIVIDENDS: Dividend[] = [
  { exDivDate: new Date("2024-12-19"), amount: 0.135 },
  { exDivDate: new Date("2024-12-27"), amount: 0.32 },
  { exDivDate: new Date("2025-03-14"), amount: 0.32 },
];

Deno.test("filterDividendsWithin90Days keeps only in-window payments", () => {
  const within = GRQProjection.filterDividendsWithin90Days(
    WFG_DIVIDENDS,
    SCORE_DATE,
  );
  assertEquals(within.length, 2, "Two WFG dividends fall within 90 days");
  assertEquals(
    within.map((d) => d.amount),
    [0.135, 0.32],
    "The kept payments are the December ex-dividend dates",
  );
});

Deno.test("filterDividendsWithin90Days includes a payment on the boundary day", () => {
  // The window edge is score date + 90 days; an ex-div date exactly on the
  // edge is inclusive (<=).
  const boundary = new Date(SCORE_DATE.getTime() + 90 * 24 * 60 * 60 * 1000);
  const within = GRQProjection.filterDividendsWithin90Days(
    [{ exDivDate: boundary, amount: 0.5 }],
    SCORE_DATE,
  );
  assertEquals(within.length, 1, "Boundary-day dividend is inside the window");
});

Deno.test("filterDividendsWithin90Days returns empty for missing or empty input", () => {
  assertEquals(GRQProjection.filterDividendsWithin90Days([], SCORE_DATE), []);
  assertEquals(
    GRQProjection.filterDividendsWithin90Days(undefined, SCORE_DATE),
    [],
  );
});

Deno.test("sumDividends totals the in-window WFG payments", () => {
  const within = GRQProjection.filterDividendsWithin90Days(
    WFG_DIVIDENDS,
    SCORE_DATE,
  );
  assertAlmostEquals(
    GRQProjection.sumDividends(within),
    0.455,
    0.001,
    "0.135 + 0.32 = $0.455 within 90 days",
  );
});

Deno.test("sumDividends returns 0 for missing or empty input", () => {
  assertEquals(GRQProjection.sumDividends([]), 0);
  assertEquals(GRQProjection.sumDividends(undefined), 0);
});

Deno.test("dividend total flows into the shipped performance return", () => {
  // Drive the real return kernel the dashboard uses: the in-window dividend
  // total contributes a price-relative dividend return on top of the price
  // return, proving the filtered/summed dividends reach production output.
  const within = GRQProjection.filterDividendsWithin90Days(
    WFG_DIVIDENDS,
    SCORE_DATE,
  );
  const totalDividends = GRQProjection.sumDividends(within);
  const buyPrice = 91;
  const currentPrice = 100;

  const withDividends = GRQProjection.calculatePerformanceReturn(
    buyPrice,
    currentPrice,
    totalDividends,
  )!;
  const withoutDividends = GRQProjection.calculatePerformanceReturn(
    buyPrice,
    currentPrice,
    0,
  )!;

  // The dividend return component is (0.455 / 91) * 100 ≈ 0.5%.
  assertAlmostEquals(
    withDividends - withoutDividends,
    (0.455 / buyPrice) * 100,
    0.001,
    "Dividend total adds a price-relative dividend return",
  );
});
