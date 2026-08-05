// Chart-window dividend credit tests (issue #817).
//
// A US$1.00/share SITC special dividend went ex on 2026-08-03. Predictions whose
// 90-day window covers that date credit the cash, but the 180-day chart view
// plotted the ex-date price fall with NO offsetting credit, because every chart
// series filtered dividends through the fixed 90-day window
// (`filterDividendsWithin90Days`). SITC therefore read ~17-25 percentage points
// too low from 3 August onward on any prediction dated day 91-180 before the ex
// date.
//
// The fix keeps the 90-day JUDGEMENT metric capped at 90 days (issue #717
// precedent) and changes only the display-side chart series, via two shared
// kernels in docs/projection.js:
//
//   - `filterDividendsWithinDays(dividends, scoreDate, days)` — the window
//     filter generalised to the visible chart window (90 or 180);
//   - `sumDividendsToDate(dividends, date)` — the cash gone ex on or before a
//     plotted point, so each point carries the dividends actually received by
//     then.
//
// These tests drive the REAL shipped kernels from docs/projection.js and
// compose them exactly as docs/app.js does — no re-implemented maths.
import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import "../docs/projection.js";

interface Dividend {
  exDivDate: Date;
  amount: number;
}

const g = globalThis as unknown as {
  GRQProjection: {
    filterDividendsWithinDays: (
      dividends: Dividend[] | null | undefined,
      scoreDate: Date,
      days: number,
    ) => Dividend[];
    filterDividendsWithin90Days: (
      dividends: Dividend[] | null | undefined,
      scoreDate: Date,
    ) => Dividend[];
    sumDividendsToDate: (
      dividends: Dividend[] | null | undefined,
      date: Date,
    ) => number;
    sumDividends: (dividends: Dividend[] | null | undefined) => number;
    calculatePerformanceReturn: (
      buyPrice: number,
      currentPrice: number,
      totalDividends?: number,
    ) => number | null;
    deviceWindowDays: (isMobile: boolean, windowDays?: number) => number;
  };
};
const GRQProjection = g.GRQProjection;

const DAY = 24 * 60 * 60 * 1000;

// SITC as published: score date 2026-03-14, first traded midpoint 2026-03-16 of
// (5.765 + 5.645) / 2, the US$1.00 special dividend ex 2026-08-03 (day 142 —
// inside a 180-day window, outside the 90-day one), and the post-ex price.
const SITC_SCORE_DATE = new Date("2026-03-14T00:00:00");
const SITC_BUY_PRICE = (5.765 + 5.645) / 2;
const SITC_EX_DATE = new Date("2026-08-03T00:00:00");
const SITC_DIVIDEND: Dividend = { exDivDate: SITC_EX_DATE, amount: 1 };
const SITC_POST_EX_PRICE = 3.31;

Deno.test("filterDividendsWithinDays - 180-day window keeps a day-142 dividend the 90-day window drops", () => {
  const scoreDate = SITC_SCORE_DATE;
  const dividends = [SITC_DIVIDEND];

  // Day 142 is outside the 90-day judgement window...
  assertEquals(
    GRQProjection.filterDividendsWithinDays(dividends, scoreDate, 90).length,
    0,
  );
  // ...and inside the 180-day chart window.
  const within180 = GRQProjection.filterDividendsWithinDays(
    dividends,
    scoreDate,
    180,
  );
  assertEquals(within180.length, 1);
  assertEquals(within180[0].amount, 1);
});

Deno.test("filterDividendsWithinDays - the window end is inclusive", () => {
  const scoreDate = new Date("2026-01-01T00:00:00");
  const onBoundary: Dividend = {
    exDivDate: new Date(scoreDate.getTime() + 180 * DAY),
    amount: 0.5,
  };
  const justAfter: Dividend = {
    exDivDate: new Date(scoreDate.getTime() + 181 * DAY),
    amount: 0.5,
  };

  const kept = GRQProjection.filterDividendsWithinDays(
    [onBoundary, justAfter],
    scoreDate,
    180,
  );
  assertEquals(kept.length, 1);
  assertEquals(kept[0].exDivDate.getTime(), onBoundary.exDivDate.getTime());
});

Deno.test("filterDividendsWithinDays - a missing or empty list yields no dividends", () => {
  const scoreDate = new Date("2026-01-01T00:00:00");
  assertEquals(
    GRQProjection.filterDividendsWithinDays(null, scoreDate, 180).length,
    0,
  );
  assertEquals(
    GRQProjection.filterDividendsWithinDays(undefined, scoreDate, 180).length,
    0,
  );
  assertEquals(
    GRQProjection.filterDividendsWithinDays([], scoreDate, 180).length,
    0,
  );
});

Deno.test("filterDividendsWithin90Days - unchanged: still the 90-day window", () => {
  const scoreDate = new Date("2026-01-01T00:00:00");
  const inside: Dividend = {
    exDivDate: new Date(scoreDate.getTime() + 90 * DAY),
    amount: 0.25,
  };
  const outside: Dividend = {
    exDivDate: new Date(scoreDate.getTime() + 91 * DAY),
    amount: 0.25,
  };

  const kept = GRQProjection.filterDividendsWithin90Days(
    [inside, outside],
    scoreDate,
  );
  assertEquals(kept.length, 1);
  assertEquals(kept[0].exDivDate.getTime(), inside.exDivDate.getTime());
  // The 90-day filter is the general filter at 90 days — one window rule.
  assertEquals(
    kept,
    GRQProjection.filterDividendsWithinDays([inside, outside], scoreDate, 90),
  );
});

