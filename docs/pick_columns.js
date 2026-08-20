// Pick-detail COLUMNS for the dashboard's main stock table (issue #840,
// sub-issue of #835).
//
// While reviewing a score the user wants to answer "is there a reason we didn't
// manually pick this stock?" without leaving the page — the same figures their
// picking spreadsheet shows. This module turns the loaded data into the six
// extra table cells that answer it: the traffic light, dollar ADV, tradeable
// lots, the 5-day return, the earnings yield and the position in the 52-week
// range.
//
// STRICT DIVISION OF LABOUR — this module owns RENDERING ONLY:
//   - every threshold, the light and the warning vocabulary come from
//     `globalThis.GRQPickDetails` (issue #836);
//   - dollar ADV comes from `globalThis.GRQVolume` (`averageDollarVolume`, the
//     issue #576 single source of truth);
//   - untrusted values are escaped through `globalThis.escapeHtml`
//     (docs/escape.js).
// No threshold, average or window is ever re-implemented here.
//
// These columns are DISPLAY ONLY. They never feed the inclusion predicate
// (`GRQProjection.isStockIncluded` / `is_priceable`), the displayed score, or
// any portfolio aggregate — issue #835 asks to SHOW why a name might not have
// been picked, not to change what the portfolio holds.
//
// The figures are as at the SCORE DATE, consistent with the 90-day validation
// design — never a live quote (see the README's standing warning about
// "90-Day Actual" versus "Current Price").
//
// Mirrors docs/pick_details.js and docs/volume_recommend.js: a classic
// <script> (no module syntax) publishing on `globalThis.GRQPickColumns`, so the
// browser dashboard and the Deno tests exercise the exact same code.

// The neutral "not enough data" marker. Deliberately NEITHER 🟢 nor 🔴: an
// unknown value must never read as healthy and must never read as a warning.
const UNKNOWN_LIGHT = "⚪";

// How many columns this module contributes: the light plus five figures.
const PICK_COLUMN_COUNT = 6;

// The sidecar's committed column order (src/picks_sidecar.rs). Parsed by NAME
// from the header row, so a future column added upstream cannot silently shift
// a value into the wrong field.
const SIDECAR_FIELDS = {
    week52Low: "week52_low",
    week52High: "week52_high",
    closeScoreDate: "close_score_date",
    close5dPrior: "close_5d_prior",
    advDollar10d: "adv_dollar_10d",
};

// The column labels, in render order. The header cells themselves are literal
// markup in BOTH docs/index.html (static) and the runtime rebuild in
// docs/app.js; this list is what
// `tests/stock_table_pick_columns_markup_test.ts` pins them to, so the two
// header rows can never describe different columns.
const PICK_COLUMN_LABELS = [
    "Pick",
    "ADV",
    "Lots",
    "5-Day Return",
    "Earnings Yield",
    "52-Week Position",
];

// Resolve the shared helpers lazily so script load order cannot break this
// module, and so a missing dependency fails loud at call time rather than
// silently rendering empty columns.
function pickDetails() {
    const helper = globalThis.GRQPickDetails;
    if (!helper) {
        throw new Error(
            "GRQPickDetails is not loaded — docs/pick_details.js must be " +
                "loaded before docs/pick_columns.js",
        );
    }
    return helper;
}

function volumeHelper() {
    const helper = globalThis.GRQVolume;
    if (!helper) {
        throw new Error(
            "GRQVolume is not loaded — docs/volume_recommend.js must be " +
                "loaded before docs/pick_columns.js",
        );
    }
    return helper;
}

function escape(value) {
    const helper = globalThis.escapeHtml;
    if (typeof helper !== "function") {
        throw new Error(
            "escapeHtml is not loaded — docs/escape.js must be loaded before " +
                "docs/pick_columns.js",
        );
    }
    return helper(value);
}

// A percentage with an explicit sign, to one decimal ("+8.1%", "-2.5%",
// "0.0%"). Unknown renders as "" — the blank cell that reads as "we don't
// know", never as a real number.
function formatSignedPercent(fraction) {
    const value = pickDetails().toFiniteNumber(fraction);
    if (value === null) {
        return "";
    }
    // Round to one decimal BEFORE choosing the sign so a value that rounds to
    // zero never renders as "-0.0%".
    const rounded = Math.round(value * 1000) / 10;
    const sign = rounded > 0 ? "+" : (rounded < 0 ? "-" : "");
    return `${sign}${Math.abs(rounded).toFixed(1)}%`;
}

