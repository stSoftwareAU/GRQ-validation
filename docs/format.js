// Shared number-formatting helpers for the dashboard (issue #276, part of the
// theming/accessibility/formatting milestone #269, item B).
//
// Dashboard figures — market index levels, stock prices and performance
// percentages — were rendered with bare `toFixed()`/`Math.round()`, so large
// values like 4742.83 displayed without thousands separators and with
// inconsistent decimal places. These PURE helpers wrap `Intl.NumberFormat` to
// add grouping separators and consistent decimals while preserving the sign
// and any percent symbol.
//
// It mirrors docs/escape.js, docs/projection.js and docs/color_key.js: loaded
// as a classic <script> in docs/index.html (no module syntax) and imported by
// the Deno tests, so the browser dashboard and the tests exercise the exact
// same code. The helpers are published on `globalThis.GRQFormat`.

// Coerce a value to a finite number, or null when it cannot be one. Accepts
// numbers and non-empty numeric strings; rejects NaN/Infinity, null, undefined
// and non-numeric strings. Keeps the formatters defensive against the mixed
// data the dashboard interpolates.
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

// Format a number with thousands separators and a fixed number of decimals.
// `decimals` pins both the minimum and maximum fraction digits so output is
// consistent (e.g. 5 → "5.00"). Returns "N/A" for non-finite input so callers
// never show a broken figure. Pure: no DOM or class state.
function formatNumber(value, decimals = 2) {
    const number = toFiniteNumber(value);
    if (number === null) {
        return "N/A";
    }
    const places = Number.isFinite(decimals) && decimals >= 0
        ? Math.trunc(decimals)
        : 2;
    return new Intl.NumberFormat("en-US", {
        minimumFractionDigits: places,
        maximumFractionDigits: places,
    }).format(number);
}

// Format a market index level (e.g. 7500.42 → "7,500"). Index levels are large
// whole-number figures, so no decimals by default (issue #313); thousands
// separators still apply. Callers can pass an explicit decimals count.
function formatIndexLevel(value, decimals = 0) {
    return formatNumber(value, decimals);
}

// Format a percentage with an explicit sign and a trailing "%" (e.g.
// 12.5 → "+12.50%", -3.27 → "-3.27%", 0 → "+0.00%"). Negative values carry
// their own minus sign from the number itself. Returns "N/A" for non-finite
// input.
function formatPercent(value, decimals = 2) {
    const number = toFiniteNumber(value);
    if (number === null) {
        return "N/A";
    }
    const sign = number >= 0 ? "+" : "";
    return `${sign}${formatNumber(number, decimals)}%`;
}

// Choose the unit for a chart tooltip value from its series label (issue #425).
//
// The blue series was renamed from "Performance" to "Actual"; like "Target" it
// is a percentage (the chart's left axis is "Performance (%)"). Only genuine
// price series render as dollars. The Price branch excludes "Actual" so the
// renamed blue series is never misread as a dollar value — the old guard
// excluded "Performance". Plain `toFixed` (no sign, no grouping) preserves the
// exact tooltip text the dashboard shipped before the rename. Pure: no DOM.
function formatTooltipValue(label, value) {
    const text = typeof label === "string" ? label : "";
    const number = toFiniteNumber(value);
    if (number === null) {
        return `${text}: `;
    }
    if (text.includes("Price") && !text.includes("Actual")) {
        return `${text}: $${number.toFixed(2)}`;
    }
    // "Target", the renamed "Actual" series and everything else are percentages.
    return `${text}: ${number.toFixed(1)}%`;
}

// Publish on globalThis so classic-script callers (the browser dashboard via
// `GRQValidator`) and the Deno test importer both reach the same helpers,
// mirroring docs/escape.js and docs/projection.js.
globalThis.GRQFormat = {
    toFiniteNumber,
    formatNumber,
    formatIndexLevel,
    formatPercent,
    formatTooltipValue,
};