Deno.test("sumDividendsToDate - credits only the cash gone ex on or before the point", () => {
  const dividends: Dividend[] = [
    { exDivDate: new Date("2026-04-01T00:00:00"), amount: 0.13 },
    { exDivDate: SITC_EX_DATE, amount: 1 },
  ];

  // The day before the ex-date: only the earlier dividend counts.
  assertAlmostEquals(
    GRQProjection.sumDividendsToDate(
      dividends,
      new Date("2026-08-02T00:00:00"),
    ),
    0.13,
    1e-9,
  );
  // On the ex-date itself the special dividend is credited (inclusive).
  assertAlmostEquals(
    GRQProjection.sumDividendsToDate(dividends, SITC_EX_DATE),
    1.13,
    1e-9,
  );
  // Before any dividend, nothing is credited.
  assertEquals(
    GRQProjection.sumDividendsToDate(
      dividends,
      new Date("2026-03-16T00:00:00"),
    ),
    0,
  );
});

Deno.test("sumDividendsToDate - a missing or empty list credits zero", () => {
  const date = new Date("2026-08-03T00:00:00");
  assertEquals(GRQProjection.sumDividendsToDate(null, date), 0);
  assertEquals(GRQProjection.sumDividendsToDate(undefined, date), 0);
  assertEquals(GRQProjection.sumDividendsToDate([], date), 0);
});

Deno.test("180-day chart series - SITC credits the US$1.00 special dividend on the ex-date", () => {
  // The chart glue: take the dividends inside the VISIBLE window, then credit
  // each plotted point with the cash gone ex by that point's date.
  const windowDays = GRQProjection.deviceWindowDays(false, 180);
  assertEquals(windowDays, 180);
  const windowDividends = GRQProjection.filterDividendsWithinDays(
    [SITC_DIVIDEND],
    SITC_SCORE_DATE,
    windowDays,
  );

  const pointReturn = (date: Date) =>
    GRQProjection.calculatePerformanceReturn(
      SITC_BUY_PRICE,
      SITC_POST_EX_PRICE,
      GRQProjection.sumDividendsToDate(windowDividends, date),
    );

  const priceOnlyReturn = ((SITC_POST_EX_PRICE - SITC_BUY_PRICE) /
    SITC_BUY_PRICE) * 100;
  const dividendReturn = (1 / SITC_BUY_PRICE) * 100;

  // The day before the ex-date the line is the pure price return...
  assertAlmostEquals(
    pointReturn(new Date("2026-08-02T00:00:00"))!,
    priceOnlyReturn,
    1e-9,
  );
  // ...and from the ex-date on it carries the US$1.00 credit, lifting the line
  // by ~17.5 pp so the ex-date price fall is no longer a naked cliff.
  assertAlmostEquals(
    pointReturn(SITC_EX_DATE)!,
    priceOnlyReturn + dividendReturn,
    1e-9,
  );
  assert(dividendReturn > 17);
});

Deno.test("90-day judgement window is unchanged by the 180-day chart credit", () => {
  // The judged metric still filters at 90 days, so a day-142 dividend never
  // reaches it (issue #717 precedent: the metric stays capped at 90 days).
  const judged = GRQProjection.filterDividendsWithin90Days(
    [SITC_DIVIDEND],
    SITC_SCORE_DATE,
  );
  assertEquals(GRQProjection.sumDividends(judged), 0);
  assertAlmostEquals(
    GRQProjection.calculatePerformanceReturn(
      SITC_BUY_PRICE,
      SITC_POST_EX_PRICE,
      GRQProjection.sumDividends(judged),
    )!,
    ((SITC_POST_EX_PRICE - SITC_BUY_PRICE) / SITC_BUY_PRICE) * 100,
    1e-9,
  );
});

Deno.test("chart points on or before day 90 credit exactly what the 90-day window credits", () => {
  // A dividend inside the 90-day window must be credited identically by the
  // old 90-day path and the new window-aware path, so the blue (<= day 90)
  // segment of the chart is untouched by this change.
  const scoreDate = new Date("2026-01-01T00:00:00");
  const early: Dividend = {
    exDivDate: new Date(scoreDate.getTime() + 30 * DAY),
    amount: 0.4,
  };
  const late: Dividend = {
    exDivDate: new Date(scoreDate.getTime() + 120 * DAY),
    amount: 1,
  };
  const dividends = [early, late];

  const dayNinety = new Date(scoreDate.getTime() + 90 * DAY);
  const windowDividends = GRQProjection.filterDividendsWithinDays(
    dividends,
    scoreDate,
    180,
  );

  assertAlmostEquals(
    GRQProjection.sumDividendsToDate(windowDividends, dayNinety),
    GRQProjection.sumDividends(
      GRQProjection.filterDividendsWithin90Days(dividends, scoreDate).filter(
        (d) => d.exDivDate <= dayNinety,
      ),
    ),
    1e-9,
  );
  // Past day 90 the window-aware path adds the later dividend.
  assertAlmostEquals(
    GRQProjection.sumDividendsToDate(
      windowDividends,
      new Date(scoreDate.getTime() + 120 * DAY),
    ),
    1.4,
    1e-9,
  );
});
