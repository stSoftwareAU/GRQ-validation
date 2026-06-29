// Wiring guards for the Trend view (issue #430, milestone #422).
//
// The Trend view is a separate page (docs/trend.html) that must be reachable
// from the existing dashboard, precached for offline/installed use, and built
// only from the shared modules. These tests pin that wiring against the real
// shipped files so a future edit cannot silently drop it.
import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import "../docs/projection.js";
import "../docs/volume_recommend.js";
import "../docs/trend_series.js";
import "../docs/trend_predictions.js";

const trendHtml = await Deno.readTextFile("docs/trend.html");
const indexHtml = await Deno.readTextFile("docs/index.html");
const sw = await Deno.readTextFile("docs/sw.js");

interface PipelineStock {
  buyPrice: number | null;
  currentPrice: number | null;
  avgStars?: number | null;
}
const pipeline = globalThis as unknown as {
  GRQTrendPredictions: {
    buildPrediction: (
      date: string,
      tsv: string,
      csv: string,
      dividends: string,
      analysis?: string,
    ) => { date: string; stocks: PipelineStock[] };
  };
  GRQTrendSeries: {
    buildMaturedTrendSeries: (
      predictions: { date: string; stocks: PipelineStock[] }[],
      today: Date,
      minStars?: number,
    ) => { actualPct: number; targetPct: number; count: number }[];
  };
};

Deno.test("index.html links to the Trend view (navigation in)", () => {
  assert(
    indexHtml.includes('href="trend.html"'),
    "the dashboard must offer a link to trend.html",
  );
});

Deno.test("trend.html links back to the dashboard (navigation out)", () => {
  assert(
    trendHtml.includes('href="index.html"'),
    "the Trend view must offer a link back to index.html",
  );
});

Deno.test("trend.html loads the shared star-filter settings before the controller", () => {
  // The Trend pipeline reads the shared threshold via GRQStarFilter, so its
  // settings module must load before trend.js (issue #656).
  const settingsIdx = trendHtml.indexOf('src="star_filter_settings.js"');
  const trendIdx = trendHtml.indexOf('src="trend.js"');
  assert(settingsIdx !== -1, "trend.html must load star_filter_settings.js");
  assert(
    settingsIdx < trendIdx,
    "star_filter_settings.js must load before trend.js",
  );
});

Deno.test("trend.html loads the shared engines and the controller", () => {
  for (
    const src of [
      "projection.js",
      "format.js",
      "market_index.js",
      "trend_series.js",
      "index_overlay.js",
      "trend_settings.js",
      "trend_indices_deeplink.js",
      "trend_predictions.js",
      "trend.js",
    ]
  ) {
    assert(
      trendHtml.includes(`src="${src}"`),
      `trend.html must load ${src}`,
    );
  }
});

Deno.test("trend.html exposes the grouping control and chart canvas", () => {
  assert(trendHtml.includes('id="groupingSelect"'), "grouping select missing");
  assert(trendHtml.includes('id="trendChart"'), "trend chart canvas missing");
  assert(trendHtml.includes('id="trendEmpty"'), "empty-state element missing");
  // Default grouping is month — the select offers all four granularities.
  for (const value of ["day", "week", "month", "quarter"]) {
    assert(
      trendHtml.includes(`value="${value}"`),
      `grouping option ${value} missing`,
    );
  }
});

Deno.test("sw.js precaches the Trend view assets", () => {
  for (
    const asset of [
      "./trend.html",
      "./trend.js",
      "./trend_predictions.js",
      "./trend_series.js",
      "./index_overlay.js",
      "./trend_settings.js",
      "./trend_indices_deeplink.js",
    ]
  ) {
    assert(
      sw.includes(`"${asset}"`),
      `sw.js STATIC_ASSETS must precache ${asset}`,
    );
  }
});

