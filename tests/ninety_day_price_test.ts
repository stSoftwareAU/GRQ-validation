// 90-day validation-price tests (issue #539).
//
// The Individual Stock Performance page used to label today's LIVE price as
// "Current Price", while Performance and the Gain/Loss working compared the buy
// price against the price at the 90-day validation horizon. The two prices
// disagreed, so a 90-day prediction that genuinely lost money looked "wrong"
// (e.g. QCOM: buy $173, 90-day price ~$128, but live $203).
//
// This tool validates how well a 90-day AI prediction performed; it is NOT a
// live stock-price app. `GRQProjection.priceAtNinetyDayHorizon` is the shared
// kernel that returns the price the validation compares against: the midpoint of
// the last market-data point on or before 90 days after the score date (the
// latest available point when the 90-day window is not yet complete).
import { assertEquals } from "@std/assert";
import "../docs/projection.js";

interface MarketDataPoint {
  date: Date;
  high: number;
  low: number;
}

const g = globalThis as unknown as {
  GRQProjection: {
    priceAtNinetyDayHorizon: (
      marketData: MarketDataPoint[] | undefined,
      scoreDate: Date,
    ) => number | null;
  };
};
const GRQProjection = g.GRQProjection;

const scoreDate = new Date(2026, 0, 1); // 1 Jan 2026.
const day = 24 * 60 * 60 * 1000;
const horizon = new Date(scoreDate.getTime() + 90 * day); // ~1 Apr 2026.

Deno.test("priceAtNinetyDayHorizon ignores live price beyond the 90-day window", () => {
  // Reproduces the QCOM report: the 90-day-horizon price lost money even though
  // the LIVE price (well past the window) had since rallied above the buy price.
  const marketData: MarketDataPoint[] = [
    { date: scoreDate, high: 175, low: 171 }, // ~buy day: $173.
    { date: new Date(horizon.getTime() - day), high: 130, low: 127 }, // ~$128.50 at horizon.
    { date: new Date(horizon.getTime() + 30 * day), high: 205, low: 202 }, // live ~$203.50, ignored.
  ];
  // Last point on or before the horizon is the $128.50 one, not the live price.
  assertEquals(
    GRQProjection.priceAtNinetyDayHorizon(marketData, scoreDate),
    128.5,
  );
});

Deno.test("priceAtNinetyDayHorizon returns the latest point when the window is incomplete", () => {
  // No data has reached the 90-day horizon yet, so the latest available point is
  // used (it naturally falls within the not-yet-complete window).
  const marketData: MarketDataPoint[] = [
    { date: scoreDate, high: 175, low: 171 },
    { date: new Date(scoreDate.getTime() + 10 * day), high: 181, low: 179 }, // latest, day 10 of 90.
  ];
  assertEquals(
    GRQProjection.priceAtNinetyDayHorizon(marketData, scoreDate),
    180,
  );
});

Deno.test("priceAtNinetyDayHorizon returns null when there is no usable data", () => {
  assertEquals(GRQProjection.priceAtNinetyDayHorizon([], scoreDate), null);
  assertEquals(
    GRQProjection.priceAtNinetyDayHorizon(undefined, scoreDate),
    null,
  );
  // Every point is before the score date's 90-day window start is irrelevant —
  // points strictly after the horizon with none on/before it yield null.
  const allAfterHorizon: MarketDataPoint[] = [
    { date: new Date(horizon.getTime() + day), high: 100, low: 90 },
  ];
  assertEquals(
    GRQProjection.priceAtNinetyDayHorizon(allAfterHorizon, scoreDate),
    null,
  );
});

Deno.test("priceAtNinetyDayHorizon picks the price exactly on the horizon date", () => {
  const marketData: MarketDataPoint[] = [
    { date: scoreDate, high: 175, low: 171 },
    { date: horizon, high: 160, low: 158 }, // exactly day 90: $159.
  ];
  assertEquals(
    GRQProjection.priceAtNinetyDayHorizon(marketData, scoreDate),
    159,
  );
});
