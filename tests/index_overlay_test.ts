// Tests for the headless benchmark-index overlay engine (issue #431, the
// stretch goal of milestone #422).
//
// These import the REAL shipped helpers from docs/index_overlay.js (and its
// dependencies docs/projection.js, docs/market_index.js, docs/trend_series.js)
// and assert on their observable output:
//   - each index's % return reuses the shared GRQProjection.buildIndexSeriesFromMap
//     + GRQMarketIndex.indexPerformance kernels (no new index maths);
//   - non-matured score dates (newer than today - 90 days) are excluded, exactly
//     as the Actual / Target trend series excludes them;
//   - index buckets align on the SAME GRQTrendSeries.bucketStartDate buckets as
//     Actual / Target, with the per-index mean ignoring missing values;
//   - the per-index toggles default to all-off and gate which datasets appear.
import { assertAlmostEquals, assertEquals, assertThrows } from "@std/assert";
import "../docs/projection.js";
import "../docs/market_index.js";
import "../docs/trend_series.js";
import "../docs/index_overlay.js";

type PriceMap = Record<string, number>;

interface OverlayPoint {
  date: Date;
  returns: Record<string, number | null>;
}

interface OverlayBucket extends OverlayPoint {
  count: number;
}

interface OverlayDataset {
  key: string;
  name: string;
  borderColor: string | null;
  backgroundColor: string | null;
  points: { x: Date; y: number }[];
}

const g = globalThis as unknown as {
  GRQIndexOverlay: {
    OVERLAY_WINDOW_DAYS: number;
    OVERLAY_INDICES: {
      key: string;
      name: string;
      borderColor: string | null;
      backgroundColor: string | null;
    }[];
    DEFAULT_TOGGLES: Record<string, boolean>;
    normaliseToggles: (
      toggles: Record<string, unknown> | null | undefined,
    ) => Record<string, boolean>;
    enabledIndexKeys: (
      toggles: Record<string, unknown> | null | undefined,
    ) => string[];
    indexReturnForScoreDate: (
      priceMap: PriceMap | null,
      scoreDate: string | Date,
      windowDays?: number,
    ) => number | null;
    buildIndexOverlaySeries: (
      scoreDates: (string | Date)[],
      marketIndices: Record<string, PriceMap>,
      today: Date,
    ) => OverlayPoint[];
    aggregateIndexOverlay: (
      series: OverlayPoint[],
      granularity?: string,
    ) => OverlayBucket[];
    buildIndexOverlayData: (
      scoreDates: (string | Date)[],
      marketIndices: Record<string, PriceMap>,
      today: Date,
      granularity?: string,
      toggles?: Record<string, unknown>,
    ) => {
      granularity: string;
      toggles: Record<string, boolean>;
      buckets: OverlayBucket[];
      datasets: OverlayDataset[];
    };
  };
};
const Overlay = g.GRQIndexOverlay;

// June 1, 2025 → maturity cutoff is March 3, 2025 (today - 90 days). Score
// dates on or before the cutoff are matured; later ones are not.
const TODAY = new Date(2025, 5, 1);

Deno.test("indexReturnForScoreDate - % return from baseline over the 90-day window", () => {
  // Baseline = first close on/after the score date; end = last close on/before
  // score date + 90 days. The 2025-05-01 close is outside the window so it does
  // not move the result: (120 - 100) / 100 = 20%.
  const priceMap: PriceMap = {
    "2025-01-02": 100,
    "2025-03-15": 120,
    "2025-05-01": 200,
  };
  const ret = Overlay.indexReturnForScoreDate(priceMap, "2025-01-02");
  assertAlmostEquals(ret as number, 20, 1e-9);
});

Deno.test("indexReturnForScoreDate - matches the shared market_index calc directly", () => {
  const priceMap: PriceMap = { "2025-01-02": 100, "2025-03-15": 150 };
  const start = new Date(2025, 0, 2);
  const end = new Date(2025, 0, 2);
  end.setDate(end.getDate() + Overlay.OVERLAY_WINDOW_DAYS);
  const proj = (globalThis as unknown as {
    GRQProjection: {
      buildIndexSeriesFromMap: (
        m: PriceMap,
        n: string,
        s: Date,
        e: Date,
      ) => unknown;
    };
  }).GRQProjection;
  const market = (globalThis as unknown as {
    GRQMarketIndex: {
      indexPerformance: (
        s: unknown,
        e: Date,
      ) => { performance: number } | null;
    };
  }).GRQMarketIndex;
  const series = proj.buildIndexSeriesFromMap(priceMap, "", start, end);
  const expected = market.indexPerformance(series, end);
  assertAlmostEquals(
    Overlay.indexReturnForScoreDate(priceMap, "2025-01-02") as number,
    (expected as { performance: number }).performance,
    1e-9,
  );
});