// The 52-week position as an unsigned percentage of the range ("50.0%"). The
// table already reads percentages elsewhere (Gain/Loss, Return above Cost of
// Capital), so the position is a percentage too rather than a 0.00–1.00
// fraction. Unknown renders as "".
function formatRangePercent(fraction) {
    const value = pickDetails().toFiniteNumber(fraction);
    if (value === null) {
        return "";
    }
    return `${(Math.round(value * 1000) / 10).toFixed(1)}%`;
}

// Parse one sidecar cell to a finite number, or null. Blank stays unknown —
// the sidecar writes blank, never zero, for anything it could not compute.
function sidecarNumber(raw) {
    return pickDetails().toFiniteNumber(raw);
}

// Classify a `<date>-picks.csv` fetch and parse it in one step, mirroring the
// dashboard's existing market-data classification.
//
// Returns { state, reason, message, rows } where `rows` maps ticker to the
// parsed sidecar fields and `state` is one of:
//   - "ok"     — parsed, at least one data row;
//   - "absent" — the file is not there (older dates predate the sidecar). This
//                is NOT a fault: the columns degrade to blank cells;
//   - "error"  — the file WAS fetched but is unusable (wrong header, or a
//                header with no data rows). Reported loudly by the caller
//                rather than reconciled as "no picks".
// `rows` is always an object, so a caller can render regardless of state.
function classifyPicksLoad(input) {
    const options = input && typeof input === "object" ? input : {};
    const rows = {};

    if (!options.ok) {
        return {
            state: "absent",
            reason: "not-found",
            message: `No pick-details sidecar for this date (HTTP ${
                options.status ?? "?"
            }). The pick columns render blank.`,
            rows,
        };
    }

    const text = typeof options.text === "string" ? options.text : "";
    const lines = text.split("\n").map((line) => line.trim()).filter((line) =>
        line !== ""
    );
    if (lines.length === 0) {
        return {
            state: "error",
            reason: "empty-file",
            message: "The pick-details sidecar is empty. This is a data fault.",
            rows,
        };
    }

    const header = lines[0].split(",").map((cell) => cell.trim());
    const tickerIndex = header.indexOf("ticker");
    const fieldIndex = {};
    let headerOk = tickerIndex !== -1;
    Object.keys(SIDECAR_FIELDS).forEach((key) => {
        const index = header.indexOf(SIDECAR_FIELDS[key]);
        fieldIndex[key] = index;
        if (index === -1) {
            headerOk = false;
        }
    });

    if (!headerOk) {
        return {
            state: "error",
            reason: "bad-header",
            message:
                `The pick-details sidecar header is not recognised (got "${
                    header.join(",")
                }"). This is a data fault.`,
            rows,
        };
    }

    lines.slice(1).forEach((line) => {
        const cells = line.split(",");
        const ticker = (cells[tickerIndex] ?? "").trim();
        if (ticker === "") {
            return;
        }
        const row = {};
        Object.keys(SIDECAR_FIELDS).forEach((key) => {
            row[key] = sidecarNumber(cells[fieldIndex[key]]);
        });
        rows[ticker] = row;
    });

    if (Object.keys(rows).length === 0) {
        return {
            state: "error",
            reason: "no-data-rows",
            message:
                "The pick-details sidecar has a header but no data rows. This " +
                "is a data fault.",
            rows,
        };
    }

    return { state: "ok", reason: "loaded", message: "", rows };
}

// The traffic light for one row, layering the DISPLAY notion of "unknown" over
// the shared verdict without duplicating a single threshold.
//
// `GRQPickDetails.pickTrafficLight` correctly refuses to judge an unknown
// value, which means a row where nothing is known comes back 🟢 — "clear".
// On the dashboard that would read as "this name is healthy" when the truth is
// "we have no idea" (a 2024 date has no volume column, no eps and no sidecar).
// So: any warning the shared helper raises is reported verbatim, and only when
// NO warning fires AND some input is unknown do we downgrade the 🟢 to the
// neutral ⚪. An unknown value therefore never manufactures a warning and never
// suppresses one.
function resolveTrafficLight(values) {
    const helper = pickDetails();
    const verdict = helper.pickTrafficLight({
        price: values.price,
        lots: values.lots,
        position: values.position,
        fiveDayReturn: values.fiveDayReturn,
        earningsYield: values.earningsYield,
    });
    const known = [
        values.price,
        values.lots,
        values.position,
        values.fiveDayReturn,
        values.earningsYield,
    ].every((value) => helper.toFiniteNumber(value) !== null);

    const unknownLight = !known && !verdict.majorWarn && !verdict.minorWarn;
    return {
        light: unknownLight ? UNKNOWN_LIGHT : verdict.light,
        warnings: verdict.warnings,
        majorWarn: verdict.majorWarn,
        minorWarn: verdict.minorWarn,
        known,
    };
}

