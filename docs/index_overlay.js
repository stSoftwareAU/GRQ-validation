// Headless benchmark-index overlay engine for the "Portfolio Actual vs Target
// over time" Trend view (issue #431, the stretch goal of milestone #422).
//
// This delivers ONLY the pure data pipeline + toggle-state model — no DOM, no
// chart, no UI control. The Trend view UI sub-issue (#430) owns the rendering,
// the on/off toggle widgets and the colour-key wiring; this module hands it
// chart-ready datasets so there is one place that decides what each index line
// contains. Persistence of the toggle choices is owned by the "remember
// choices" sub-issue (#432).
//
// No new index maths (the issue forbids it): each index's % return is produced
// by reusing the existing shared kernels —
// GRQProjection.buildIndexSeriesFromMap (slice the same-origin price map to a
// score date's 90-day window) feeding GRQMarketIndex.indexPerformance (the exact
// formula the existing dashboard plots). Buckets are aligned to the Trend
// engine's own GRQTrendSeries.bucketStartDate, so the index lines land on the
// SAME X buckets as the Actual / Target lines. Maturity reuses
// GRQTrendSeries.isMaturedScoreDate so only fully-elapsed 90-day windows plot,
// exactly as Actual / Target do.
//
// Mirrors docs/projection.js, docs/market_index.js and docs/trend_series.js:
// loaded as a classic <script>, no module syntax, and published on
// globalThis.GRQIndexOverlay. It depends on docs/projection.js,
// docs/market_index.js and docs/trend_series.js being loaded first.

// The 90-day validation window each matured prediction is scored over — the
// same horizon the Trend engine matures on and the Actual / Target lines cover.
const OVERLAY_WINDOW_DAYS = 90;

// The benchmark indices the overlay can draw, in display order. Key and name
// reuse GRQMarketIndex.BENCHMARK_INDICES (single source of truth for the index
// list) and each is augmented with the distinct line colours the existing
// dashboard already uses for that index, so the Trend view's colour key /
// legend matches the rest of the site. Falls back to a local list if
// market_index.js has not loaded (keeps this module's parse independent).
const INDEX_LINE_STYLES = {
    sp500: {
        borderColor: "rgba(255, 99, 132, 0.8)",
        backgroundColor: "rgba(255, 99, 132, 0.1)",
    },
    nasdaq: {
        borderColor: "rgba(54, 162, 235, 0.8)",
        backgroundColor: "rgba(54, 162, 235, 0.1)",
    },
    russell2000: {
        borderColor: "rgba(75, 192, 192, 0.8)",
        backgroundColor: "rgba(75, 192, 192, 0.1)",
    },
};

const BASE_INDICES =
    (globalThis.GRQMarketIndex && globalThis.GRQMarketIndex.BENCHMARK_INDICES) ||
    [
        { key: "sp500", name: "SP500" },
        { key: "nasdaq", name: "NASDAQ" },
        { key: "russell2000", name: "Russell 2000" },
    ];

const OVERLAY_INDICES = BASE_INDICES.map(({ key, name }) => ({
    key,
    name,
    borderColor: (INDEX_LINE_STYLES[key] || {}).borderColor || null,
    backgroundColor: (INDEX_LINE_STYLES[key] || {}).backgroundColor || null,
}));

// Default toggle state: every index OFF. The Trend view starts uncluttered
// with just Actual / Target; the user opts each benchmark in. (#431 asks the
// default to be documented — it is "all off".)
const DEFAULT_TOGGLES = OVERLAY_INDICES.reduce((acc, { key }) => {
    acc[key] = false;
    return acc;
}, {});

// Coerce an arbitrary (possibly partial or null) toggle object into a full
// { sp500, nasdaq, russell2000 } boolean map. Missing keys fall back to the
// all-off default; unknown keys are ignored. Pure: never mutates its input.
function normaliseToggles(toggles) {
    const source = toggles && typeof toggles === "object" ? toggles : {};
    const result = {};
    for (const { key } of OVERLAY_INDICES) {
        result[key] = key in source
            ? Boolean(source[key])
            : DEFAULT_TOGGLES[key];
    }
    return result;
}

// The keys of the indices that are toggled on, in display order.
function enabledIndexKeys(toggles) {
    const normalised = normaliseToggles(toggles);
    return OVERLAY_INDICES
        .map(({ key }) => key)
        .filter((key) => normalised[key]);
}

// The local-midnight date `windowDays` after `scoreDate` — the end of a
// prediction's validation window.
function windowEndDate(scoreDate, windowDays) {
    const end = GRQProjection.setDateToMidnight(new Date(scoreDate));
    end.setDate(end.getDate() + windowDays);
    return end;
}

// One benchmark index's % return from a score date's baseline over its
// `windowDays` window, reusing the shared kernels (no new maths). `priceMap` is
// the same-origin { "YYYY-MM-DD": close } map for the index (a property of
// docs/market-indices.json). Returns the percentage number, or null when the
// window has no usable prices. Pure: no DOM, never throws.
function indexReturnForScoreDate(
    priceMap,
    scoreDate,
    windowDays = OVERLAY_WINDOW_DAYS,
) {
    if (!priceMap || typeof priceMap !== "object") {
        return null;
    }
    const start = GRQProjection.setDateToMidnight(new Date(scoreDate));
    if (Number.isNaN(start.getTime())) {
        return null;
    }
    const end = windowEndDate(start, windowDays);
    const series = GRQProjection.buildIndexSeriesFromMap(
        priceMap,
        "",
        start,
        end,
    );
    const perf = GRQMarketIndex.indexPerformance(series, end);
    return perf ? perf.performance : null;
}

