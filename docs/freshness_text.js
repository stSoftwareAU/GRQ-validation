// Stars click-popover freshness text helpers (issue #550).
//
// The Stars "show the working" popover appends the EXACT analysis date and the
// whole-day age of that analysis relative to the VIEWED score date. The inline
// emoji (issue #547) is the at-a-glance signal; this section gives the precise
// number — e.g. `Analysed: 20 Jun 2026` / `5 days before score date`.
//
// Like docs/field_label.js and docs/color_key.js this is a PURE classic script:
// no module syntax, helpers published on `globalThis`, so the browser dashboard
// (via app.js) and the Deno tests exercise the exact same code.

// Short month names. We format the date ourselves rather than via
// toLocaleDateString so the output is `20 Jun 2026` deterministically in both
// the browser and Deno (whose ICU build renders the "short" month as "June").
const SHORT_MONTHS = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
];

// Format an analysis date as `20 Jun 2026` (day / short month / year).
// Invalid or missing dates yield "" so nothing misleading is shown.
function formatAnalysisDate(date) {
    if (!(date instanceof Date) || isNaN(date.getTime())) return "";
    return `${date.getDate()} ${SHORT_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

// Describe the signed whole-day analysis age relative to the viewed score date.
// Always measured against the score date, never against today (issue #550).
//   n > 1  → "N days before score date"
//   n = 1  → "1 day before score date"   (singular)
//   n = 0  → "same day as score date"
//   n < 0  → ⚠️ analysis dated AFTER the score date (a data-pipeline error)
function analysisAgeLine(signedDaysFromScore) {
    const n = signedDaysFromScore;
    if (n < 0) {
        return "⚠️ analysed AFTER the score date (data-pipeline error — should never happen)";
    }
    if (n === 0) {
        return "same day as score date";
    }
    const unit = n === 1 ? "day" : "days";
    return `${n} ${unit} before score date`;
}

// Build the freshness section appended to the Stars working text: the analysis
// date plus the exact age line. A leading blank line separates it from the
// star maths above.
function freshnessSection(date, signedDaysFromScore) {
    return `\n\nAnalysis freshness:\n= Analysed: ${
        formatAnalysisDate(date)
    }\n= ${analysisAgeLine(signedDaysFromScore)}`;
}

// Publish on globalThis so the browser dashboard (classic script) and the Deno
// tests both reach the exact same helpers, mirroring docs/field_label.js.
globalThis.GRQFreshness = {
    formatAnalysisDate,
    analysisAgeLine,
    freshnessSection,
};
