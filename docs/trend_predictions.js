// Headless prediction resolver for the "Portfolio Actual vs Target over time"
// Trend view (issue #430, milestone #422).
//
// The headless data engine (docs/trend_series.js) consumes predictions shaped
// as { date, stocks } where each stock is
// { buyPrice, currentPrice, totalDividends, adjustedTarget }. The engine
// deliberately stays DOM-free and leaves "load each score date's files and
// resolve those figures" to the Trend view. THIS module is that resolver: it
// parses a score date's raw files (the score TSV, the market-data CSV and the
// dividend CSV) and builds the per-stock inputs.
//
// Single source of truth (critical): every figure is produced by reusing the
// shared kernels already used by the per-prediction dashboard —
//   - buyPrice:       GRQProjection.getBuyPrice (5-day forward search + split
//                     adjustment),
//   - currentPrice:   the midpoint of the last market point within the 90-day
//                     window (exactly how GRQValidator.getStockReturnBreakdown
//                     derives the Actual figure the chart/summary show),
//   - totalDividends: GRQProjection.sumDividends over
//                     GRQProjection.filterDividendsWithin90Days,
//   - adjustedTarget: GRQProjection.adjustHistoricalPriceToCurrent (the model's
//                     target restated into current, post-split terms).
// No new actuals or target maths is added here, so the Trend view's Actual /
// Target equal the existing dashboard's for the same score date.
//
// Mirrors docs/projection.js and docs/trend_series.js: loaded as a classic
// <script>, no module syntax, published on globalThis.GRQTrendPredictions, and
// it depends on docs/projection.js being loaded first.

// The 90-day validation window, matching GRQValidator and the Trend engine.
const PREDICTION_WINDOW_DAYS = 90;

// Parse a "YYYY-MM-DD" score date (possibly with unpadded month/day) to local
// midnight, mirroring GRQTrendSeries' own parsing so the resolved score date
// lines up with the engine's bucketing and maturity checks.
function parseScoreDateString(value) {
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

// Parse a score TSV (the prediction file) into rows. Mirrors
// GRQValidator.loadScoreData's column layout so the Trend view reads the same
// fields the dashboard does. Skips the header line and any blank lines.
function parseScoreTsv(text) {
    const rows = [];
    if (typeof text !== "string") {
        return rows;
    }
    const lines = text.trim().split("\n");
    for (const line of lines.slice(1)) {
        if (!line.trim()) {
            continue;
        }
        const values = line.split("\t");
        rows.push({
            stock: values[0],
            score: parseFloat(values[1]),
            target: parseFloat(values[2]),
            exDividendDate: values[3] || null,
            dividendPerShare: values[4] ? parseFloat(values[4]) : 0,
            notes: values[5] || "",
            intrinsicValuePerShareBasic: values[6]
                ? parseFloat(values[6])
                : null,
            intrinsicValuePerShareAdjusted: values[7]
                ? parseFloat(values[7])
                : null,
        });
    }
    return rows;
}

// Parse a market-data CSV into a { ticker: [points] } map, mirroring
// GRQValidator.loadMarketData (dates snapped to local midnight). Each point is
// { date, high, low, open, close, splitCoefficient }. Points are returned in
// chronological order so "the last point within 90 days" is well-defined.
function parseMarketCsv(text) {
    const marketData = {};
    if (typeof text !== "string" || !text.trim()) {
        return marketData;
    }
    const lines = text.split("\n").filter((line) => line.trim());
    for (const line of lines.slice(1)) {
        const values = line.split(",");
        const ticker = values[1];
        if (!ticker) {
            continue;
        }
        if (!marketData[ticker]) {
            marketData[ticker] = [];
        }
        // Trailing volume column (issue #575): present only in 8-column CSVs.
        // Blank / non-numeric / absent -> null so the low-volume helper (#576)
        // treats it as "unknown" rather than zero.
        const volumeRaw = values[7];
        const volume = volumeRaw !== undefined && volumeRaw.trim() !== ""
            ? parseFloat(volumeRaw)
            : NaN;
        marketData[ticker].push({
            date: GRQProjection.setDateToMidnight(new Date(values[0])),
            high: parseFloat(values[2]),
            low: parseFloat(values[3]),
            open: parseFloat(values[4]),
            close: parseFloat(values[5]),
            splitCoefficient: parseFloat(values[6]),
            volume: Number.isFinite(volume) ? volume : null,
        });
    }
    for (const ticker of Object.keys(marketData)) {
        marketData[ticker].sort((a, b) => a.date.getTime() - b.date.getTime());
    }
    return marketData;
}

// Parse a dividend CSV into a { ticker: [{ exDivDate, amount }] } map, mirroring
// GRQValidator.loadDividendData (ex-dividend dates snapped to local midnight).
function parseDividendCsv(text) {
    const dividendData = {};
    if (typeof text !== "string" || !text.trim()) {
        return dividendData;
    }
    const lines = text.split("\n").filter((line) => line.trim());
    for (const line of lines.slice(1)) {
        const values = line.split(",");
        const ticker = values[1];
        if (!ticker) {
            continue;
        }
        if (!dividendData[ticker]) {
            dividendData[ticker] = [];
        }
        dividendData[ticker].push({
            exDivDate: GRQProjection.setDateToMidnight(new Date(values[0])),
            amount: parseFloat(values[2]),
        });
    }
    return dividendData;
}

// Tokenise CSV text into records (arrays of field strings), honouring
// double-quoted fields that may contain commas, embedded newlines and ""
// escapes (issue #656). A full record-level parse is required because the
// analysis CSV quotes currency columns that sit BEFORE the rating columns — a
// naive line/comma split would misalign `MS` / `Tips Stars` — and its header row
// spans several physical lines via multi-line quoted headings. Returns [] for
// empty / non-string input.
function parseCsvRecords(text) {
    const records = [];
    if (typeof text !== "string" || text === "") {
        return records;
    }
    let field = "";
    let record = [];
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (inQuotes) {
            if (char === '"') {
                if (text[i + 1] === '"') {
                    field += '"';
                    i++; // consume the escaped quote
                } else {
                    inQuotes = false;
                }
            } else {
                field += char;
            }
        } else if (char === '"') {
            inQuotes = true;
        } else if (char === ",") {
            record.push(field);
            field = "";
        } else if (char === "\n" || char === "\r") {
            if (char === "\r" && text[i + 1] === "\n") {
                i++; // treat CRLF as a single record terminator
            }
            record.push(field);
            field = "";
            records.push(record);
            record = [];
        } else {
            field += char;
        }
    }
    // Flush a trailing record that was not terminated by a newline.
    if (field !== "" || record.length > 0) {
        record.push(field);
        records.push(record);
    }
    return records;
}

