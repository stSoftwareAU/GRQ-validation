// Shared low-volume / liquidity helper — the SINGLE source of truth for the
// dashboard's "is this name too illiquid to trade?" decision (issue #576,
// consumed by the exclusion sub-issue #577 and the valuation sub-issue #578).
//
// Ported from GRQ training's `volumeRecommend` (GRQ/src/CoreFeatures.ts) so the
// dashboard and the trainer agree on ONE definition — do not invent a new
// threshold. The only constant is `BUDGET_DOLLARS = 10000`
// (GRQ/src/LearnUtilTypes.ts).
//
// UNITS CAVEAT (critical correctness note): GRQ stores prices in CENTS and so
// divides dollar volume by 100 before comparing to BUDGET_DOLLARS. The
// dashboard CSVs store prices in DOLLARS (e.g. a close of 40.89), so here we
// compute dollar volume directly as `volume * lowPrice` (NO `/100`) and compare
// to BUDGET_DOLLARS = 10000 dollars. We reuse the DEFINITION, not the literal
// `/100`.
//
// Mirrors docs/projection.js and docs/format.js: loaded as a classic <script>
// in docs/index.html (no module syntax) and imported by the Deno tests, so the
// browser dashboard and the tests exercise the exact same code. The helpers are
// published on `globalThis.GRQVolume`.

// The single liquidity threshold, in DOLLARS (GRQ/src/LearnUtilTypes.ts:69).
const BUDGET_DOLLARS = 10000;

// GRQ's "last 10 weekdays" lookback. Daily market-data rows are already
// weekdays (markets trade Mon–Fri), so the trailing 10 trading rows on or
// before the as-of date are the "last 10 weekdays".
const WEEKDAY_WINDOW = 10;

// Coerce a value to a finite, strictly-positive number, or null otherwise.
// Accepts numbers and numeric strings; rejects NaN/Infinity, <= 0, null,
// undefined and non-numeric strings. Keeps the maths defensive against the
// mixed data the dashboard interpolates (blank/`not-a-number` volume cells).
function toFinitePositive(value) {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
}

// Average daily DOLLAR volume (mean of `volume * lowPrice`) over the window,
// or null when NO day in the window carries usable {volume, lowPrice}. The
// null result is the documented "insufficient data ⇒ not flagged" rule: older
// pre-volume-column CSVs lack volume, and those historical dates must not be
// mass-excluded. Days with missing/zero volume or price are skipped; a single
// present-but-tiny day still yields a (small) average so it can be flagged.
function averageDollarVolume(window) {
    if (!Array.isArray(window) || window.length === 0) {
        return null;
    }
    let sum = 0;
    let days = 0;
    for (const day of window) {
        if (!day) {
            continue;
        }
        const volume = toFinitePositive(day.volume);
        const lowPrice = toFinitePositive(day.lowPrice);
        if (volume === null || lowPrice === null) {
            continue;
        }
        sum += volume * lowPrice;
        days += 1;
    }
    return days === 0 ? null : sum / days;
}

// volumeRecommend(window): the ported GRQ definition over a trailing window of
// { volume, lowPrice } points. Returns:
//   - null  when volume is unknown across the WHOLE window (insufficient data,
//           NOT flagged — pre-volume-column CSVs land here);
//   - -1    when average dollar volume is below BUDGET_DOLLARS (never
//           recommend / flag as low-volume);
//   - else  min(marketPercentOfTrade, cap) in (0, 1], where
//           marketPercentOfTrade = 1 - BUDGET_DOLLARS / averagePV and the cap is
//           0.5 while marketPercentOfTrade < 0.99, otherwise 1.
function volumeRecommend(window) {
    const averagePV = averageDollarVolume(window);
    if (averagePV === null) {
        return null;
    }
    if (averagePV < BUDGET_DOLLARS) {
        return -1;
    }
    const marketPercentOfTrade = 1 - BUDGET_DOLLARS / averagePV;
    return marketPercentOfTrade < 0.99
        ? Math.min(marketPercentOfTrade, 0.5)
        : Math.min(marketPercentOfTrade, 1);
}

// Convenience: a name is low-volume when volumeRecommend is a real NEGATIVE
// number. Unknown volume (null) is explicitly NOT low-volume (insufficient
// data ⇒ not flagged), so callers never mass-exclude historical dates.
function isLowVolume(window) {
    const recommend = volumeRecommend(window);
    return typeof recommend === "number" && recommend < 0;
}

// Build a trailing WEEKDAY_WINDOW window of { volume, lowPrice } from a daily
// market-data series, ready for volumeRecommend/isLowVolume. `series` is the
// dashboard's per-ticker array of points; each point exposes a `date` (Date or
// parseable value), a low price (`lowPrice` or `low`) and `volume`. Points
// dated AFTER `asOfDate` are ignored, and the most recent `weekdays` of the
// remainder are returned oldest-first. Pure: no DOM, no class state.
function buildTrailingVolumeWindow(series, asOfDate, weekdays = WEEKDAY_WINDOW) {
    if (!Array.isArray(series)) {
        return [];
    }
    const cutoff = asOfDate instanceof Date
        ? asOfDate.getTime()
        : new Date(asOfDate).getTime();
    const usable = [];
    for (const point of series) {
        if (!point) {
            continue;
        }
        const time = point.date instanceof Date
            ? point.date.getTime()
            : new Date(point.date).getTime();
        if (!Number.isFinite(time)) {
            continue;
        }
        if (Number.isFinite(cutoff) && time > cutoff) {
            continue;
        }
        const lowPrice = point.lowPrice !== undefined
            ? point.lowPrice
            : point.low;
        usable.push({ time, lowPrice, volume: point.volume });
    }
    usable.sort((a, b) => a.time - b.time);
    return usable
        .slice(-weekdays)
        .map((point) => ({ volume: point.volume, lowPrice: point.lowPrice }));
}

globalThis.GRQVolume = {
    BUDGET_DOLLARS,
    WEEKDAY_WINDOW,
    toFinitePositive,
    averageDollarVolume,
    volumeRecommend,
    isLowVolume,
    buildTrailingVolumeWindow,
};
