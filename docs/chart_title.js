// Performance-chart heading text for the dashboard (issue #519).
//
// The portfolio (aggregate) view used to show a big "Portfolio Performance
// Over Time" heading — rendered BOTH as the HTML <h2 id="chartTitle"> and as
// the Chart.js canvas title. On a phone it wrapped onto two lines and just
// wasted vertical space, so the reporter asked for it to be removed. The
// portfolio view now returns an empty title (the caller then hides the heading
// and the canvas title); the stock-specific view keeps its informative title
// (score + target), which was not asked to be removed.
//
// Like docs/projection.js and docs/series_label_colour.js this is a PURE
// classic script: no module syntax, the helper is published on `globalThis`
// so the browser dashboard (via app.js) and the Deno tests exercise the exact
// same code.

// Resolve the chart heading text for the current selection.
//   selection.selectedStock — the ticker currently drilled into, or a
//     falsy value for the portfolio / aggregate view.
//   selection.stock — the matching score-row ({ score, target }) when known.
// Returns "" for the portfolio view (issue #519: no heading), the bare
// "Stock Performance: <ticker>" when the score row is unknown, or the full
// "Stock Performance: <ticker> (Score: …, Target: $…)" when it is.
function chartTitle(selection) {
    const sel = selection || {};
    const selectedStock = sel.selectedStock;

    // Portfolio / aggregate view: no heading (issue #519).
    if (!selectedStock) return "";

    const stock = sel.stock;
    if (
        stock &&
        typeof stock.score === "number" &&
        typeof stock.target === "number"
    ) {
        return `Stock Performance: ${selectedStock} (Score: ${
            stock.score.toFixed(3)
        }, Target: $${stock.target.toFixed(2)})`;
    }
    return `Stock Performance: ${selectedStock}`;
}

// Publish on globalThis so the browser dashboard (classic script) and the Deno
// tests both reach the exact same helper, mirroring docs/projection.js.
globalThis.GRQChartTitle = { chartTitle };
