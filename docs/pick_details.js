// Shared stock-pick metrics helper (issue #836, sub-issue of #835) — the
// SINGLE source of truth for the per-stock details the user reads off their
// spreadsheet when picking manually: tradeable "lots", earnings yield, 5-day
// return, position within the 52-week range, and the 🔴/🟠/🟢 traffic light
// (with warning emojis) derived from all of them.
//
// The thresholds below are the user's own, adopted verbatim from the
// spreadsheet formula. They live here as named constants so they stay tunable
// in ONE place and no consumer (table columns, popovers, accessible text) ever
// hard-codes a number.
//
// This module owns the maths only — no DOM, no fetching, no parsing. Dollar
// ADV stays owned by docs/volume_recommend.js (`averageDollarVolume`, the #576
// single source of truth); this module takes an already-computed ADV as input
// and never re-derives it.
//
// Mirrors docs/volume_recommend.js and docs/format.js: a classic <script> (no
// module syntax) publishing its helpers on `globalThis.GRQPickDetails`, so the
// browser dashboard and the Deno tests exercise the exact same code.

// The user buys a $20k parcel per stock, so `lots = ADV / PARCEL_DOLLARS` is
// how many such parcels trade on an average day.
const PARCEL_DOLLARS = 20000;

// Liquidity floors, in lots per day: below 50 lots (~$1M ADV) is a major
// warning, below 200 lots (~$4M ADV) a minor one.
const MIN_RED_LOTS = 50;
const MIN_AMBER_LOTS = 200;

// Position within the 52-week range: at/above HIGH_CUT is "at the high",
// at/below LOW_CUT is "at the low".
const HIGH_CUT = 0.85;
const LOW_CUT = 0.15;

// A 5-day return at or below -10% is a big drop.
const DROP_CUT = -0.10;

// Earnings yield: below EY_WEAK_CUT is weak (a major warning), at or above
// EY_STRONG_CUT is strong (and excuses being at the high or the low).
const EY_WEAK_CUT = 0.02;
const EY_STRONG_CUT = 0.06;

// A price below $1 is delist risk.
const DELIST_PRICE = 1;

// The warning vocabulary, in the order the spreadsheet renders it. Exposed as
// structured data so a table cell and the accessible text can be rendered
// independently — callers must never re-invent the emoji or the wording.
// Frozen so a consumer cannot mutate the shared entries it renders.
const WARNINGS = Object.freeze({
    DELIST: { emoji: "🚫", label: "Delisting risk: price below $1" },
    POOR_LIQUIDITY: {
        emoji: "🫗",
        label: "Poor liquidity: under 50 parcels traded per day",
    },
    THIN_LIQUIDITY: {
        emoji: "🥃",
        label: "Thin liquidity: under 200 parcels traded per day",
    },
    AT_HIGH: { emoji: "📈", label: "Near the 52-week high" },
    AT_LOW: { emoji: "📉", label: "Near the 52-week low" },
    BIG_DROP: { emoji: "🪃", label: "Fell 10% or more over the last 5 days" },
    NEGATIVE_EY: { emoji: "🔥", label: "Negative earnings yield (loss making)" },
    WEAK_EY: { emoji: "🩸", label: "Weak earnings yield (under 2%)" },
    STRONG_EY: { emoji: "💰", label: "Strong earnings yield (6% or better)" },
});
Object.values(WARNINGS).forEach(Object.freeze);

// Coerce a value to a finite number, or null when it cannot be one. Accepts
// numbers and non-empty numeric strings; rejects NaN/Infinity, blanks and
// non-numeric text, so the mixed data the dashboard interpolates (blank and
// `not-a-number` cells) yields null rather than NaN. Mirrors the
// `toFinitePositive` defensiveness in docs/volume_recommend.js.
function toFiniteNumber(value) {
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : null;
    }
    if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

// How many $20k parcels trade on an average day. Returns null for unusable or
// negative ADV; a genuine zero ADV (the name did not trade) is real data and
// yields zero lots.
function lotsFromAdv(advDollars) {
    const adv = toFiniteNumber(advDollars);
    if (adv === null || adv < 0) {
        return null;
    }
    return adv / PARCEL_DOLLARS;
}

// Earnings yield: EPS over price. Deliberately NOT clamped to positive — a
// negative EPS gives a negative yield, which the traffic light reports as 🔥.
// Returns null unless the price is a usable positive number.
function earningsYield(eps, price) {
    const earnings = toFiniteNumber(eps);
    const priceNow = toFiniteNumber(price);
    if (earnings === null || priceNow === null || priceNow <= 0) {
        return null;
    }
    return earnings / priceNow;
}

// Return over the last five sessions, as a fraction (-0.10 is -10%). Returns
// null unless the prior close is a usable positive number.
function fiveDayReturn(closeNow, closeFivePrior) {
    const now = toFiniteNumber(closeNow);
    const prior = toFiniteNumber(closeFivePrior);
    if (now === null || prior === null || prior <= 0) {
        return null;
    }
    return now / prior - 1;
}

// Where the price sits in the 52-week range: 0 at the low, 1 at the high. A
// zero-width (or inverted) range carries no meaningful position, so it returns
// null rather than dividing by zero. Not clamped: a price outside the recorded
// range reports a value outside [0, 1].
function fiftyTwoWeekPosition(price, low52, high52) {
    const priceNow = toFiniteNumber(price);
    const low = toFiniteNumber(low52);
    const high = toFiniteNumber(high52);
    if (priceNow === null || low === null || high === null || high <= low) {
        return null;
    }
    return (priceNow - low) / (high - low);
}

