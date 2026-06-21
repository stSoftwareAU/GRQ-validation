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

// Compute one benchmark index's performance from its processed series. Returns
// null when the required prices are missing, so callers render blank and never
// fetch live data. Pure: no DOM, no class state.
function indexPerformance(indexData) {
    if (!indexData || !indexData.initialPrice || !indexData.currentPrice) {
        return null;
    }
    const performance =
        ((indexData.currentPrice - indexData.initialPrice) /
            indexData.initialPrice) * 100;
    return {
        performance,
        initialPrice: indexData.initialPrice,
        currentPrice: indexData.currentPrice,
    };
}

// Aggregate the benchmark performance figures from the locally-loaded market
// index data (`this.marketIndexData`). Only indices with usable prices appear
// in the result; missing ones are simply absent (rendered blank by the caller).
// Accepts null/undefined and returns an empty object — never throws.
function marketPerformanceData(marketIndexData) {
    const result = {};
    if (marketIndexData) {
        for (const { key } of BENCHMARK_INDICES) {
            const perf = indexPerformance(marketIndexData[key]);
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
    marketPerformanceData,
};