// Parse a per-date analysis CSV (`scores/<YYYY>/<Month>/<DD>-analysis.csv`) into
// a { ticker: avgStars } map (issue #656). The combined 1–5 rating is produced by
// the shared GRQProjection.combineStarRating kernel — the SAME combination the
// portfolio view uses — so a stock's effective rating matches between the two
// views. Tolerates an empty / missing file (older dates may lack it, fetched as
// "" on a 404) and a CSV without the rating columns by returning {} / null, so
// the Trend filter simply treats those stocks as unrated.
function parseAnalysisCsv(text) {
    const ratings = {};
    const records = parseCsvRecords(text);
    if (records.length < 2) {
        return ratings;
    }
    const headers = records[0].map((h) => h.trim());
    const stockIndex = headers.indexOf("Stock");
    const msIndex = headers.indexOf("MS");
    const tipsStarsIndex = headers.indexOf("Tips Stars");
    if (stockIndex === -1) {
        return ratings;
    }
    for (let r = 1; r < records.length; r++) {
        const values = records[r];
        const ticker = values[stockIndex] ? values[stockIndex].trim() : "";
        if (!ticker) {
            continue;
        }
        const msRaw = msIndex !== -1 ? values[msIndex] : null;
        const tipsRaw = tipsStarsIndex !== -1 ? values[tipsStarsIndex] : null;
        const msStars = msRaw && msRaw.trim() !== "" ? parseFloat(msRaw) : null;
        const tipsStars = tipsRaw && tipsRaw.trim() !== ""
            ? parseFloat(tipsRaw)
            : null;
        ratings[ticker] = GRQProjection.combineStarRating(msStars, tipsStars);
    }
    return ratings;
}

// The midpoint of the last market point on or before the 90-day window end —
// the "current" price the dashboard's Actual figure uses
// (GRQValidator.getStockReturnBreakdown). Returns null when the stock has no
// usable point within the window, so the inclusion gate drops it.
//
// The midpoint is restated onto the CURRENT (end-of-series) split basis that
// getBuyPrice uses for the buy price (issue #569): when a reconcilable split
// falls between the horizon and the end of the data series, reading the horizon
// midpoint RAW while dividing by a current-basis buy price leaves a spurious
// post-horizon split factor in the Actual. Dividing by postHorizonSplitFactor
// puts both prices on the same basis.
function currentPriceWithinWindow(points, scoreDate) {
    if (!Array.isArray(points) || points.length === 0) {
        return null;
    }
    const windowEnd = new Date(
        scoreDate.getTime() + (PREDICTION_WINDOW_DAYS * 24 * 60 * 60 * 1000),
    );
    let last = null;
    for (const point of points) {
        if (point && point.date instanceof Date && point.date <= windowEnd) {
            last = point;
        }
    }
    if (!last) {
        return null;
    }
    const rawMid = (last.high + last.low) / 2;
    return rawMid / GRQProjection.postHorizonSplitFactor(points, scoreDate);
}