// Build the ordered, matured-only per-score-date index-return series.
//
// `scoreDates` is the list of prediction (score) dates the Trend view plots —
// strings ("YYYY-MM-DD") or Dates. `marketIndices` is the raw
// docs/market-indices.json object ({ sp500, nasdaq, russell2000 } each a
// { date: close } map). Only MATURED score dates (full 90-day window elapsed by
// `today`, via the shared GRQTrendSeries.isMaturedScoreDate) are included, so
// the overlay covers exactly the same dates as Actual / Target.
//
// Returns [{ date, returns: { sp500, nasdaq, russell2000 } }] ordered
// chronologically; `date` is a Date at local midnight and any index with no
// usable window prices is null.
function buildIndexOverlaySeries(scoreDates, marketIndices, today) {
    if (!Array.isArray(scoreDates)) {
        return [];
    }
    const indices = marketIndices && typeof marketIndices === "object"
        ? marketIndices
        : {};
    const series = [];
    for (const scoreDate of scoreDates) {
        if (scoreDate === null || scoreDate === undefined) {
            continue;
        }
        if (!GRQTrendSeries.isMaturedScoreDate(scoreDate, today)) {
            continue;
        }
        const date = GRQProjection.setDateToMidnight(new Date(scoreDate));
        if (Number.isNaN(date.getTime())) {
            continue;
        }
        const returns = {};
        for (const { key } of OVERLAY_INDICES) {
            returns[key] = indexReturnForScoreDate(indices[key], date);
        }
        series.push({ date, returns });
    }
    series.sort((a, b) => a.date.getTime() - b.date.getTime());
    return series;
}

// Aggregate the per-score-date overlay series into chronological buckets at
// `granularity`, aligned on the SAME bucket-start dates the Trend engine uses
// (GRQTrendSeries.bucketStartDate), so index lines share the Actual / Target X
// axis. Each bucket's per-index value is the MEAN of its members' non-null
// returns (null when no member had a usable value); `count` is the number of
// member score-date points. Returns
// [{ date, returns: { sp500, nasdaq, russell2000 }, count }] ordered by bucket
// start. An unrecognised granularity throws (matching aggregateTrendSeries).
function aggregateIndexOverlay(series, granularity = "month") {
    if (!GRQTrendSeries.GRANULARITIES.includes(granularity)) {
        throw new Error(`Unknown granularity: ${granularity}`);
    }
    if (!Array.isArray(series)) {
        return [];
    }
    const buckets = new Map();
    for (const point of series) {
        if (!point || !(point.date instanceof Date)) {
            continue;
        }
        const start = GRQTrendSeries.bucketStartDate(point.date, granularity);
        const key = start.getTime();
        let bucket = buckets.get(key);
        if (!bucket) {
            bucket = { date: start, sums: {}, counts: {}, count: 0 };
            for (const { key: indexKey } of OVERLAY_INDICES) {
                bucket.sums[indexKey] = 0;
                bucket.counts[indexKey] = 0;
            }
            buckets.set(key, bucket);
        }
        bucket.count++;
        const returns = point.returns || {};
        for (const { key: indexKey } of OVERLAY_INDICES) {
            const value = returns[indexKey];
            if (typeof value === "number" && Number.isFinite(value)) {
                bucket.sums[indexKey] += value;
                bucket.counts[indexKey]++;
            }
        }
    }
    return Array.from(buckets.values())
        .sort((a, b) => a.date.getTime() - b.date.getTime())
        .map((bucket) => {
            const returns = {};
            for (const { key: indexKey } of OVERLAY_INDICES) {
                returns[indexKey] = bucket.counts[indexKey] > 0
                    ? bucket.sums[indexKey] / bucket.counts[indexKey]
                    : null;
            }
            return { date: bucket.date, returns, count: bucket.count };
        });
}

// Convenience composition for the Trend view UI: build the matured overlay
// series, bucket it, and emit chart-ready datasets for only the toggled-on
// indices. Returns:
//   {
//     granularity,
//     toggles,                  // the normalised { sp500, nasdaq, russell2000 }
//     buckets,                  // all index buckets (every index, for the key)
//     datasets: [               // one per ENABLED index, in display order
//       { key, name, borderColor, backgroundColor,
//         points: [{ x: Date, y: pct }] }   // null buckets dropped per line
//     ],
//   }
// Because the buckets come from aggregateIndexOverlay (shared bucketStartDate),
// each dataset point's `x` lands on the same bucket the Actual / Target lines
// use. Flipping a toggle changes only which datasets appear, so the UI can call
// this again to update the chart live.
function buildIndexOverlayData(
    scoreDates,
    marketIndices,
    today,
    granularity = "month",
    toggles = DEFAULT_TOGGLES,
) {
    const series = buildIndexOverlaySeries(scoreDates, marketIndices, today);
    const buckets = aggregateIndexOverlay(series, granularity);
    const normalised = normaliseToggles(toggles);
    const datasets = OVERLAY_INDICES
        .filter(({ key }) => normalised[key])
        .map(({ key, name, borderColor, backgroundColor }) => ({
            key,
            name,
            borderColor,
            backgroundColor,
            points: buckets
                .filter((bucket) => bucket.returns[key] !== null)
                .map((bucket) => ({ x: bucket.date, y: bucket.returns[key] })),
        }));
    return { granularity, toggles: normalised, buckets, datasets };
}

// Publish on globalThis so the browser dashboard and the Deno tests reach the
// same helpers, mirroring docs/trend_series.js and docs/market_index.js.
globalThis.GRQIndexOverlay = {
    OVERLAY_WINDOW_DAYS,
    OVERLAY_INDICES,
    DEFAULT_TOGGLES,
    normaliseToggles,
    enabledIndexKeys,
    indexReturnForScoreDate,
    buildIndexOverlaySeries,
    aggregateIndexOverlay,
    buildIndexOverlayData,
};