// Build the six values for one table row.
//
// Input: {
//   sidecar,    // parsed `<date>-picks.csv` row for this ticker, or null
//   series,     // the in-page per-ticker market-data rows (fallback ADV)
//   scoreDate,  // as-at date for the trailing ADV window
//   eps,        // `eps` from the score TSV (issue #837)
//   buyPrice,   // the dashboard's score-date price, used when no sidecar
// }
//
// The sidecar wins wherever it has a value: it is computed from history BEFORE
// the score date, which the in-page CSV deliberately does not carry. Where it
// is absent the ADV falls back to the same trailing window the low-volume badge
// uses, so the columns still populate; the 52-week position and the 5-day
// return simply stay unknown, because nothing in the page can supply them.
function pickColumnValues(input) {
    const options = input && typeof input === "object" ? input : {};
    const helper = pickDetails();
    const sidecar = options.sidecar && typeof options.sidecar === "object"
        ? options.sidecar
        : null;

    // The as-at price: the sidecar's score-date close, else the dashboard's
    // existing buy/score-date price. Never the 90-Day Actual — these are
    // as-at-the-score-date figures, not a live quote.
    const sidecarClose = sidecar ? helper.toFiniteNumber(sidecar.closeScoreDate) : null;
    const price = sidecarClose !== null
        ? sidecarClose
        : helper.toFiniteNumber(options.buyPrice);

    // ADV: the sidecar's trailing ten-weekday mean, else the same window
    // recomputed from the in-page CSV through the #576 single source of truth.
    let adv = sidecar ? helper.toFiniteNumber(sidecar.advDollar10d) : null;
    if (adv === null) {
        const volume = volumeHelper();
        const window = volume.buildTrailingVolumeWindow(
            options.series,
            options.scoreDate,
        );
        adv = volume.averageDollarVolume(window);
    }

    const values = {
        price,
        adv,
        lots: helper.lotsFromAdv(adv),
        fiveDayReturn: sidecar
            ? helper.fiveDayReturn(sidecar.closeScoreDate, sidecar.close5dPrior)
            : null,
        earningsYield: helper.earningsYield(options.eps, price),
        position: sidecar
            ? helper.fiftyTwoWeekPosition(
                price,
                sidecar.week52Low,
                sidecar.week52High,
            )
            : null,
    };
    values.trafficLight = resolveTrafficLight(values);
    return values;
}

// The traffic-light `<td>`: the light followed by every warning emoji, with the
// full wording in the cell's title so the reason is never emoji-only.
function trafficLightCell(values) {
    const verdict = (values && values.trafficLight) ||
        resolveTrafficLight(values || {});
    const warnings = Array.isArray(verdict.warnings) ? verdict.warnings : [];
    const emojis = verdict.light + warnings.map((w) => w.emoji).join("");
    const title = warnings.length > 0
        ? warnings.map((w) => w.label).join("; ")
        : (verdict.known
            ? "No pick warnings as at the score date"
            : "Not enough data as at the score date to judge this pick");
    return `<td class="pick-light" title="${escape(title)}">${
        escape(emojis)
    }</td>`;
}

// The five figure `<td>`s, in header order. Every unknown renders as a blank
// cell — never a zero, which would read as a real (and terrible) number.
function pickDetailCells(values) {
    const row = values && typeof values === "object" ? values : {};
    const helper = pickDetails();
    const cells = [
        ["pick-adv", helper.formatCompactMoney(row.adv)],
        ["pick-lots", helper.formatCompactCount(row.lots)],
        ["pick-five-day-return", formatSignedPercent(row.fiveDayReturn)],
        ["pick-earnings-yield", formatSignedPercent(row.earningsYield)],
        ["pick-52-week-position", formatRangePercent(row.position)],
    ];
    return cells
        .map(([className, text]) =>
            `<td class="${className}">${escape(text)}</td>`
        )
        .join("");
}

globalThis.GRQPickColumns = {
    UNKNOWN_LIGHT,
    PICK_COLUMN_COUNT,
    PICK_COLUMN_LABELS,
    formatSignedPercent,
    formatRangePercent,
    classifyPicksLoad,
    pickColumnValues,
    trafficLightCell,
    pickDetailCells,
};
