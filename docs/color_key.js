// Mobile colour-key entry builder for the performance chart (issue #244,
// part of the legend milestone #236).
//
// On mobile the native Chart.js legend is force-hidden in docs/app.js, so no
// plotted line can be identified on a phone. The dashboard renders a compact
// colour key below the chart instead (scaffold added in issue #243). This
// module holds the PURE logic that decides which chart datasets become key
// entries and what colour/label each chip shows — the live datasets are the
// single source of truth, so the key always matches what is actually drawn in
// both the single-stock and aggregate views.
//
// It mirrors docs/escape.js and docs/projection.js: it is loaded as a classic
// <script> in docs/index.html, uses no module syntax, and publishes its helper
// on `globalThis` so both the browser dashboard (via `GRQValidator`) and the
// Deno tests exercise the exact same code.

// Coerce a Chart.js `borderColor` into a single CSS colour string for a swatch.
// Chart.js usually carries a string here; an array (per-point colours) collapses
// to its first entry. Anything else yields "" so the caller skips the dataset.
function normaliseSwatchColour(borderColor) {
    if (typeof borderColor === "string") return borderColor.trim();
    if (
        Array.isArray(borderColor) &&
        borderColor.length > 0 &&
        typeof borderColor[0] === "string"
    ) {
        return borderColor[0].trim();
    }
    return "";
}

// Build the colour-key entries for a Chart.js dataset list. Returns one
// `{ label, colour }` per VISIBLE, labelled data series, reading each entry's
// own `label` and `borderColor` so there is no duplicated colour/label table.
//
// Excluded so the key matches the desktop legend:
//   - hidden series (`hidden: true`),
//   - layout-only "spacer" series with an empty/absent `label`,
//   - series with no usable `borderColor` (nothing to draw a swatch from).
// Chart.js annotation lines (Score Date / 90-Day Target markers and the zero
// baseline) are annotations, not datasets, so they never reach this function.
function colorKeyEntries(datasets) {
    if (!Array.isArray(datasets)) return [];

    const entries = [];
    for (const dataset of datasets) {
        if (!dataset || typeof dataset !== "object") continue;
        if (dataset.hidden === true) continue;

        const label = typeof dataset.label === "string"
            ? dataset.label.trim()
            : "";
        if (label === "") continue; // spacer / unlabelled layout-only series

        const colour = normaliseSwatchColour(dataset.borderColor);
        if (colour === "") continue; // no drawable colour -> skip

        entries.push({ label, colour });
    }
    return entries;
}

// Publish on globalThis so the browser dashboard (classic script) and the Deno
// test importer can both reach the helper, mirroring docs/projection.js.
globalThis.GRQColorKey = {
    normaliseSwatchColour,
    colorKeyEntries,
};
