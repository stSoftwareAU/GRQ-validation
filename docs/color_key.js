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

// Coerce a Chart.js `borderDash` into a clean dash pattern for the swatch.
// Chart.js carries an array of positive pixel lengths (e.g. [8, 4] dashed,
// [2, 2] dotted); an absent/empty array means a solid line. Returns the cleaned
// array of finite, positive numbers, or [] for a solid stroke. Faithfully
// mirrors what the chart draws so same-colour series stay distinguishable
// (issue #245).
function normaliseSwatchDash(borderDash) {
    if (!Array.isArray(borderDash)) return [];
    const dash = borderDash.filter(
        (n) => typeof n === "number" && Number.isFinite(n) && n > 0,
    );
    return dash;
}

// Build the colour-key entries for a Chart.js dataset list. Returns one
// `{ label, colour, dash }` per VISIBLE, labelled data series, reading each
// entry's own `label`, `borderColor` and `borderDash` so there is no duplicated
// colour/style table. `dash` is the cleaned `borderDash` array ([] = solid).
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

        const dash = normaliseSwatchDash(dataset.borderDash);

        entries.push({ label, colour, dash });
    }
    return entries;
}

// Debounce `fn` so a burst of calls collapses into a single trailing call,
// fired `wait` ms after the LAST call in the burst. The dashboard uses this to
// keep the mobile colour key and chart legend in sync across viewport changes
// (window resize / orientation change) without rebuilding on every intermediate
// resize event — crossing the mobile/desktop breakpoint should re-evaluate the
// key just once per settle (issue #246, milestone #236).
//
// `this` and the most recent arguments are forwarded to `fn`. Each debounced
// wrapper owns its own timer, so independent wrappers never interfere. Uses the
// ambient setTimeout/clearTimeout, which exist in both the browser and Deno.
function debounce(fn, wait) {
    let timer = null;
    return function (...args) {
        if (timer !== null) {
            clearTimeout(timer);
        }
        timer = setTimeout(() => {
            timer = null;
            fn.apply(this, args);
        }, wait);
    };
}

// Publish on globalThis so the browser dashboard (classic script) and the Deno
// test importer can both reach the helper, mirroring docs/projection.js.
globalThis.GRQColorKey = {
    normaliseSwatchColour,
    normaliseSwatchDash,
    colorKeyEntries,
    debounce,
};
