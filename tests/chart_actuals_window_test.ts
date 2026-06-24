// Regression tests for the mobile 180-day actuals series (issue #496,
// part of milestone #484 item 5: "no actuals in the 180 day view, this was
// all working on the desktop").
//
// The main "Portfolio Performance Over Time" chart splits the actuals into two
// datasets: "Actual" (the first 90 days) and "Actual (After 90 Days)" (the day
// 90 -> window-end tail). The after-90 tail used to be gated on `!isMobile`,
// which silently dropped the actuals between day 90 and day 180 once mobile
// could opt into the 180-day window (issue #464). The tail belongs in the chart
// whenever the resolved visible window extends past day 90 — independent of
// device — so desktop and mobile stay in parity.
//
// These tests exercise the REAL shipped shared kernel both the chart
// (prepareChartData) and any future caller resolve through, so the rule cannot
// drift from the window helper it depends on:
//   - GRQProjection.windowShowsActualsAfter90(isMobile, windowDays) -> boolean
import { assert, assertEquals } from "@std/assert";
import "../docs/projection.js";

// deno-lint-ignore no-explicit-any
const g = globalThis as any;
const GRQProjection = g.GRQProjection;

Deno.test("windowShowsActualsAfter90 - mobile 180-day window shows the after-90 actuals tail (issue #496)", () => {
  // The exact regression: phone-width viewport with the 180-day window selected
  // must render the actuals tail, matching the desktop 180-day view.
  assertEquals(GRQProjection.windowShowsActualsAfter90(true, 180), true);
});

Deno.test("windowShowsActualsAfter90 - mobile 90-day window omits the after-90 tail (unchanged)", () => {
  // The 90-day mobile view ends at day 90, so there is no after-90 tail to draw.
  assertEquals(GRQProjection.windowShowsActualsAfter90(true, 90), false);
  // Mobile default (no explicit window) resolves to 90 -> still omitted.
  assertEquals(GRQProjection.windowShowsActualsAfter90(true, undefined), false);
});

Deno.test("windowShowsActualsAfter90 - desktop views are unchanged (180 shows, 90 omits)", () => {
  // Desktop default (180) keeps the tail it always had.
  assertEquals(GRQProjection.windowShowsActualsAfter90(false, undefined), true);
  assertEquals(GRQProjection.windowShowsActualsAfter90(false, 180), true);
  // Desktop opting into the 90-day window (issue #464) ends at day 90 -> omitted.
  assertEquals(GRQProjection.windowShowsActualsAfter90(false, 90), false);
});

Deno.test("windowShowsActualsAfter90 - mobile and desktop are in parity for the same window", () => {
  // The whole point of the fix: the after-90 tail is a function of the resolved
  // WINDOW, never of the device. For every permitted window the two devices must
  // agree once they have opted into the same window.
  for (const windowDays of [90, 180]) {
    assertEquals(
      GRQProjection.windowShowsActualsAfter90(true, windowDays),
      GRQProjection.windowShowsActualsAfter90(false, windowDays),
      `mobile and desktop must agree for the ${windowDays}-day window`,
    );
  }
});

Deno.test("windowShowsActualsAfter90 - bad stored window falls back to the device default", () => {
  // A bad value can never widen the window, so it inherits the device default:
  // mobile -> 90 (no tail), desktop -> 180 (tail). Mirrors deviceWindowDays.
  assertEquals(GRQProjection.windowShowsActualsAfter90(true, 999), false);
  assertEquals(GRQProjection.windowShowsActualsAfter90(false, 999), true);
});

Deno.test("windowShowsActualsAfter90 - tracks deviceWindowDays (tail iff window > 90)", () => {
  // The predicate must stay derived from the shared window resolver so the two
  // cannot drift apart.
  const pairs: Array<[boolean, number | undefined]> = [
    [true, undefined],
    [true, 90],
    [true, 180],
    [true, 999],
    [false, undefined],
    [false, 90],
    [false, 180],
    [false, 999],
  ];
  for (const [isMobile, windowDays] of pairs) {
    const resolved = GRQProjection.deviceWindowDays(isMobile, windowDays);
    assertEquals(
      GRQProjection.windowShowsActualsAfter90(isMobile, windowDays),
      resolved > 90,
      `(${isMobile}, ${windowDays}) resolved to ${resolved} days`,
    );
  }
  // Sanity: at least one true and one false case were exercised above.
  assert(GRQProjection.windowShowsActualsAfter90(false, 180));
  assert(!GRQProjection.windowShowsActualsAfter90(true, 90));
});
