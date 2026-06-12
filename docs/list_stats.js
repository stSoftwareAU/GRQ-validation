// Summary-statistics helper for the score-file list page (issue #121).
//
// The averaging maths that produces the list page's "average 90-day",
// "average annualised" and "positive count" summary cards used to live only
// inside `updateSummaryStats` in docs/list.js, fused with DataTables/DOM access
// so no test could reach it. The Deno suite therefore reimplemented the
// averaging loop inline and asserted on its own copy — a tautology that stayed
// green even if list.js drifted.
//
// This extracts the pure accumulation/averaging kernel so BOTH the browser
// list page (via `updateSummaryStats`) and the Deno tests exercise the exact
// same code. Mirrors docs/list_render.js: loaded as a classic <script> in
// docs/list.html (before list.js) and imported by the Deno tests, uses no
// module syntax, and publishes its helper on `globalThis`.

// Aggregate an array of index.json rows into the list page's summary figures.
//
// Each row is expected to carry numeric `performance_90_day` and
// `performance_annualized` fields; null/undefined values are skipped so a
// score file still awaiting its 90-day result does not drag the averages.
// Returns the averages plus the counts the summary cards display. Pure and
// deterministic.
function computeListAverages(rows) {
    let total90Day = 0;
    let totalAnnualized = 0;
    let positiveCount = 0;
    let valid90DayCount = 0;
    let validAnnualizedCount = 0;

    const list = Array.isArray(rows) ? rows : [];
    for (const row of list) {
        const performance90Day = row ? row.performance_90_day : undefined;
        const performanceAnnualized = row ? row.performance_annualized : undefined;

        if (performance90Day !== null && performance90Day !== undefined) {
            total90Day += performance90Day;
            valid90DayCount++;

            if (performance90Day > 0) {
                positiveCount++;
            }
        }

        if (
            performanceAnnualized !== null && performanceAnnualized !== undefined
        ) {
            totalAnnualized += performanceAnnualized;
            validAnnualizedCount++;
        }
    }

    const avg90Day = valid90DayCount > 0 ? total90Day / valid90DayCount : 0;
    const avgAnnualized = validAnnualizedCount > 0
        ? totalAnnualized / validAnnualizedCount
        : 0;

    return {
        avg90Day,
        avgAnnualized,
        valid90DayCount,
        validAnnualizedCount,
        positiveCount,
    };
}

globalThis.GRQListStats = { computeListAverages };
