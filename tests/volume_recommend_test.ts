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
    volumeCappedScore: (
      baseScore: unknown,
      window: Array<{ volume: unknown; lowPrice: unknown }> | unknown,
    ) => number;
  };
};

const {
  BUDGET_DOLLARS,
  volumeRecommend,
  averageDollarVolume,
  isLowVolume,
  buildTrailingVolumeWindow,
  volumeCappedScore,
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

// --- volumeCappedScore: fold low volume into the valuation (issue #578) ---
// Mirrors GRQ training's score cap Math.min(volumeRecommend, priceRecommend, 1)
// so an illiquid name can never surface as a strong recommendation.

Deno.test("volumeCappedScore is published on GRQVolume", () => {
  assertEquals(typeof volumeCappedScore, "function");
});

Deno.test("volumeCappedScore: low-volume name suppresses a high price-based score", () => {
  // Illiquid: 1000 * $5 = $5000/day < budget -> volumeRecommend === -1.
  const illiquid = flatWindow(10, 1000, 5);
  assertEquals(volumeRecommend(illiquid), -1);
  // A strong 0.95 price-based score is capped to the never-recommend value.
  assertEquals(volumeCappedScore(0.95, illiquid), -1);
  // Even a perfect score is suppressed, regardless of the price-based value.
  assertEquals(volumeCappedScore(1, illiquid), -1);
});

Deno.test("volumeCappedScore: liquid name keeps its price-based score unchanged", () => {
  // Liquid: volumeRecommend approaches ~1, so min(recommend, score, 1) === score.
  const liquid = flatWindow(10, 10_000_000, 50);
  assertEquals(volumeCappedScore(0.8, liquid), 0.8);
  assertEquals(volumeCappedScore(0.95, liquid), 0.95);
});

Deno.test("volumeCappedScore: partial illiquidity down-weights proportionally", () => {
  // averagePV = $500,000 -> volumeRecommend === 0.5 (capped). A 0.95 score is
  // pulled down to 0.5; a score already below 0.5 is left alone.
  const partial = flatWindow(10, 100_000, 5);
  assertEquals(volumeRecommend(partial), 0.5);
  assertEquals(volumeCappedScore(0.95, partial), 0.5);
  assertEquals(volumeCappedScore(0.3, partial), 0.3);
});

Deno.test("volumeCappedScore: never exceeds 1, even for an out-of-range score", () => {
  // A score above 1 is bounded by min(volumeRecommend, score, 1). For a liquid
  // window volumeRecommend (~0.99998) dominates, and the result can never top 1.
  const liquid = flatWindow(10, 10_000_000, 50);
  const recommend = volumeRecommend(liquid) as number;
  assertEquals(volumeCappedScore(1.5, liquid), recommend);
  assertEquals((volumeCappedScore(1.5, liquid) as number) <= 1, true);
});

Deno.test("volumeCappedScore: unknown volume leaves the score unchanged (not flagged)", () => {
  // Pre-volume-column CSVs: volumeRecommend === null -> no cap applied.
  const unknown = flatWindow(10, null, 5);
  assertEquals(volumeRecommend(unknown), null);
  assertEquals(volumeCappedScore(0.95, unknown), 0.95);
});

Deno.test("volumeCappedScore: empty / non-array window leaves the score unchanged", () => {
  assertEquals(volumeCappedScore(0.95, []), 0.95);
  assertEquals(volumeCappedScore(0.95, null), 0.95);
  assertEquals(volumeCappedScore(0.95, undefined), 0.95);
});

Deno.test("volumeCappedScore: non-finite base score is returned unchanged", () => {
  const illiquid = flatWindow(10, 1000, 5);
  assertEquals(Number.isNaN(volumeCappedScore(NaN, illiquid) as number), true);
});

Deno.test("volumeCappedScore: numeric-string base score is coerced and capped", () => {
  const illiquid = flatWindow(10, 1000, 5);
  assertEquals(volumeCappedScore("0.95", illiquid), -1);
});

Deno.test("fixture: illiquid name's high score is suppressed, liquid name unchanged", () => {
  // End-to-end as the dashboard wires it (issue #578): a daily market-data
  // series -> trailing volume window -> volume-capped score. Both names carry
  // an identical strong price-based score of 0.97.
  const baseScore = 0.97;

  // Illiquid: 800 shares * $6 = $4800/day << $10000 budget.
  const illiquidSeries = Array.from({ length: 12 }, (_, i) => ({
    date: new Date(2025, 0, i + 1),
    low: 6,
    volume: 800,
  }));
  const illiquidWindow = buildTrailingVolumeWindow(
    illiquidSeries,
    new Date(2025, 0, 31),
  );
  // The strong score is suppressed to the never-recommend value.
  assertEquals(isLowVolume(illiquidWindow), true);
  assertEquals(volumeCappedScore(baseScore, illiquidWindow), -1);

  // Liquid: 5,000,000 shares * $40 = $200,000,000/day >> budget.
  const liquidSeries = Array.from({ length: 12 }, (_, i) => ({
    date: new Date(2025, 0, i + 1),
    low: 40,
    volume: 5_000_000,
  }));
  const liquidWindow = buildTrailingVolumeWindow(
    liquidSeries,
    new Date(2025, 0, 31),
  );
  // The liquid name keeps its price-based score unchanged.
  assertEquals(isLowVolume(liquidWindow), false);
  assertEquals(volumeCappedScore(baseScore, liquidWindow), baseScore);
});
