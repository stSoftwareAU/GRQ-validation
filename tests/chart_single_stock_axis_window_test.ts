// Regression tests for the single-stock "Stock Performance" chart x-axis window
// (issue #606).
//
// The single-stock chart pinned its x-axis max to a hard-coded scoreDate + 95
// days, so selecting the 180-day window still only plotted ~90 days of dates —
// the axis cut the actuals/projection off at day ~95 regardless of the chosen
// window. The portfolio view (the reference) auto-fits the data across the full
// selected window. The fix derives the single-stock axis max from the shared
// window resolver so the chart spans the full selected window on every device.
//
// These tests exercise the REAL shipped shared kernel the chart resolves
// through, so the axis window cannot drift from the window helper it depends on:
//   - GRQProjection.singleStockAxisMax(scoreDate, isMobile, windowDays) -> Date
import { assert, assertEquals } from "@std/assert";
import "../docs/projection.js";

// deno-lint-ignore no-explicit-any
const g = globalThis as any;
const GRQProjection = g.GRQProjection;

const DAY_MS = 24 * 60 * 60 * 1000;
const SCORE_DATE = new Date(2026, 0, 1); // 2026-01-01, prediction date in #606.

Deno.test("singleStockAxisMax - 180-day window spans the full window (issue #606)", () => {
  // The exact regression: 180 selected must push the axis max out across the
  // full 180-day window, not stop at the old ~day-95 cap. The axis max is the
  // resolved window end plus a small target-dot padding.
  const max = GRQProjection.singleStockAxisMax(SCORE_DATE, false, 180);
  const days = Math.round((max.getTime() - SCORE_DATE.getTime()) / DAY_MS);
  assert(
    days > 150,
    `180-day window must extend well past the old 95-day cap (got ${days})`,
  );
  // And it tracks the shared resolver: window end + 5 calendar days.
  const end = GRQProjection.deviceWindowEnd(SCORE_DATE, false, 180);
  const expected = new Date(end);
  expected.setDate(expected.getDate() + 5);
  assertEquals(max.getTime(), expected.getTime());
});

Deno.test("singleStockAxisMax - 90-day window keeps the historical 95-day end", () => {
  // The 90-day view previously ended at scoreDate + 95 days (90 + padding); that
  // behaviour must be preserved so the day-90 target dot stays visible.
  const max = GRQProjection.singleStockAxisMax(SCORE_DATE, true, 90);
  const days = Math.round((max.getTime() - SCORE_DATE.getTime()) / DAY_MS);
  assertEquals(days, 95);
});

Deno.test("singleStockAxisMax - mobile and desktop agree for the same window (parity)", () => {
  // Like the actuals tail, the axis window is a function of the WINDOW, never
  // the device. Once both devices opt into the same window they must agree.
  for (const windowDays of [90, 180]) {
    assertEquals(
      GRQProjection.singleStockAxisMax(SCORE_DATE, true, windowDays).getTime(),
      GRQProjection.singleStockAxisMax(SCORE_DATE, false, windowDays).getTime(),
      `mobile and desktop must agree for the ${windowDays}-day window`,
    );
  }
});

Deno.test("singleStockAxisMax - tracks deviceWindowEnd (window end + 5-day padding)", () => {
  // The axis max must stay derived from the shared window resolver so the chart
  // and the window kernel cannot drift apart.
  const pairs: Array<[boolean, number | undefined]> = [
    [true, 90],
    [true, 180],
    [false, 90],
    [false, 180],
    [true, undefined],
    [false, undefined],
  ];
  for (const [isMobile, windowDays] of pairs) {
    const end = GRQProjection.deviceWindowEnd(SCORE_DATE, isMobile, windowDays);
    // 5 CALENDAR days past the window end (DST-immune, matching the helper).
    const expected = new Date(end);
    expected.setDate(expected.getDate() + 5);
    assertEquals(
      GRQProjection.singleStockAxisMax(SCORE_DATE, isMobile, windowDays)
        .getTime(),
      expected.getTime(),
      `(${isMobile}, ${windowDays}) must be window end + 5 days`,
    );
  }
});

Deno.test("singleStockAxisMax - bad stored window falls back to the 180 default", () => {
  // A bad value inherits the default, now 180 on every form factor (issue #711),
  // so both devices land on the 180-day end (185 with padding). Mirrors
  // deviceWindowDays/deviceWindowEnd.
  const mobile = GRQProjection.singleStockAxisMax(SCORE_DATE, true, 999);
  const desktop = GRQProjection.singleStockAxisMax(SCORE_DATE, false, 999);
  assertEquals(
    mobile.getTime(),
    GRQProjection.singleStockAxisMax(SCORE_DATE, true, 180).getTime(),
  );
  assertEquals(
    desktop.getTime(),
    GRQProjection.singleStockAxisMax(SCORE_DATE, false, 180).getTime(),
  );
});

Deno.test("singleStockAxisMax - missing score date returns null (blank, not error)", () => {
  // Mirrors deviceWindowEnd: a missing score date renders blank rather than
  // throwing.
  assertEquals(GRQProjection.singleStockAxisMax(null, false, 180), null);
  assertEquals(GRQProjection.singleStockAxisMax(undefined, true, 90), null);
});
