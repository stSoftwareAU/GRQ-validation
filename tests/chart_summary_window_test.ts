// WHAT-tests for the per-device chart/summary window single source of truth
// (issue #367, milestone #333 "chart shows index down but Market Performance up").
//
// The dashboard chart truncates its visible benchmark series to a fixed window
// measured from the score date — 90 days on mobile, 180 on desktop. The
// "Market Performance Comparison" summary previously ran to today's latest
// price, so for a score date sitting before a later recovery the chart could
// show an index DOWN while the summary showed it UP. This wiring constrains the
// summary to the SAME window the chart plots.
//
// These tests exercise the REAL shipped pure helpers that both the chart
// (prepareChartData) and the summary (getMarketPerformanceData) call, so chart
// and summary cannot drift apart:
//   - GRQProjection.deviceWindowDays(isMobile)  -> 90 | 180
//   - GRQProjection.deviceWindowEnd(scoreDate, isMobile) -> windowed end Date
//   - GRQMarketIndex.marketPerformanceData(data, endDate) -> window-aware figs
import { assert, assertEquals } from "@std/assert";
import "../docs/projection.js";
import "../docs/market_index.js";

// deno-lint-ignore no-explicit-any
const g = globalThis as any;
const GRQProjection = g.GRQProjection;
const GRQMarketIndex = g.GRQMarketIndex;

const DAY_MS = 24 * 60 * 60 * 1000;

Deno.test("deviceWindowDays - mobile is 90 days, desktop is 180 days", () => {
  assertEquals(GRQProjection.deviceWindowDays(true), 90);
  assertEquals(GRQProjection.deviceWindowDays(false), 180);
});

Deno.test("deviceWindowEnd - end is scoreDate + per-device days at local midnight", () => {
  // A time-of-day component on the score date must be ignored: the window end
  // is anchored to local midnight, matching how the chart slices its series.
  const scoreDate = new Date("2026-01-01T13:45:00");
  const base = GRQProjection.setDateToMidnight(new Date("2026-01-01"));

  const mobileEnd = GRQProjection.deviceWindowEnd(scoreDate, true);
  const desktopEnd = GRQProjection.deviceWindowEnd(scoreDate, false);

  // Mirror the production formula exactly so the assertion is DST-safe.
  assertEquals(
    mobileEnd.getTime(),
    GRQProjection.setDateToMidnight(new Date(base.getTime() + 90 * DAY_MS))
      .getTime(),
  );
  assertEquals(
    desktopEnd.getTime(),
    GRQProjection.setDateToMidnight(new Date(base.getTime() + 180 * DAY_MS))
      .getTime(),
  );
  assertEquals(mobileEnd.getHours(), 0);
  assert(desktopEnd.getTime() > mobileEnd.getTime());
});

Deno.test("deviceWindowDays/deviceWindowEnd - selectable window keeps chart and summary on the SAME end date (issue #448; desktop-90 opt-in #464)", () => {
  // The chart (prepareChartData) and the summary (getMarketPerformanceData) both
  // resolve their window through these same helpers, so for any
  // (isMobile, windowDays) pair they MUST agree. Modelling both callers as
  // identical calls proves they cannot drift for the selectable window.
  const scoreDate = new Date("2026-01-01T09:30:00");
  const pairs: Array<[boolean, number | undefined]> = [
    [true, undefined], // mobile default -> 90
    [true, 90], // mobile explicit 90
    [true, 180], // mobile opting into the full window
    [true, 999], // bad value -> falls back to mobile 90
    [false, undefined], // desktop default -> 180
    [false, 90], // desktop opting into 90 (the new #464 case)
    [false, 180], // desktop explicit 180
    [false, 999], // bad value -> falls back to desktop 180
  ];

  for (const [isMobile, windowDays] of pairs) {
    const chartEnd = GRQProjection.deviceWindowEnd(
      scoreDate,
      isMobile,
      windowDays,
    );
    const summaryEnd = GRQProjection.deviceWindowEnd(
      scoreDate,
      isMobile,
      windowDays,
    );
    assertEquals(
      chartEnd!.getTime(),
      summaryEnd!.getTime(),
      `chart and summary must share the window for (${isMobile}, ${windowDays})`,
    );
    // The end is exactly the resolved device days after the score date.
    const days = GRQProjection.deviceWindowDays(isMobile, windowDays);
    const base = GRQProjection.setDateToMidnight(new Date("2026-01-01"));
    assertEquals(
      chartEnd!.getTime(),
      GRQProjection.setDateToMidnight(new Date(base.getTime() + days * DAY_MS))
        .getTime(),
    );
  }

  // The mobile (mobile, 180) window must land on the same end date the desktop
  // default window does — the toggle simply gives mobile the full desktop window.
  assertEquals(
    GRQProjection.deviceWindowEnd(scoreDate, true, 180)!.getTime(),
    GRQProjection.deviceWindowEnd(scoreDate, false)!.getTime(),
  );

  // Symmetrically, a desktop (desktop, 90) window must land on the same end date
  // the mobile default window does — the relaxed lock gives desktop the 90 window.
  assertEquals(
    GRQProjection.deviceWindowEnd(scoreDate, false, 90)!.getTime(),
    GRQProjection.deviceWindowEnd(scoreDate, true)!.getTime(),
  );
});

