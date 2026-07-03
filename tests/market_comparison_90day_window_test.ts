// Regression tests for issue #705 — the "Market Performance Comparison" cards
// must be judged over the SAME fixed 90-day window as the portfolio, NOT the
// plotted chart window (desktop default 180 days per #465/#466).
//
// Before this fix getMarketPerformanceData() passed the per-device chart window
// end (GRQProjection.deviceWindowEnd) into the window-aware kernel, so for a
// 5 Jan 2026 score date the cards reported each index's gain to the latest
// close (~178 days) — SP500 +8.4% / NASDAQ +11.3% / Russell 2000 +18.2% — while
// the portfolio was judged at the 90-day mark. At 90 days the true figures are
// SP500 -4.6% / NASDAQ -6.5% / Russell 2000 -0.7%: the portfolio beat all three.
//
// These tests exercise the REAL shipped pure helpers the dashboard calls, plus
// the REAL committed docs/market-indices.json, so the massive error can never
// silently reoccur.
import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import "../docs/projection.js";
import "../docs/market_index.js";

// deno-lint-ignore no-explicit-any
const g = globalThis as any;
const GRQProjection = g.GRQProjection;
const GRQMarketIndex = g.GRQMarketIndex;

const DAY_MS = 24 * 60 * 60 * 1000;

// --- The fixed 90-day judgement window -------------------------------------

Deno.test("judgementWindowEnd - end is exactly scoreDate + 90 days at local midnight", () => {
  const scoreDate = new Date("2026-01-05T13:45:00");
  const base = GRQProjection.setDateToMidnight(new Date("2026-01-05"));
  const end = GRQProjection.judgementWindowEnd(scoreDate);
  assertEquals(
    end.getTime(),
    GRQProjection.setDateToMidnight(new Date(base.getTime() + 90 * DAY_MS))
      .getTime(),
  );
  assertEquals(end.getHours(), 0);
});

Deno.test("judgementWindowEnd - independent of the chart/device window (the #705 fix)", () => {
  // Unlike deviceWindowEnd, the judgement window never widens to 180 days on
  // desktop: it is a fixed 90-day mark so the cards match the portfolio.
  const scoreDate = new Date("2026-01-05T09:30:00");
  const judgement = GRQProjection.judgementWindowEnd(scoreDate);
  // Always equals an explicit 90-day chart window, never the 180-day default.
  // (Issue #711 makes 180 the default on every device, so 90 is compared
  // explicitly rather than via the old mobile default.)
  assertEquals(
    judgement.getTime(),
    GRQProjection.deviceWindowEnd(scoreDate, true, 90).getTime(),
  );
  assert(
    judgement.getTime() < GRQProjection.deviceWindowEnd(scoreDate, false)
      .getTime(),
    "judgement window must be shorter than the 180-day default chart window",
  );
});

Deno.test("judgementWindowEnd - missing / unparseable score date returns null (blank, never throws)", () => {
  assertEquals(GRQProjection.judgementWindowEnd(null), null);
  assertEquals(GRQProjection.judgementWindowEnd(undefined), null);
  assertEquals(GRQProjection.judgementWindowEnd(new Date("not-a-date")), null);
});

// --- As-of date resolution (for the "as at <date>" card caption) -----------

const PRICE_MAP = {
  "2026-01-05": 100, // score-date baseline
  "2026-03-15": 90, // inside the 90-day window
  "2026-09-01": 130, // latest available close
};
const SERIES = GRQProjection.buildIndexSeriesFromMap(
  PRICE_MAP,
  "SP500",
  "2026-01-05",
  "2026-09-01",
);

Deno.test("asOfDate - resolves the last close date on or before the window end", () => {
  const end = GRQProjection.judgementWindowEnd(new Date("2026-01-05"));
  const date = GRQMarketIndex.asOfDate(SERIES, end);
  assert(date instanceof Date);
  assertEquals(
    GRQProjection.setDateToMidnight(date).getTime(),
    GRQProjection.setDateToMidnight(new Date("2026-03-15")).getTime(),
  );
});

Deno.test("asOfDate - tolerant of empty / missing inputs, never throws", () => {
  assertEquals(GRQMarketIndex.asOfDate(null, new Date()), null);
  assertEquals(GRQMarketIndex.asOfDate([], new Date()), null);
  assertEquals(GRQMarketIndex.asOfDate(SERIES, "not-a-date"), null);
  assertEquals(GRQMarketIndex.asOfDate(SERIES, "2025-12-31"), null);
});

