// Headless trend-data engine for the "Portfolio Actual vs Target over time"
// view (issue #429, part of milestone #422). This delivers ONLY the pure data
// pipeline — no DOM, no chart, no UI control. The Trend view UI sub-issue owns
// the rendering and the default granularity control.
//
// The engine turns the loaded predictions into an ordered, matured-only time
// series of { date, actualPct, targetPct, count } points and aggregates them
// into day / week / month / quarter buckets (mean per bucket).
//
// Single source of truth (critical): the Actual % is computed by delegating to
// GRQProjection.calculateIncludedPortfolioPerformance (which itself calls
// calculatePerformanceReturn), and the Target % by delegating to
// GRQProjection.calculatePortfolioTargetPercentage. This module adds NO new
// actuals or target maths and never reads the backend-generated
// performance_90_day field. It mirrors docs/projection.js and
// docs/market_index.js: loaded as a classic <script>, no module syntax, and
// publishes its helpers on globalThis.GRQTrendSeries. It depends on
// docs/projection.js being loaded first (for the shared kernels).

// Maturity window: a score date is "matured" once its full 90-day validation
// window has elapsed, i.e. scoreDate <= today - 90 days. Reuses the exact
// "on or before today - 90 days" boundary the dashboard's default-score
// selection applies (GRQProjection.selectDefaultScore), so the trend view and
// the chart agree on which dates are complete.
const MATURITY_WINDOW_DAYS = 90;

// The granularities the engine can bucket by. Order is irrelevant; membership
// is what the validation checks.
const GRANULARITIES = ["day", "week", "month", "quarter"];

// Parse a score date (a "YYYY-MM-DD" string — possibly with unpadded month/day
// such as "2024-12-3" — or a Date) to local midnight. Returns a Date, or an
// Invalid Date when it cannot be parsed. Using local midnight (not UTC) keeps
// the "on or before" calendar comparison and the bucket boundaries aligned with
// the rest of the dashboard's date maths.
function parseScoreDate(value) {
    if (value instanceof Date) {
        return GRQProjection.setDateToMidnight(value);
    }
    const match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(value));
    if (match) {
        return new Date(
            Number(match[1]),
            Number(match[2]) - 1,
            Number(match[3]),
        );
    }
    return GRQProjection.setDateToMidnight(new Date(value));
}

// Whether a score date's full 90-day window has elapsed by `today`. Pure given
// the two dates: matured when the local-midnight score date is on or before
// (today - 90 days) at local midnight.
function isMaturedScoreDate(scoreDate, today) {
    const score = parseScoreDate(scoreDate);
    if (Number.isNaN(score.getTime())) {
        return false;
    }
    const cutoff = GRQProjection.setDateToMidnight(today);
    cutoff.setDate(cutoff.getDate() - MATURITY_WINDOW_DAYS);
    return score.getTime() <= cutoff.getTime();
}

// Number of stocks that count towards the portfolio figures for a prediction
// (the included-stock count surfaced on each series point). Delegates to the
// shared inclusion predicate so it matches the Actual/Target averages exactly.
function includedStockCount(stocks) {
    if (!Array.isArray(stocks)) {
        return 0;
    }
    let count = 0;
    for (const stock of stocks) {
        const buyPrice = stock && stock.buyPrice;
        const currentPrice = stock && stock.currentPrice;
        const splitReliable = stock && stock.splitReliable;
        const lowVolume = stock && stock.lowVolume;
        if (
            GRQProjection.isStockIncluded(
                buyPrice,
                currentPrice,
                splitReliable,
                lowVolume,
            )
        ) {
            count++;
        }
    }
    return count;
}