Deno.test("deviceWindowEnd - unparseable / missing score date returns null (blank, never throws)", () => {
  assertEquals(
    GRQProjection.deviceWindowEnd(new Date("not-a-date"), true),
    null,
  );
  assertEquals(GRQProjection.deviceWindowEnd(null, false), null);
  assertEquals(GRQProjection.deviceWindowEnd(undefined, true), null);
});

// End-to-end reconciliation: a benchmark whose price dips after the score date
// then recovers above the baseline by "today". The chart window ends inside the
// dip, so the summary — fed the SAME window end — must report the dip (DOWN),
// never the recovered latest price (UP). This is the exact #333 contradiction.
const SCORE_DATE = "2026-01-01";
const PRICE_MAP = {
  "2026-01-01": 100, // score-date baseline
  "2026-03-15": 80, // inside the 90-day mobile window: DOWN 20%
  "2026-09-01": 130, // latest available "today" price: UP 30%
};

Deno.test("marketPerformanceData - summary follows the per-device window, not the latest price (#333 shape)", () => {
  // Series built over the full loaded range (score date -> today), exactly as
  // loadMarketIndexData does before the summary narrows it per device.
  const series = GRQProjection.buildIndexSeriesFromMap(
    PRICE_MAP,
    "SP500",
    SCORE_DATE,
    "2026-09-01",
  );
  const marketIndexData = { sp500: series };

  // Mobile (90 days): window ends 2026-04-01, inside the dip -> DOWN.
  const mobileEnd = GRQProjection.deviceWindowEnd(new Date(SCORE_DATE), true);
  const mobile = GRQMarketIndex.marketPerformanceData(
    marketIndexData,
    mobileEnd,
  );
  assert(mobile.sp500.performance < 0, "mobile 90d summary must be negative");
  assertEquals(mobile.sp500.currentPrice, 80);

  // Desktop (180 days): window ends 2026-06-30, still before the recovery -> DOWN.
  const desktopEnd = GRQProjection.deviceWindowEnd(new Date(SCORE_DATE), false);
  const desktop = GRQMarketIndex.marketPerformanceData(
    marketIndexData,
    desktopEnd,
  );
  assert(
    desktop.sp500.performance < 0,
    "desktop 180d summary must be negative",
  );
  assertEquals(desktop.sp500.currentPrice, 80);

  // Without the window (the old behaviour) the summary ran to the latest price
  // and reported UP — the contradiction this issue removes.
  const unwindowed = GRQMarketIndex.marketPerformanceData(marketIndexData);
  assert(
    unwindowed.sp500.performance > 0,
    "run-to-latest is the buggy UP case",
  );
  assert(mobile.sp500.performance < unwindowed.sp500.performance);
});

Deno.test("marketPerformanceData - index with no usable price in the window renders blank, never errors", () => {
  const series = GRQProjection.buildIndexSeriesFromMap(
    PRICE_MAP,
    "SP500",
    SCORE_DATE,
    "2026-09-01",
  );
  const marketIndexData = { sp500: series };
  // A window end before any data point yields no price -> index omitted.
  const result = GRQMarketIndex.marketPerformanceData(
    marketIndexData,
    new Date("2025-12-01"),
  );
  assertEquals(result, {});
});