// --- Score dates younger than 90 days: running figure ----------------------

Deno.test("marketPerformanceData at the judgement window - a young score falls back to the latest close", () => {
  // The window end lands past the latest available close, so priceAsOf returns
  // the latest close: a running figure, exactly like the portfolio's Actual.
  const youngMap = {
    "2026-06-01": 200,
    "2026-06-20": 220, // latest close, only ~19 days after the score date
  };
  const series = GRQProjection.buildIndexSeriesFromMap(
    youngMap,
    "SP500",
    "2026-06-01",
    "2026-06-20",
  );
  const end = GRQProjection.judgementWindowEnd(new Date("2026-06-01"));
  const perf = GRQMarketIndex.marketPerformanceData({ sp500: series }, end);
  assertEquals(perf.sp500.currentPrice, 220); // latest close, window not matured
  assertAlmostEquals(perf.sp500.performance, 10, 1e-9);
});

// --- The real historical regression named in issue #705 --------------------

// The exact index closes the user asked us to double-check (score date
// 5 Jan 2026 and the 90-day mark, whose last close is 2 Apr 2026 — 5 Apr is a
// Sunday). Pinned so the 180-vs-90 error can never reoccur.
const BASELINE_05_JAN_2026 = {
  sp500: 6902.05,
  nasdaq: 23395.82,
  russell2000: 2547.92,
};
const CLOSE_02_APR_2026 = {
  sp500: 6582.69,
  nasdaq: 21879.18,
  russell2000: 2530.04,
};
const NINETY_DAY_PERCENT = {
  sp500: -4.6,
  nasdaq: -6.5,
  russell2000: -0.7,
};

Deno.test("issue #705 - the committed data file holds the nominated historical closes", async () => {
  const data = JSON.parse(
    await Deno.readTextFile("docs/market-indices.json"),
  ) as Record<string, Record<string, number>>;
  for (const key of ["sp500", "nasdaq", "russell2000"] as const) {
    assertEquals(
      data[key]["2026-01-05"],
      BASELINE_05_JAN_2026[key],
      `${key} 5 Jan 2026 baseline`,
    );
    assertEquals(
      data[key]["2026-04-02"],
      CLOSE_02_APR_2026[key],
      `${key} 2 Apr 2026 (90-day) close`,
    );
  }
});

Deno.test("issue #705 - cards judged at 90 days report the real -4.6% / -6.5% / -0.7% (not the 180-day gains)", async () => {
  const data = JSON.parse(
    await Deno.readTextFile("docs/market-indices.json"),
  ) as Record<string, Record<string, number>>;

  const scoreDate = new Date("2026-01-05");
  const marketIndexData: Record<string, unknown> = {};
  for (
    const [key, name] of [
      ["sp500", "SP500"],
      ["nasdaq", "NASDAQ"],
      ["russell2000", "Russell 2000"],
    ] as const
  ) {
    // Series built over the FULL loaded range (score date -> today), exactly as
    // loadMarketIndexData does before the 90-day window narrows it.
    marketIndexData[key] = GRQProjection.buildIndexSeriesFromMap(
      data[key],
      name,
      scoreDate,
      new Date("2026-07-01"),
    );
  }

  // The judgement window (fixed 90 days) is what the fixed dashboard passes.
  const end = GRQProjection.judgementWindowEnd(scoreDate);
  const perf = GRQMarketIndex.marketPerformanceData(marketIndexData, end);

  for (const key of ["sp500", "nasdaq", "russell2000"] as const) {
    assertEquals(
      perf[key].currentPrice,
      CLOSE_02_APR_2026[key],
      `${key} end price must be the 2 Apr 2026 (90-day) close`,
    );
    // Rounded to one decimal, matching the card's formatPercent(x, 1).
    assertEquals(
      Math.round(perf[key].performance * 10) / 10,
      NINETY_DAY_PERCENT[key],
      `${key} 90-day figure`,
    );
    assert(perf[key].performance < 0, `${key} was DOWN at 90 days`);
  }

  // Guard the exact bug: the OLD desktop chart window (180 days) would run to
  // the latest close and report double-digit GAINS — the disproven figures.
  const desktopEnd = GRQProjection.deviceWindowEnd(scoreDate, false);
  const buggy = GRQMarketIndex.marketPerformanceData(
    marketIndexData,
    desktopEnd,
  );
  assert(
    buggy.sp500.performance > 5,
    "the 180-day window is the buggy UP case",
  );
  assert(buggy.nasdaq.performance > 5);
  assert(buggy.russell2000.performance > 5);
});
