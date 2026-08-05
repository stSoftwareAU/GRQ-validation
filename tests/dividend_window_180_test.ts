// Behavioural tests for the 180-day view's dividend credit (issue #817).
//
// NYSE:SITC paid a US$1.00/share special dividend, ex 2026-08-03, on a share
// trading around US$4.30 — roughly 23% of the price. The 90-day results credit
// it for every prediction whose window covers the ex-date, but the dashboard
// chart used to cap the credit at day 90 while still plotting the ex-date price
// fall for the whole visible window. A prediction dated 2026-04-03 therefore
// showed SITC crashing ~23% on 3 August (day 122) with no offsetting credit.
//
// These tests drive the REAL shipped kernels from docs/projection.js — the same
// code the dashboard chart delegates to — and assert on their output.
import { assertAlmostEquals, assertEquals } from "@std/assert";
import "../docs/projection.js";

interface Dividend {
  exDivDate: Date;
  amount: number;
}

const g = globalThis as unknown as {
  GRQProjection: {
    cumulativeDividendsAt: (
      dividends: Dividend[] | undefined,
      pointDate: Date,
    ) => number;
    filterDividendsWithin90Days: (
      dividends: Dividend[] | undefined,
      scoreDate: Date,
    ) => Dividend[];
    sumDividends: (dividends: Dividend[] | undefined) => number;
    calculatePerformanceReturn: (
      buyPrice: number,
      currentPrice: number,
      totalDividends: number,
    ) => number | null;
  };
};
const GRQProjection = g.GRQProjection;

// Fixture: NYSE:SITC as published in the 2026-04-03 score file. Day 90 falls on
// 2026-07-02 and day 180 on 2026-09-30, so the 3 August ex-date sits at day 122
// — inside the 180-day chart window but outside the 90-day judgement window.
const SCORE_DATE = new Date(2026, 3, 3); // 3 April 2026.
const SITC_DIVIDENDS: Dividend[] = [
  { exDivDate: new Date(2026, 7, 3), amount: 1.0 }, // 3 August 2026.
];
// Mid prices from the committed feed: 2026-04-06 (5.43/5.35) is the buy basis,
// 2026-07-31 (4.35/4.225) is the last pre-ex point.
const BUY_PRICE = 5.39;
const PRE_EX_PRICE = 4.2875;
// The ex-date fall is the dividend itself: the same mid, US$1.00 lower.
const POST_EX_PRICE = PRE_EX_PRICE - 1.0;

const DAY_90 = new Date(2026, 6, 2); // 2 July 2026.
const DAY_122 = new Date(2026, 7, 3); // 3 August 2026 — the ex-date.
const DAY_180 = new Date(2026, 8, 30); // 30 September 2026.

Deno.test("cumulativeDividendsAt credits a dividend going ex between day 91 and day 180", () => {
  assertAlmostEquals(
    GRQProjection.cumulativeDividendsAt(SITC_DIVIDENDS, DAY_180),
    1.0,
    1e-9,
    "The US$1.00 special is credited at the 180-day edge",
  );
  assertAlmostEquals(
    GRQProjection.cumulativeDividendsAt(SITC_DIVIDENDS, DAY_122),
    1.0,
    1e-9,
    "It is credited from the ex-date itself, the day the price falls",
  );
});

Deno.test("cumulativeDividendsAt withholds the credit before the ex-date", () => {
  // 31 July 2026 — the last close before the 3 August ex-date.
  const preEx = new Date(2026, 6, 31);
  assertEquals(
    GRQProjection.cumulativeDividendsAt(SITC_DIVIDENDS, preEx),
    0,
    "Nothing is credited while the entitlement still travels with the share",
  );
});