Deno.test("indexReturnForScoreDate - null when window has no usable prices", () => {
  // All prices precede the score date, so the window is empty.
  const priceMap: PriceMap = { "2024-01-01": 100 };
  assertEquals(Overlay.indexReturnForScoreDate(priceMap, "2025-01-02"), null);
});

Deno.test("indexReturnForScoreDate - null on missing / invalid price map", () => {
  assertEquals(Overlay.indexReturnForScoreDate(null, "2025-01-02"), null);
  assertEquals(
    Overlay.indexReturnForScoreDate({} as PriceMap, "2025-01-02"),
    null,
  );
});

Deno.test("buildIndexOverlaySeries - excludes non-matured score dates", () => {
  const indices: Record<string, PriceMap> = {
    sp500: { "2025-01-02": 100, "2025-03-15": 110, "2025-06-30": 130 },
  };
  // 2025-01-02 is matured; 2025-04-01 is after the cutoff (not matured).
  const series = Overlay.buildIndexOverlaySeries(
    ["2025-01-02", "2025-04-01"],
    indices,
    TODAY,
  );
  assertEquals(series.length, 1);
  assertEquals(series[0].date.getTime(), new Date(2025, 0, 2).getTime());
  assertAlmostEquals(series[0].returns.sp500 as number, 10, 1e-9);
});

Deno.test("buildIndexOverlaySeries - per-index returns; missing index is null; chronological order", () => {
  const indices: Record<string, PriceMap> = {
    sp500: { "2025-01-02": 100, "2025-03-15": 110 },
    // nasdaq has no data inside 2025-01-02's window ([01-02, 04-02]) but does
    // inside 2025-02-03's window ([02-03, 05-04]).
    nasdaq: { "2025-04-10": 200, "2025-04-20": 230 },
    // russell2000 deliberately absent → null for every date.
  };
  const series = Overlay.buildIndexOverlaySeries(
    ["2025-02-03", "2025-01-02"],
    indices,
    TODAY,
  );
  // Sorted ascending by date.
  assertEquals(series[0].date.getTime(), new Date(2025, 0, 2).getTime());
  assertEquals(series[1].date.getTime(), new Date(2025, 1, 3).getTime());
  assertAlmostEquals(series[0].returns.sp500 as number, 10, 1e-9);
  assertEquals(series[0].returns.nasdaq, null);
  assertAlmostEquals(series[1].returns.nasdaq as number, 15, 1e-9);
  assertEquals(series[1].returns.russell2000, null);
});

Deno.test("aggregateIndexOverlay - buckets align on bucketStartDate and mean per index", () => {
  const Trend = (globalThis as unknown as {
    GRQTrendSeries: { bucketStartDate: (d: Date, g: string) => Date };
  }).GRQTrendSeries;
  const series: OverlayPoint[] = [
    { date: new Date(2025, 0, 6), returns: { sp500: 10 } },
    { date: new Date(2025, 0, 20), returns: { sp500: 20 } },
    { date: new Date(2025, 1, 10), returns: { sp500: 8 } },
  ];
  const buckets = Overlay.aggregateIndexOverlay(series, "month");
  assertEquals(buckets.length, 2);
  // First bucket is January's start date — the SAME representative date the
  // Trend engine uses, so the index line shares the Actual / Target X axis.
  assertEquals(
    buckets[0].date.getTime(),
    Trend.bucketStartDate(new Date(2025, 0, 6), "month").getTime(),
  );
  assertAlmostEquals(buckets[0].returns.sp500 as number, 15, 1e-9); // (10+20)/2
  assertEquals(buckets[0].count, 2);
  assertAlmostEquals(buckets[1].returns.sp500 as number, 8, 1e-9);
});

