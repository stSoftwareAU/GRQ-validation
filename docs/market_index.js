// Shared benchmark-index data extraction for the dashboard (issue #279, part of
// the theming/accessibility/formatting milestone #269, item F).
//
// The single-stock view (`index.html?stock=…`, `.stock-detail-view`) stopped
// showing the SP500 / NASDAQ / Russell 2000 index numbers: `updateMarket
// comparison()` only ran once after the initial asynchronous load, so switching
// to a stock left the figures stuck on their loading placeholder. The numbers
// must come ONLY from the already-loaded local data (`this.marketIndexData`,
// sourced same-origin from docs/market-indices.json) — never a live fetch — and
// a missing value renders blank rather than erroring.
//
// These PURE helpers are the single source of truth for that extraction, shared
// by the browser dashboard (docs/app.js) and the Deno tests so both compute the
// benchmark figures identically. Mirrors docs/escape.js, docs/projection.js,
// docs/color_key.js and docs/format.js: loaded as a classic <script> before
// app.js and published on `globalThis.GRQMarketIndex`.

// The benchmark indices rendered on both views, in display order. `key` matches
// the property on `this.marketIndexData`; `name` is the human label.
const BENCHMARK_INDICES = [
    { key: "sp500", name: "SP500" },
    { key: "nasdaq", name: "NASDAQ" },
    { key: "russell2000", name: "Russell 2000" },
];

// Normalise an arbitrary date-ish value to its local-midnight epoch time, or
// NaN when it cannot be parsed. Mirrors GRQProjection.setDateToMidnight so the
// "last close <= endDate" comparison ignores any time-of-day component, matching
// how buildIndexSeriesFromMap slices the series. Kept local so this kernel has
// no load-order dependency on docs/projection.js.
function toMidnightTime(value) {
    if (value === null || value === undefined) return NaN;
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    const time = date.getTime();
    if (Number.isNaN(time)) return NaN;
    date.setHours(0, 0, 0, 0);
    return date.getTime();
}

// Resolve an index's close as of a bounded window end (issue #366): the close
// of the latest point with `date <= endDate`. Accepts either a built series
// object ({ data: [{date, close}] }) or a bare {date, close} points array, and
// returns null when nothing qualifies — the series is empty/missing, the end
// date precedes all data, or the end date is unparseable. Pure: no DOM, no
// class state, never throws. This is the helper the #333 chart-vs-summary
// reconciliation needs so the summary can read an as-of price instead of always
// running to the latest available close.
function priceAsOf(seriesOrPoints, endDate) {
    const points = Array.isArray(seriesOrPoints)
        ? seriesOrPoints
        : (seriesOrPoints && Array.isArray(seriesOrPoints.data)
            ? seriesOrPoints.data
            : null);
    if (!points || points.length === 0) return null;

    const endTime = toMidnightTime(endDate);
    if (Number.isNaN(endTime)) return null;

    let bestTime = -Infinity;
    let bestClose = null;
    for (const point of points) {
        if (!point) continue;
        const close = point.close;
        if (typeof close !== "number" || !Number.isFinite(close)) continue;
        const time = toMidnightTime(point.date);
        if (Number.isNaN(time) || time > endTime) continue;
        if (time > bestTime) {
            bestTime = time;
            bestClose = close;
        }
    }
    return bestClose;
}

// Compute one benchmark index's performance from its processed series. Returns
// null when the required prices are missing, so callers render blank and never
// fetch live data. Pure: no DOM, no class state.
//
// When `endDate` is supplied the end price becomes window-aware (issue #366):
// the close of the last trading day at or before `endDate` (via priceAsOf over
// `indexData.data`) instead of the latest available close. `initialPrice`
// semantics are unchanged — it stays the score-date baseline. The formula is
// identical, so an `endDate` on the latest data date reproduces the full-period
// result. Omitting `endDate` keeps the original run-to-latest behaviour.
function indexPerformance(indexData, endDate) {
    if (!indexData || !indexData.initialPrice) {
        return null;
    }
    const endPrice = (endDate === undefined || endDate === null)
        ? indexData.currentPrice
        : priceAsOf(indexData.data, endDate);
    if (!endPrice) {
        return null;
    }
    const performance =
        ((endPrice - indexData.initialPrice) /
            indexData.initialPrice) * 100;
    return {
        performance,
        initialPrice: indexData.initialPrice,
        currentPrice: endPrice,
    };
}

// Aggregate the benchmark performance figures from the locally-loaded market
// index data (`this.marketIndexData`). Only indices with usable prices appear
// in the result; missing ones are simply absent (rendered blank by the caller).
// Accepts null/undefined and returns an empty object — never throws.
//
// When `endDate` is supplied the figures become window-aware (issue #367): each
// index's end price is the last close at or before `endDate`, so the summary
// covers the SAME per-device window the chart plots and the two can never
// disagree in direction. An index with no usable price in the window is omitted
// (rendered blank). Omitting `endDate` keeps the original run-to-latest result.
function marketPerformanceData(marketIndexData, endDate) {
    const result = {};
    if (marketIndexData) {
        for (const { key } of BENCHMARK_INDICES) {
            const perf = indexPerformance(marketIndexData[key], endDate);
            if (perf) {
                result[key] = perf;
            }
        }
    }
    return result;
}

// Publish on globalThis so the browser dashboard (GRQValidator) and the Deno
// test importer both reach the same helpers, mirroring docs/format.js.
globalThis.GRQMarketIndex = {
    BENCHMARK_INDICES,
    indexPerformance,
    priceAsOf,
    marketPerformanceData,
};
