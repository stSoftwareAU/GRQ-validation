// WHAT-tests for the fair-value band and target-price colour rules (issue #204).
//
// getFairValueRange and getTargetPriceColor used to live only inside the
// GRQValidator class in docs/app.js, where no test could reach them. They are
// now pure kernels in docs/projection.js (the dashboard delegates to them), so
// these tests exercise the REAL production logic rather than a copy.
//
// Expected values are derived from the documented display spec, not the current
// output:
//   - Fair value: both values -> range; one value -> single (with source);
//     neither / no analysis -> null.
//   - Colour: any null input -> ''; target < buy -> red; target > current AND
//     current >= buy -> green; otherwise grey.
import { assertEquals } from "@std/assert";
import "../docs/projection.js";

interface Analysis {
  msFairValue: number | null;
  tipsTarget: number | null;
}

type FairValueRange =
  | { low: number; high: number; type: "range" }
  | { value: number; type: "single"; source: string }
  | null;

const g = globalThis as unknown as {
  GRQProjection: {
    getFairValueRange: (
      analysis: Analysis | undefined | null,
    ) => FairValueRange;
    getTargetPriceColor: (
      targetPrice: number | null,
      currentPrice: number | null,
      buyPrice: number | null,
    ) => string;
  };
};
const GRQProjection = g.GRQProjection;

const RED = "color: #dc3545; font-weight: bold;";
const GREEN = "color: #28a745; font-weight: bold;";
const GREY = "color: #6c757d; font-weight: bold;";

Deno.test("getFairValueRange - both values present returns a sorted range", () => {
  assertEquals(
    GRQProjection.getFairValueRange({ msFairValue: 10, tipsTarget: 20 }),
    { low: 10, high: 20, type: "range" },
  );
});

Deno.test("getFairValueRange - range is sorted regardless of input order", () => {
  // Tips below MS: low/high must still be ordered ascending.
  assertEquals(
    GRQProjection.getFairValueRange({ msFairValue: 30, tipsTarget: 12 }),
    { low: 12, high: 30, type: "range" },
  );
});

Deno.test("getFairValueRange - only MS Fair Value returns a single MS target", () => {
  assertEquals(
    GRQProjection.getFairValueRange({ msFairValue: 15, tipsTarget: null }),
    { value: 15, type: "single", source: "MS Fair Value" },
  );
});

Deno.test("getFairValueRange - only Tips Target returns a single Tips target", () => {
  assertEquals(
    GRQProjection.getFairValueRange({ msFairValue: null, tipsTarget: 25 }),
    { value: 25, type: "single", source: "Tips Target" },
  );
});

Deno.test("getFairValueRange - neither value present returns null", () => {
  assertEquals(
    GRQProjection.getFairValueRange({ msFairValue: null, tipsTarget: null }),
    null,
  );
});

Deno.test("getFairValueRange - missing analysis returns null", () => {
  assertEquals(GRQProjection.getFairValueRange(undefined), null);
  assertEquals(GRQProjection.getFairValueRange(null), null);
});

Deno.test("getTargetPriceColor - any null input returns the default colour", () => {
  assertEquals(GRQProjection.getTargetPriceColor(null, 60, 55), "");
  assertEquals(GRQProjection.getTargetPriceColor(50, null, 55), "");
  assertEquals(GRQProjection.getTargetPriceColor(50, 60, null), "");
});

Deno.test("getTargetPriceColor - target below buy price is red (always bad)", () => {
  // 40 < buy 55 -> red, even though it is also below the current price.
  assertEquals(GRQProjection.getTargetPriceColor(40, 60, 55), RED);
});

Deno.test("getTargetPriceColor - target above current while in profit is green", () => {
  // target 70 > current 60, and current 60 >= buy 55 -> green.
  assertEquals(GRQProjection.getTargetPriceColor(70, 60, 55), GREEN);
});

Deno.test("getTargetPriceColor - target at or below current is grey (not green)", () => {
  // target 58 >= buy 55 (not red) but 58 < current 60, so not green -> grey.
  assertEquals(GRQProjection.getTargetPriceColor(58, 60, 55), GREY);
  // Boundary: target equals current -> the strict '>' fails, so grey.
  assertEquals(GRQProjection.getTargetPriceColor(60, 60, 55), GREY);
});

Deno.test("getTargetPriceColor - target above buy but in loss territory is grey", () => {
  // target 70 >= buy 55 (not red), target > current 50, but current 50 < buy 55
  // so the profit condition fails -> grey.
  assertEquals(GRQProjection.getTargetPriceColor(70, 50, 55), GREY);
});

Deno.test("getTargetPriceColor - target equal to buy price is not red", () => {
  // Boundary: target 55 is NOT < buy 55, and 55 > current 50 with current 50 <
  // buy 55, so it falls through to grey rather than red.
  assertEquals(GRQProjection.getTargetPriceColor(55, 50, 55), GREY);
});
