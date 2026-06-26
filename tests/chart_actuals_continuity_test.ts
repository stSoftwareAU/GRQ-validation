// Regression tests for the day-90 actuals line break (issue #592).
//
// The dashboard chart draws the actuals as two Chart.js datasets: a solid-blue
// "Actual" series up to the 90-Day Target and a faded-grey "Actual (After 90
// Days)" tail after it. The day-90 boundary point used to live only in the blue
// series, so the grey series started one point later and Chart.js drew no
// segment between them — a visible one-segment gap at the split.
//
// GRQProjection.bridgeActualsAfter90(before90, after90) fixes this by prepending
// a copy of the day-90 boundary point to the after-90 series, giving the two
// datasets a shared point so the line stays continuous. The intended blue ->
// grey colour change is untouched (separate datasets, separate colours), and the
// #496 gating (only draw the tail when the window runs past day 90) is unchanged
// because the helper returns the after-90 array verbatim when there is nothing
// to bridge.
import { assert, assertEquals } from "@std/assert";
import "../docs/projection.js";

// deno-lint-ignore no-explicit-any
const g = globalThis as any;
const GRQProjection = g.GRQProjection;

const before90 = [
  { x: new Date("2024-01-01"), y: 1 },
  { x: new Date("2024-03-31"), y: 5 }, // day-90 boundary point
];
const after90 = [
  { x: new Date("2024-04-01"), y: 6 },
  { x: new Date("2024-04-02"), y: 7 },
];

Deno.test("bridgeActualsAfter90 - shares the day-90 boundary point so the line is continuous", () => {
  const bridged = GRQProjection.bridgeActualsAfter90(before90, after90);
  // One extra point prepended.
  assertEquals(bridged.length, after90.length + 1);
  // The prepended point IS the day-90 boundary point (last before-90 point).
  const boundary = before90[before90.length - 1];
  assertEquals(bridged[0].x.getTime(), boundary.x.getTime());
  assertEquals(bridged[0].y, boundary.y);
  // The original after-90 points follow, in order and unchanged.
  assertEquals(bridged.slice(1), after90);
});

Deno.test("bridgeActualsAfter90 - flags the bridge point and strips its dividend marker", () => {
  const withDiv = [{ x: new Date("2024-03-31"), y: 5, dividend: true }];
  const bridged = GRQProjection.bridgeActualsAfter90(withDiv, after90);
  // The bridge point is flagged so callers render it with no marker (radius 0),
  // avoiding a duplicate dot over the blue boundary point...
  assertEquals(bridged[0].bridge, true);
  // ...and it must not re-draw the dividend dot the blue series already shows.
  assert(!("dividend" in bridged[0]));
});

Deno.test("bridgeActualsAfter90 - does not mutate the input arrays or boundary point", () => {
  const src = [{ x: new Date("2024-03-31"), y: 5, dividend: true }];
  const after = [{ x: new Date("2024-04-01"), y: 6 }];
  GRQProjection.bridgeActualsAfter90(src, after);
  // Original boundary point keeps its dividend marker and the arrays keep length.
  assertEquals(src.length, 1);
  assertEquals(src[0].dividend, true);
  assertEquals(after.length, 1);
});

Deno.test("bridgeActualsAfter90 - empty after-90 series returns it verbatim (no tail to bridge)", () => {
  // Newer predictions with no post-90 data: nothing to bridge, so #496 gating
  // (the tail is simply absent) is preserved.
  const bridged = GRQProjection.bridgeActualsAfter90(before90, []);
  assertEquals(bridged, []);
});

Deno.test("bridgeActualsAfter90 - empty before-90 series returns the after-90 series unchanged", () => {
  const bridged = GRQProjection.bridgeActualsAfter90([], after90);
  assertEquals(bridged, after90);
});

Deno.test("bridgeActualsAfter90 - tolerates missing/invalid arguments", () => {
  assertEquals(
    GRQProjection.bridgeActualsAfter90(undefined, undefined),
    undefined,
  );
  assertEquals(GRQProjection.bridgeActualsAfter90(before90, null), null);
  assertEquals(GRQProjection.bridgeActualsAfter90(null, after90), after90);
});