Deno.test("trend.html app-version aligns with sw.js APP_VERSION", () => {
  const appVersion = sw.match(/const APP_VERSION = "([^"]+)";/)?.[1];
  const trendMeta = trendHtml.match(
    /<meta name="app-version" content="([^"]+)">/,
  )?.[1];
  assertEquals(
    trendMeta,
    appVersion,
    "trend.html app-version meta must match sw.js APP_VERSION",
  );
});

// --- Filter off ⇒ unchanged end-to-end (issue #656) ------------------------
//
// The strongest acceptance check: run the REAL pipeline (buildPrediction →
// buildMaturedTrendSeries) and confirm that, with the filter off (0), attaching
// star ratings — or having no analysis CSV at all — produces the byte-for-byte
// same series as before the filter existed.
const WIRE_TSV = [
  "Stock\tScore\tTarget\tExDividendDate\tDividendPerShare\tNotes",
  "NYSE:AAA\t0.9\t120\t\t\t",
  "NYSE:BBB\t0.8\t180\t\t\t",
].join("\n");
const WIRE_CSV = [
  "date,ticker,high,low,open,close,split_coefficient",
  "2024-10-15,NYSE:AAA,102,98,100,100,1.0",
  "2025-01-10,NYSE:AAA,112,108,110,110,1.0",
  "2024-10-15,NYSE:BBB,101,99,100,100,1.0",
  "2025-01-10,NYSE:BBB,91,89,90,90,1.0",
].join("\n");
// AAA 4★, BBB 1★ — enough to change the means once a threshold is applied.
const WIRE_ANALYSIS = [
  "Stock,Date,MS Fair Value,MS,Tips Target,Tips Stars",
  'NYSE:AAA,2024-10-14,"1,200.00",4,"1,500.00",8',
  'NYSE:BBB,2024-10-14,"90.00",1,"110.00",',
].join("\n");
const WIRE_TODAY = new Date(2025, 5, 1);

Deno.test("filter off - analysis CSV does not change the series (vs no CSV)", () => {
  const withAnalysis = pipeline.GRQTrendPredictions.buildPrediction(
    "2024-10-15",
    WIRE_TSV,
    WIRE_CSV,
    "",
    WIRE_ANALYSIS,
  );
  const withoutAnalysis = pipeline.GRQTrendPredictions.buildPrediction(
    "2024-10-15",
    WIRE_TSV,
    WIRE_CSV,
    "",
  );
  const off = pipeline.GRQTrendSeries.buildMaturedTrendSeries(
    [withAnalysis],
    WIRE_TODAY,
    0,
  );
  const baseline = pipeline.GRQTrendSeries.buildMaturedTrendSeries(
    [withoutAnalysis],
    WIRE_TODAY,
    0,
  );
  // Identical Actual/Target/count: the off filter is a true no-op, and a date
  // lacking an analysis CSV behaves exactly as a date with one.
  assertAlmostEquals(off[0].actualPct, baseline[0].actualPct);
  assertAlmostEquals(off[0].targetPct, baseline[0].targetPct);
  assertEquals(off[0].count, baseline[0].count);
  // Actual mean(10, -10) = 0; Target mean(20, 80) = 50; both stocks counted.
  assertAlmostEquals(off[0].actualPct, 0);
  assertAlmostEquals(off[0].targetPct, 50);
  assertEquals(off[0].count, 2);
});

Deno.test("filter on - the same loaded predictions recompute over the subset", () => {
  const prediction = pipeline.GRQTrendPredictions.buildPrediction(
    "2024-10-15",
    WIRE_TSV,
    WIRE_CSV,
    "",
    WIRE_ANALYSIS,
  );
  // A 3★ floor keeps only AAA (4★): Actual 10, Target 20, count 1 — no re-fetch
  // needed, just the in-memory threshold.
  const filtered = pipeline.GRQTrendSeries.buildMaturedTrendSeries(
    [prediction],
    WIRE_TODAY,
    3,
  );
  assertAlmostEquals(filtered[0].actualPct, 10);
  assertAlmostEquals(filtered[0].targetPct, 20);
  assertEquals(filtered[0].count, 1);
});