// Resolve the per-stock { buyPrice, currentPrice, totalDividends, adjustedTarget }
// inputs for one score date, delegating every figure to the shared kernels.
// `scoreRows` come from parseScoreTsv; `marketData` / `dividendData` from the
// matching CSV parsers; `scoreDate` is a local-midnight Date. Stocks with no
// usable price resolve to null buy/current prices, which the engine's inclusion
// gate (GRQProjection.isStockIncluded) drops — matching the dashboard's
// exclusion of unpriceable stocks.
function resolvePredictionStocks(
    scoreRows,
    marketData,
    dividendData,
    scoreDate,
    starRatings,
) {
    if (!Array.isArray(scoreRows)) {
        return [];
    }
    const market = marketData && typeof marketData === "object"
        ? marketData
        : {};
    const dividends = dividendData && typeof dividendData === "object"
        ? dividendData
        : {};
    const ratings = starRatings && typeof starRatings === "object"
        ? starRatings
        : {};
    return scoreRows.map((row) => {
        const points = market[row.stock];
        const buyPriceObj = GRQProjection.getBuyPrice(points, scoreDate);
        const buyPrice = buyPriceObj ? buyPriceObj.price : null;
        const splitReliable = buyPriceObj ? buyPriceObj.reliable !== false : true;
        const currentPrice = currentPriceWithinWindow(points, scoreDate);
        const totalDividends = GRQProjection.sumDividends(
            GRQProjection.filterDividendsWithin90Days(
                dividends[row.stock] || [],
                scoreDate,
            ),
        );
        const hasTarget = row.target !== null && !Number.isNaN(row.target);
        const adjustedTarget = hasTarget
            ? GRQProjection.adjustHistoricalPriceToCurrent(
                row.target,
                points,
                scoreDate,
            )
            : null;
        // Low-volume flag (issue #577) over a trailing 10-weekday window ending
        // at the score date, via the shared single-source-of-truth helper
        // (#576). Unknown volume ⇒ not flagged, so pre-volume-column history is
        // never mass-excluded from the trend aggregates.
        const lowVolume = GRQVolume.isLowVolume(
            GRQVolume.buildTrailingVolumeWindow(points, scoreDate),
        );
        // Combined 1–5 star rating for this date (issue #656): null when the
        // analysis CSV is absent or the ticker is unrated, so the optional
        // min-star filter excludes it when active.
        const avgStars = Object.prototype.hasOwnProperty.call(
                ratings,
                row.stock,
            )
            ? ratings[row.stock]
            : null;
        return {
            stock: row.stock,
            buyPrice,
            currentPrice,
            totalDividends,
            adjustedTarget,
            splitReliable,
            lowVolume,
            avgStars,
        };
    });
}

// Convenience composition for the Trend view loader: given a score date and the
// raw text of its three files, return the { date, stocks } prediction the data
// engine consumes. `date` is preserved verbatim so the engine re-parses it for
// maturity and bucketing exactly as it does for every other prediction.
function buildPrediction(
    date,
    tsvText,
    csvText,
    dividendCsvText,
    analysisCsvText,
) {
    const scoreDate = parseScoreDateString(date);
    const stocks = resolvePredictionStocks(
        parseScoreTsv(tsvText),
        parseMarketCsv(csvText),
        parseDividendCsv(dividendCsvText),
        scoreDate,
        parseAnalysisCsv(analysisCsvText),
    );
    return { date, stocks };
}

// Publish on globalThis so the browser dashboard and the Deno tests reach the
// same helpers, mirroring docs/projection.js and docs/trend_series.js.
globalThis.GRQTrendPredictions = {
    PREDICTION_WINDOW_DAYS,
    parseScoreDateString,
    parseScoreTsv,
    parseMarketCsv,
    parseDividendCsv,
    parseCsvRecords,
    parseAnalysisCsv,
    currentPriceWithinWindow,
    resolvePredictionStocks,
    buildPrediction,
};