Deno.test("aggregateIndexOverlay - per-index mean ignores null members", () => {
  const series: OverlayPoint[] = [
    { date: new Date(2025, 0, 6), returns: { sp500: 10, nasdaq: null } },
    { date: new Date(2025, 0, 20), returns: { sp500: null, nasdaq: 30 } },
  ];
  const [bucket] = Overlay.aggregateIndexOverlay(series, "month");
  // sp500 had one usable member, nasdaq the other → each is that member's value.
  assertAlmostEquals(bucket.returns.sp500 as number, 10, 1e-9);
  assertAlmostEquals(bucket.returns.nasdaq as number, 30, 1e-9);
  // russell2000 had no usable member anywhere → null.
  assertEquals(bucket.returns.russell2000, null);
});

Deno.test("aggregateIndexOverlay - unknown granularity throws", () => {
  assertThrows(
    () => Overlay.aggregateIndexOverlay([], "fortnight"),
    Error,
    "Unknown granularity",
  );
});

Deno.test("normaliseToggles - fills the all-off default and coerces booleans", () => {
  assertEquals(Overlay.normaliseToggles(undefined), {
    sp500: false,
    nasdaq: false,
    russell2000: false,
  });
  assertEquals(Overlay.normaliseToggles({ sp500: 1, bogus: true }), {
    sp500: true,
    nasdaq: false,
    russell2000: false,
  });
});

Deno.test("DEFAULT_TOGGLES - every index defaults off", () => {
  assertEquals(Overlay.DEFAULT_TOGGLES, {
    sp500: false,
    nasdaq: false,
    russell2000: false,
  });
  assertEquals(Overlay.enabledIndexKeys(Overlay.DEFAULT_TOGGLES), []);
  assertEquals(Overlay.enabledIndexKeys({ nasdaq: true }), ["nasdaq"]);
});

Deno.test("buildIndexOverlayData - default renders no index datasets (all off)", () => {
  const indices: Record<string, PriceMap> = {
    sp500: { "2025-01-02": 100, "2025-03-15": 110 },
  };
  const result = Overlay.buildIndexOverlayData(
    ["2025-01-02"],
    indices,
    TODAY,
  );
  assertEquals(result.datasets, []);
  // Buckets are still computed (the colour key can list every index).
  assertEquals(result.buckets.length, 1);
  assertEquals(result.toggles, Overlay.DEFAULT_TOGGLES);
});

Deno.test("buildIndexOverlayData - only toggled-on indices become datasets, aligned to buckets", () => {
  const Trend = (globalThis as unknown as {
    GRQTrendSeries: { bucketStartDate: (d: Date, g: string) => Date };
  }).GRQTrendSeries;
  const indices: Record<string, PriceMap> = {
    sp500: { "2025-01-02": 100, "2025-03-15": 110 },
    nasdaq: { "2025-01-02": 100, "2025-03-15": 130 },
  };
  const result = Overlay.buildIndexOverlayData(
    ["2025-01-02"],
    indices,
    TODAY,
    "month",
    { nasdaq: true },
  );
  assertEquals(result.datasets.length, 1);
  const ds = result.datasets[0];
  assertEquals(ds.key, "nasdaq");
  assertEquals(ds.name, "NASDAQ");
  assertEquals(ds.points.length, 1);
  // Point lands on the shared month bucket-start date.
  assertEquals(
    ds.points[0].x.getTime(),
    Trend.bucketStartDate(new Date(2025, 0, 2), "month").getTime(),
  );
  assertAlmostEquals(ds.points[0].y, 30, 1e-9);
  // A distinct, non-null line colour is supplied for the legend.
  assertEquals(typeof ds.borderColor, "string");
});

Deno.test("buildIndexOverlayData - drops null buckets from an enabled line", () => {
  // nasdaq has no data in the window → its only bucket is null and is dropped,
  // leaving an empty (but present) dataset for the enabled index.
  const indices: Record<string, PriceMap> = {
    sp500: { "2025-01-02": 100, "2025-03-15": 110 },
  };
  const result = Overlay.buildIndexOverlayData(
    ["2025-01-02"],
    indices,
    TODAY,
    "month",
    { nasdaq: true },
  );
  assertEquals(result.datasets.length, 1);
  assertEquals(result.datasets[0].key, "nasdaq");
  assertEquals(result.datasets[0].points, []);
});