// The user's traffic-light formula, applied to already-computed metrics.
//
// Input: { price, adv, lots, position, fiveDayReturn, earningsYield }. `lots`
// wins when supplied; otherwise it is derived from `adv`. Every field is
// optional and any unusable value is simply unknown — an unknown value never
// fabricates a warning and never turns a light red.
//
// Output: { light, warnings, majorWarn, minorWarn } where `warnings` is the
// ordered list of { emoji, label } entries.
//   - major (🔴): price below $1, fewer than 50 lots, or a weak earnings yield;
//   - minor (🟠): a 5-day drop of 10% or more, 50–200 lots, or sitting at the
//     52-week high/low without a strong earnings yield;
//   - otherwise 🟢.
//
// 📈/📉 are reported whenever the price sits at the extreme of its range, even
// when a strong earnings yield stops it tripping the light — the reviewer still
// wants to see where the price sits.
function pickTrafficLight(metrics) {
    const input = metrics && typeof metrics === "object" ? metrics : {};
    const price = toFiniteNumber(input.price);
    const explicitLots = toFiniteNumber(input.lots);
    // An explicit lots value wins; otherwise derive it from the supplied ADV.
    const lots = explicitLots !== null && explicitLots >= 0
        ? explicitLots
        : lotsFromAdv(input.adv);
    const position = toFiniteNumber(input.position);
    const change = toFiniteNumber(input.fiveDayReturn);
    const ey = toFiniteNumber(input.earningsYield);

    const strongEy = ey !== null && ey >= EY_STRONG_CUT;
    const delist = price !== null && price < DELIST_PRICE;
    const poorLiquidity = lots !== null && lots < MIN_RED_LOTS;
    const thinLiquidity = lots !== null && lots >= MIN_RED_LOTS &&
        lots < MIN_AMBER_LOTS;
    const atHigh = position !== null && position >= HIGH_CUT;
    const atLow = position !== null && position <= LOW_CUT;
    const bigDrop = change !== null && change <= DROP_CUT;
    const weakEy = ey !== null && ey < EY_WEAK_CUT;

    const warnings = [];
    if (delist) {
        warnings.push(WARNINGS.DELIST);
    }
    if (poorLiquidity) {
        warnings.push(WARNINGS.POOR_LIQUIDITY);
    }
    if (thinLiquidity) {
        warnings.push(WARNINGS.THIN_LIQUIDITY);
    }
    if (atHigh) {
        warnings.push(WARNINGS.AT_HIGH);
    }
    if (atLow) {
        warnings.push(WARNINGS.AT_LOW);
    }
    if (bigDrop) {
        warnings.push(WARNINGS.BIG_DROP);
    }
    if (weakEy && ey < 0) {
        warnings.push(WARNINGS.NEGATIVE_EY);
    }
    if (weakEy && ey >= 0) {
        warnings.push(WARNINGS.WEAK_EY);
    }
    if (strongEy) {
        warnings.push(WARNINGS.STRONG_EY);
    }

    const majorWarn = delist || poorLiquidity || weakEy;
    const minorWarn = bigDrop || thinLiquidity ||
        (atHigh && !strongEy) || (atLow && !strongEy);
    const light = majorWarn ? "🔴" : (minorWarn ? "🟠" : "🟢");

    return { light, warnings, majorWarn, minorWarn };
}

// Compact magnitude formatting, mirroring the spreadsheet's fmtMoney/fmtCount:
// two decimals with a k/M/B/T suffix, whole units below 1000, and "" for a
// non-number (the spreadsheet's blank cell). The sign leads, so a negative
// dollar figure reads "-$1.23M".
function formatCompact(value, prefix) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return "";
    }
    const sign = value < 0 ? "-" : "";
    const magnitude = Math.abs(value);
    const head = `${sign}${prefix}`;
    if (magnitude >= 1e12) {
        return `${head}${(magnitude / 1e12).toFixed(2)}T`;
    }
    if (magnitude >= 1e9) {
        return `${head}${(magnitude / 1e9).toFixed(2)}B`;
    }
    if (magnitude >= 1e6) {
        return `${head}${(magnitude / 1e6).toFixed(2)}M`;
    }
    if (magnitude >= 1e3) {
        return `${head}${(magnitude / 1e3).toFixed(2)}k`;
    }
    return `${head}${Math.round(magnitude)}`;
}

// "$1.23M" / "$4.56k" / "$999"; "" for a non-number.
function formatCompactMoney(value) {
    return formatCompact(value, "$");
}

// "1.23M" / "4.56k" / "999"; "" for a non-number.
function formatCompactCount(value) {
    return formatCompact(value, "");
}

// Publish on globalThis so classic-script callers (the browser dashboard) and
// the Deno test importer both reach the same helpers, mirroring
// docs/volume_recommend.js and docs/format.js.
globalThis.GRQPickDetails = {
    PARCEL_DOLLARS,
    MIN_RED_LOTS,
    MIN_AMBER_LOTS,
    HIGH_CUT,
    LOW_CUT,
    DROP_CUT,
    EY_WEAK_CUT,
    EY_STRONG_CUT,
    DELIST_PRICE,
    WARNINGS,
    toFiniteNumber,
    lotsFromAdv,
    earningsYield,
    fiveDayReturn,
    fiftyTwoWeekPosition,
    pickTrafficLight,
    formatCompactMoney,
    formatCompactCount,
};
