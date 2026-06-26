// Regression tests for the single-stock "Stock Performance" chart x-axis
// windowing (issue #606).
//
// The single-stock view pins its x-axis explicitly (unlike the portfolio view,
// which auto-scales). That axis max used to be hard-coded to scoreDate + 95
// days, so selecting the 180-day window still only plotted ~90 days. The fix
// derives the axis bounds from the SAME resolved window the data series uses
// (deviceWindowDays), so the single-stock axis spans the full selected window
// (90 or 180) on either device — matching the portfolio view's windowing.
//
// These exercise the REAL shipped kernel the chart resolves through
// (GRQProjection.singleStockAxisBounds) so the rule cannot drift from the
// window helper it depends on.
import { assert, assertEquals } from "@std/assert";
import "../docs/projection.js";

// deno-lint-ignore no-explicit-any
const g = globalThis as any;
const GRQProjection = g.GRQProjection;

const DAY_MS = 24 * 60 * 60 * 1000;
// Trailing margin past the window end so the day-90 Target dot / trend endpoint
// is never clipped flush against the right edge (mirrors the old 90 + 5 axis).
const MARGIN_DAYS = 5;

const midnight = (iso: string): number =>
  GRQProjection.setDateToMidnight(new Date(iso)).getTime();

// Mirror the implementation: add the day span then re-normalise to local
// midnight so DST transitions inside the window do not skew the comparison.
const expectedMax = (iso: string, windowDays: number): number =>
  GRQProjection.setDateToMidnight(
    new Date(midnight(iso) + (windowDays + MARGIN_DAYS) * DAY_MS),
  ).getTime();

Deno.test("singleStockAxisBounds - desktop 180-day window spans the full 180 days (issue #606 regression)", () => {
  // The exact bug: desktop default (180) must extend the axis to ~185 days, not
  // the old fixed 95. SBLK in the issue: prediction date 2026-01-01, 180 chosen.
  const scoreDate = new Date("2026-01-01T13:45:00");
  const bounds = GRQProjection.singleStockAxisBounds(scoreDate, false, 180);
  assertEquals(bounds.min.getTime(), midnight("2026-01-01"));
  assertEquals(bounds.max.getTime(), expectedMax("2026-01-01", 180));
  // The old hard-coded 95-day axis would stop here — confirm we extend past it.
  assert(
    bounds.max.getTime() > midnight("2026-01-01") + 95 * DAY_MS,
    "180-day axis must extend well past the old 95-day cap",
  );
});

Deno.test("singleStockAxisBounds - 90-day window keeps the historical 95-day axis (unchanged)", () => {
  const scoreDate = new Date("2026-01-01T00:00:00");
  // Mobile default (no explicit window) resolves to 90.
  const mobileDefault = GRQProjection.singleStockAxisBounds(scoreDate, true);
  assertEquals(mobileDefault.max.getTime(), expectedMax("2026-01-01", 90));
  // Desktop opting into 90 (lock relaxed, #464) matches.
  const desktop90 = GRQProjection.singleStockAxisBounds(scoreDate, false, 90);
  assertEquals(desktop90.max.getTime(), expectedMax("2026-01-01", 90));
});

Deno.test("singleStockAxisBounds - mobile 180-day window matches desktop (parity)", () => {
  const scoreDate = new Date("2026-03-15T09:30:00");
  const mobile = GRQProjection.singleStockAxisBounds(scoreDate, true, 180);
  const desktop = GRQProjection.singleStockAxisBounds(scoreDate, false, 180);
  // The window, not the device, drives the axis (mirrors deviceWindowDays).
  assertEquals(mobile.min.getTime(), desktop.min.getTime());
  assertEquals(mobile.max.getTime(), desktop.max.getTime());
  assertEquals(mobile.max.getTime(), expectedMax("2026-03-15", 180));
});

Deno.test("singleStockAxisBounds - bad stored window falls back to the device default", () => {
  const scoreDate = new Date("2026-01-01T00:00:00");
  // A bad value can never widen the window: it inherits the device default.
  // Mobile -> 90.
  assertEquals(
    GRQProjection.singleStockAxisBounds(scoreDate, true, 999).max.getTime(),
    expectedMax("2026-01-01", 90),
  );
  // Desktop -> 180.
  assertEquals(
    GRQProjection.singleStockAxisBounds(scoreDate, false, 999).max.getTime(),
    expectedMax("2026-01-01", 180),
  );
});

Deno.test("singleStockAxisBounds - missing / unparseable score date returns undefined bounds (auto-scale fallback)", () => {
  for (const bad of [null, undefined, new Date("not-a-date")]) {
    const bounds = GRQProjection.singleStockAxisBounds(bad, false, 180);
    assertEquals(bounds.min, undefined);
    assertEquals(bounds.max, undefined);
  }
});

Deno.test("singleStockAxisBounds - end is at local midnight regardless of score-date time-of-day", () => {
  // Two score dates on the same calendar day but different clock times must
  // produce the identical axis (midnight-normalised), so the axis is stable.
  const a = GRQProjection.singleStockAxisBounds(
    new Date("2026-01-01T00:00:01"),
    false,
    180,
  );
  const b = GRQProjection.singleStockAxisBounds(
    new Date("2026-01-01T23:59:59"),
    false,
    180,
  );
  assertEquals(a.min.getTime(), b.min.getTime());
  assertEquals(a.max.getTime(), b.max.getTime());
});
