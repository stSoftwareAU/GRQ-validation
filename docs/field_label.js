// Human-readable labels for the "show the working" popover field id (issue #542).
//
// Each clickable dashboard value carries an internal `data-field` id (e.g.
// "current-price"). The working popover used to print that RAW id in its header
// — `Field: current-price` — which is wrong/misleading: the dashboard
// deliberately labels that figure "90-Day Actual" (issue #683, formerly
// "90-Day Price" per #539), NOT "Current Price", so it can never be mistaken
// for a live quote. This module maps each field id to the SAME display label
// the column headers and popover titles use, so the working header reads
// `Field: 90-Day Actual`.
//
// Like docs/color_key.js and docs/series_label_colour.js this is a PURE classic
// script: no module syntax, helpers published on `globalThis`, so the browser
// dashboard (via app.js) and the Deno tests exercise the exact same code.

// Field id -> display label. Labels mirror the column headers / popover titles
// in docs/index.html and docs/app.js. The displayed price figure is the
// "90-Day Actual" (issue #683, formerly "90-Day Price" per #539), never
// "Current Price".
const FIELD_LABELS = {
    "buy-price": "Buy Price",
    "target": "90-Day Target",
    "target-percentage": "Target Percentage",
    "current-price": "90-Day Actual",
    "gain-loss": "Gain/Loss",
    "progress-vs-cost": "Return above Cost of Capital",
    "judgement": "Judgement",
    "status-projection": "Status/Projection",
    "intrinsic-basic": "Intrinsic Value (Basic)",
    "intrinsic-adjusted": "Intrinsic Value (Adjusted)",
    "avg-dividend": "Average Dividend (90-day)",
    "total-dividend": "Total Dividends (90-day)",
    "dividend-info": "Dividend Info",
    "stars": "Stars",
    "fair-value-range": "Fair Value Range",
    "portfolio-target": "Portfolio Target",
    "portfolio-actual": "Actual",
    "portfolio-dividends": "Dividends",
    "portfolio-return-above-cost-of-capital":
        "Portfolio Return above Cost of Capital",
};

// Friendly display label for a field id. Unknown ids fall back to the raw id so
// nothing silently disappears; empty/missing input yields "".
function fieldLabel(field) {
    if (typeof field !== "string" || field === "") return "";
    return Object.prototype.hasOwnProperty.call(FIELD_LABELS, field)
        ? FIELD_LABELS[field]
        : field;
}

// Build the popover working header, using the friendly field label so the
// header never leaks the raw internal id. `scoreDateISO` is the YYYY-MM-DD
// score date already formatted by the caller.
function workingHeader(stockSymbol, field, scoreDateISO) {
    return `Stock: ${stockSymbol} | Field: ${
        fieldLabel(field)
    } | Score Date: ${scoreDateISO}\n\n`;
}

// Publish on globalThis so the browser dashboard (classic script) and the Deno
// tests both reach the exact same helpers, mirroring docs/color_key.js.
globalThis.GRQFieldLabel = {
    FIELD_LABELS,
    fieldLabel,
    workingHeader,
};
