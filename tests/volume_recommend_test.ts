// Tests for the shared low-volume / liquidity helper (issue #576), the single
// source of truth consumed by the exclusion (#577) and valuation (#578)
// sub-issues. These exercise the real shipped module, published on
// `globalThis.GRQVolume` by importing it, mirroring tests/format_test.ts.
//
// The volumeRecommend definition is ported from GRQ training so the dashboard
// and the trainer agree; the cases below reproduce GRQ's outputs using DOLLAR
// units (no `/100`) against BUDGET_DOLLARS = 10000.
import { assertEquals } from "@std/assert";
import "../docs/volume_recommend.js";

const g = globalThis as unknown as {
  GRQVolume: {
    BUDGET_DOLLARS: number;
    WEEKDAY_WINDOW: number;
    toFinitePositive: (value: unknown) => number | null;
    averageDollarVolume: (
      window: Array<{ volume: unknown; lowPrice: unknown }> | unknown,
    ) => number | null;
    volumeRecommend: (
      window: Array<{ volume: unknown; lowPrice: unknown }> | unknown,
    ) => number | null;
    isLowVolume: (
      window: Array<{ volume: unknown; lowPrice: unknown }> | unknown,
    ) => boolean;
    buildTrailingVolumeWindow: (
      series: unknown,
      asOfDate: unknown,
      weekdays?: number,
    ) => Array<{ volume: unknown; lowPrice: unknown }>;
  };
};

const {
  BUDGET_DOLLARS,
  volumeRecommend,
  averageDollarVolume,
  isLowVolume,
  buildTrailingVolumeWindow,
} = g.GRQVolume;

// Build a flat window where every day shares one volume and lowPrice.
function flatWindow(
  days: number,
  volume: number | null,
  lowPrice: number | null,
) {
  return Array.from({ length: days }, () => ({ volume, lowPrice }));
}

Deno.test("volume_recommend publishes helpers on globalThis.GRQVolume", () => {
  assertEquals(typeof volumeRecommend, "function");
  assertEquals(typeof averageDollarVolume, "function");
  assertEquals(typeof isLowVolume, "function");
  assertEquals(typeof buildTrailingVolumeWindow, "function");
});

Deno.test("BUDGET_DOLLARS is the single threshold constant (10000 dollars)", () => {
  assertEquals(BUDGET_DOLLARS, 10000);
});

Deno.test("below budget -> volumeRecommend is -1 (never recommend)", () => {
  // 1000 shares * $5 = $5000/day average dollar volume < $10000.
  const window = flatWindow(10, 1000, 5);
  assertEquals(volumeRecommend(window), -1);
  assertEquals(isLowVolume(window), true);
});

Deno.test("liquid name -> volumeRecommend approaches ~1 (not flagged)", () => {
  // 10,000,000 shares * $50 = $500,000,000/day >> budget.
  // marketPercentOfTrade = 1 - 10000/5e8 = 0.99998 (>= 0.99) -> min(.,1).
  const window = flatWindow(10, 10_000_000, 50);
  const recommend = volumeRecommend(window) as number;
  assertEquals(recommend > 0.99 && recommend <= 1, true);
  assertEquals(isLowVolume(window), false);
});

Deno.test("borderline (marketPercentOfTrade < 0.99) -> capped to 0.5", () => {
  // averagePV = $1,000,000 -> marketPercentOfTrade = 1 - 10000/1e6 = 0.99.
  // 0.99 is NOT < 0.99, so this lands on the >=0.99 branch (min with 1).
  // Use $500,000 to get marketPercentOfTrade = 0.98 (< 0.99) -> capped 0.5.
  const window = flatWindow(10, 100_000, 5); // 100000 * 5 = $500,000
  assertEquals(averageDollarVolume(window), 500_000);
  assertEquals(volumeRecommend(window), 0.5);
  assertEquals(isLowVolume(window), false);
});

Deno.test("just above budget stays capped to 0.5 (small marketPercentOfTrade)", () => {
  // averagePV = $20,000 -> marketPercentOfTrade = 0.5 -> min(0.5, 0.5) = 0.5.
  const window = flatWindow(10, 2000, 10);
  assertEquals(averageDollarVolume(window), 20_000);
  assertEquals(volumeRecommend(window), 0.5);
  assertEquals(isLowVolume(window), false);
});

Deno.test("unknown volume across whole window -> null (not flagged)", () => {
  // Pre-volume-column CSVs: every day's volume is null. Insufficient data must
  // NOT mass-exclude historical dates.
  const window = flatWindow(10, null, 5);
  assertEquals(averageDollarVolume(window), null);
  assertEquals(volumeRecommend(window), null);
  assertEquals(isLowVolume(window), false);
});

Deno.test("empty / non-array window -> null, not flagged", () => {
  assertEquals(volumeRecommend([]), null);
  assertEquals(volumeRecommend(null), null);
  assertEquals(volumeRecommend(undefined), null);
  assertEquals(isLowVolume([]), false);
});

Deno.test("present-but-tiny single day IS flagged (mix of known/unknown)", () => {
  // Nine unknown days plus one tiny known day: averaged over the known day
  // only ($3000 < budget) -> flagged. Distinguishes "tiny" from "unknown".
  const window = [
    ...flatWindow(9, null, 5),
    { volume: 600, lowPrice: 5 }, // $3000
  ];
  assertEquals(averageDollarVolume(window), 3000);
  assertEquals(volumeRecommend(window), -1);
  assertEquals(isLowVolume(window), true);
});

Deno.test("non-numeric / zero volume cells are skipped in the average", () => {
  const window = [
    { volume: "not-a-number", lowPrice: 5 },
    { volume: 0, lowPrice: 5 },
    { volume: 1000, lowPrice: 5 }, // $5000, the only usable day
  ];
  assertEquals(averageDollarVolume(window), 5000);
  assertEquals(volumeRecommend(window), -1);
});

Deno.test("buildTrailingVolumeWindow keeps last N rows on/before as-of date", () => {
  const series = [
    { date: new Date("2025-01-01"), low: 5, volume: 100 },
    { date: new Date("2025-01-02"), low: 6, volume: 200 },
    { date: new Date("2025-01-03"), low: 7, volume: 300 }, // as-of date
    { date: new Date("2025-01-04"), low: 8, volume: 400 }, // after -> excluded
  ];
  const window = buildTrailingVolumeWindow(series, new Date("2025-01-03"), 2);
  assertEquals(window, [
    { volume: 200, lowPrice: 6 },
    { volume: 300, lowPrice: 7 },
  ]);
});

Deno.test("buildTrailingVolumeWindow honours an explicit lowPrice field", () => {
  const series = [
    { date: new Date("2025-01-01"), lowPrice: 9, volume: 100 },
  ];
  const window = buildTrailingVolumeWindow(series, new Date("2025-01-02"));
  assertEquals(window, [{ volume: 100, lowPrice: 9 }]);
});

Deno.test("buildTrailingVolumeWindow returns [] for non-array series", () => {
  assertEquals(buildTrailingVolumeWindow(null, new Date()), []);
  assertEquals(buildTrailingVolumeWindow(undefined, new Date()), []);
});

Deno.test("end-to-end: trailing window of an illiquid series flags low-volume", () => {
  const series = Array.from({ length: 12 }, (_, i) => ({
    date: new Date(2025, 0, i + 1),
    low: 4,
    volume: 500, // 500 * 4 = $2000/day << budget
  }));
  const window = buildTrailingVolumeWindow(series, new Date(2025, 0, 31));
  assertEquals(window.length, 10);
  assertEquals(isLowVolume(window), true);
});