// Build the ordered, matured-only Actual-vs-Target time series.
//
// `predictions` is an array of { date, stocks } where `date` is the score date
// and `stocks` is an array of resolved per-stock figures
// { buyPrice, currentPrice, totalDividends, adjustedTarget }. The Trend view UI
// sub-issue is responsible for loading each score date's market data and
// resolving those figures; this engine stays DOM-free and deterministic.
//
// For each MATURED prediction it produces one point:
//   - actualPct: GRQProjection.calculateIncludedPortfolioPerformance(stocks)
//   - targetPct: GRQProjection.calculatePortfolioTargetPercentage(stocks)
//   - count:     number of included stocks behind those averages
// Predictions that are not yet matured, or whose Actual % is null (no included
// stocks), are excluded. Points are returned ordered chronologically by date.
// `date` on each point is a Date at local midnight.
function buildMaturedTrendSeries(predictions, today) {
    if (!Array.isArray(predictions)) {
        return [];
    }
    const series = [];
    for (const prediction of predictions) {
        if (!prediction) {
            continue;
        }
        if (!isMaturedScoreDate(prediction.date, today)) {
            continue;
        }
        const stocks = prediction.stocks;
        const actualPct = GRQProjection.calculateIncludedPortfolioPerformance(
            stocks,
        );
        if (actualPct === null) {
            // No included stocks: there is no portfolio Actual for this date.
            continue;
        }
        const targetPct = GRQProjection.calculatePortfolioTargetPercentage(
            stocks,
        );
        series.push({
            date: parseScoreDate(prediction.date),
            actualPct,
            targetPct,
            count: includedStockCount(stocks),
        });
    }
    series.sort((a, b) => a.date.getTime() - b.date.getTime());
    return series;
}

// The Monday (local midnight) that starts the ISO week containing `date`.
function startOfIsoWeek(date) {
    const d = GRQProjection.setDateToMidnight(date);
    const day = d.getDay(); // 0 = Sunday .. 6 = Saturday
    const shift = day === 0 ? -6 : 1 - day; // back to Monday
    d.setDate(d.getDate() + shift);
    return d;
}

// The representative bucket-start date (local midnight) for `date` at the given
// granularity:
//   - day:     the date itself
//   - week:    the Monday of its ISO week
//   - month:   the first of its month
//   - quarter: the first day of its calendar quarter (Jan/Apr/Jul/Oct)
// Buckets are keyed by this date's time, so all members of a bucket share one
// representative date that the UI can label.
function bucketStartDate(date, granularity) {
    const d = GRQProjection.setDateToMidnight(date);
    switch (granularity) {
        case "day":
            return d;
        case "week":
            return startOfIsoWeek(d);
        case "month":
            return new Date(d.getFullYear(), d.getMonth(), 1);
        case "quarter": {
            const quarterFirstMonth = Math.floor(d.getMonth() / 3) * 3;
            return new Date(d.getFullYear(), quarterFirstMonth, 1);
        }
        default:
            throw new Error(`Unknown granularity: ${granularity}`);
    }
}

// Aggregate a matured trend series into chronological buckets at `granularity`
// (default "month"; the UI owns the user-facing default). Each bucket's
// actualPct / targetPct is the MEAN of its members' values; `count` is the
// number of member score-date points in the bucket. Returns
// [{ date, actualPct, targetPct, count }] ordered by bucket start date. An
// unrecognised granularity throws so callers fail fast.
function aggregateTrendSeries(series, granularity = "month") {
    if (!GRANULARITIES.includes(granularity)) {
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
        const start = bucketStartDate(point.date, granularity);
        const key = start.getTime();
        let bucket = buckets.get(key);
        if (!bucket) {
            bucket = { date: start, actualSum: 0, targetSum: 0, count: 0 };
            buckets.set(key, bucket);
        }
        bucket.actualSum += point.actualPct;
        bucket.targetSum += point.targetPct;
        bucket.count++;
    }
    return Array.from(buckets.values())
        .sort((a, b) => a.date.getTime() - b.date.getTime())
        .map((bucket) => ({
            date: bucket.date,
            actualPct: bucket.actualSum / bucket.count,
            targetPct: bucket.targetSum / bucket.count,
            count: bucket.count,
        }));
}

// Convenience composition for the Trend view: build the matured series and its
// bucketed aggregation in one call. Returns { granularity, series, buckets }.
function buildTrendData(predictions, today, granularity = "month") {
    const series = buildMaturedTrendSeries(predictions, today);
    return {
        granularity,
        series,
        buckets: aggregateTrendSeries(series, granularity),
    };
}

// Publish on globalThis so the browser dashboard and the Deno tests reach the
// same helpers, mirroring docs/projection.js and docs/market_index.js.
globalThis.GRQTrendSeries = {
    GRANULARITIES,
    isMaturedScoreDate,
    buildMaturedTrendSeries,
    bucketStartDate,
    aggregateTrendSeries,
    buildTrendData,
};