Deno.test("cumulativeDividendsAt leaves the 90-day judgement window untouched", () => {
  // Regression guard for the #717 precedent: on or before day 90 the display
  // kernel must agree exactly with the 90-day judgement filter, so widening the
  // chart credit cannot move a settled 90-day result. WFG's real dividend
  // schedule gives payments inside, on and outside the window.
  const wfgScoreDate = new Date(2024, 10, 15); // 15 November 2024.
  const wfgDividends: Dividend[] = [
    { exDivDate: new Date("2024-12-19"), amount: 0.135 },
    { exDivDate: new Date("2024-12-27"), amount: 0.32 },
    { exDivDate: new Date("2025-03-14"), amount: 0.32 },
  ];
  const dayNinety = new Date(
    wfgScoreDate.getTime() + 90 * 24 * 60 * 60 * 1000,
  );
  const judged = GRQProjection.sumDividends(
    GRQProjection.filterDividendsWithin90Days(wfgDividends, wfgScoreDate),
  );
  assertAlmostEquals(
    GRQProjection.cumulativeDividendsAt(wfgDividends, dayNinety),
    judged,
    1e-9,
    "At day 90 the chart credit equals the judged 90-day dividend total",
  );
  assertAlmostEquals(judged, 0.455, 1e-9, "0.135 + 0.32 within 90 days");
});

Deno.test("the day-91+ credit offsets the plotted ex-date price fall", () => {
  // The whole point of the fix: a holder is no worse off on the ex-date, so the
  // total-return line must not step down when the price does.
  const preExReturn = GRQProjection.calculatePerformanceReturn(
    BUY_PRICE,
    PRE_EX_PRICE,
    GRQProjection.cumulativeDividendsAt(
      SITC_DIVIDENDS,
      new Date(2026, 6, 31),
    ),
  )!;
  const postExReturn = GRQProjection.calculatePerformanceReturn(
    BUY_PRICE,
    POST_EX_PRICE,
    GRQProjection.cumulativeDividendsAt(SITC_DIVIDENDS, DAY_122),
  )!;
  assertAlmostEquals(
    postExReturn,
    preExReturn,
    1e-9,
    "Crediting the US$1.00 leaves the total-return line flat across the ex-date",
  );

  // Without the credit — the old day-90 cap — the same point read ~18.6% lower.
  const uncredited = GRQProjection.calculatePerformanceReturn(
    BUY_PRICE,
    POST_EX_PRICE,
    0,
  )!;
  assertAlmostEquals(
    preExReturn - uncredited,
    (1.0 / BUY_PRICE) * 100,
    1e-9,
    "The uncredited line understated the return by the full dividend yield",
  );
});

Deno.test("cumulativeDividendsAt returns 0 for missing, empty or unusable input", () => {
  assertEquals(GRQProjection.cumulativeDividendsAt([], DAY_180), 0);
  assertEquals(GRQProjection.cumulativeDividendsAt(undefined, DAY_180), 0);
  assertEquals(
    GRQProjection.cumulativeDividendsAt(SITC_DIVIDENDS, new Date("nonsense")),
    0,
    "An unparseable point date credits nothing rather than throwing",
  );
});

Deno.test("cumulativeDividendsAt accumulates several dividends in ex-date order", () => {
  const staggered: Dividend[] = [
    { exDivDate: new Date(2026, 4, 15), amount: 0.13 }, // day 42.
    { exDivDate: new Date(2026, 7, 3), amount: 1.0 }, // day 122.
    { exDivDate: new Date(2026, 8, 15), amount: 0.13 }, // day 165.
  ];
  assertAlmostEquals(
    GRQProjection.cumulativeDividendsAt(staggered, DAY_90),
    0.13,
    1e-9,
    "Only the day-42 payment is ex by day 90",
  );
  assertAlmostEquals(
    GRQProjection.cumulativeDividendsAt(staggered, DAY_122),
    1.13,
    1e-9,
    "The special adds to the running total on its ex-date",
  );
  assertAlmostEquals(
    GRQProjection.cumulativeDividendsAt(staggered, DAY_180),
    1.26,
    1e-9,
    "All three are credited by the 180-day edge",
  );
  assertEquals(
    SCORE_DATE.getTime() < staggered[0].exDivDate.getTime(),
    true,
    "The fixture dividends all go ex after the score date",
  );
});
