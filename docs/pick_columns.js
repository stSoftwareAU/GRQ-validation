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

// The explanation module (issue #841): the "show the working" popover bodies,
// the light vocabulary (including the neutral ⚪) and the accessible wording
// behind each emoji. Owned there so a light is never described two ways.
function pickWorking() {
    const helper = globalThis.GRQPickWorking;
    if (!helper) {
        throw new Error(
            "GRQPickWorking is not loaded — docs/pick_working.js must be " +
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

// The date that closes the EARLIEST window the page's own series can offer:
// the date of its `WEEKDAY_WINDOW`-th oldest row (or its last row when it holds
// fewer). Used only as the last-resort as-of for the fallback ADV — see
// `pickColumnValues`. Returns null when the series carries no usable date.
function earliestWindowEnd(series) {
    if (!Array.isArray(series) || series.length === 0) {
        return null;
    }
    const times = series
        .map((point) => {
            if (!point || point.date === undefined || point.date === null) {
                return NaN;
            }
            return point.date instanceof Date
                ? point.date.getTime()
                : new Date(point.date).getTime();
        })
        .filter((time) => Number.isFinite(time))
        .sort((a, b) => a - b);
    if (times.length === 0) {
        return null;
    }
    const window = volumeHelper().WEEKDAY_WINDOW;
    return new Date(times[Math.min(window, times.length) - 1]);
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
        light: unknownLight ? pickWorking().UNKNOWN_LIGHT : verdict.light,
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
    // `advSource` records which of the three it was, so the cell can say when
    // the figure is an approximation rather than presenting all three alike.
    let adv = sidecar ? helper.toFiniteNumber(sidecar.advDollar10d) : null;
    let advSource = adv === null ? null : "sidecar";
    if (adv === null) {
        const volume = volumeHelper();
        adv = volume.averageDollarVolume(
            volume.buildTrailingVolumeWindow(options.series, options.scoreDate),
        );
        advSource = adv === null ? null : "trailing";
    }
    if (adv === null) {
        // The committed per-date CSV is score-date-FORWARD by design (it starts
        // on the score date and only looks ahead), so on most dates it holds no
        // row on or before the score date at all and the trailing window above
        // is empty. Rather than leave the liquidity columns permanently blank
        // until the sidecar backfill lands, fall back to the earliest window
        // the page DOES have — the ten trading days immediately following the
        // score date. Liquidity moves slowly, so it is a fair read, but it is
        // NOT as at the score date: the cell says so in its title, and the
        // sidecar supersedes it the moment one exists for the date.
        const volume = volumeHelper();
        const asOf = earliestWindowEnd(options.series);
        if (asOf !== null) {
            adv = volume.averageDollarVolume(
                volume.buildTrailingVolumeWindow(options.series, asOf),
            );
            advSource = adv === null ? null : "forward";
        }
    }

    const values = {
        price,
        adv,
        advSource,
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
    // The raw inputs behind each figure, kept so the "show the working" popover
    // (issue #841) can print them — and so a BLANK cell can say WHY it is blank
    // rather than opening an empty popover.
    values.inputs = {
        hasSidecar: sidecar !== null,
        eps: helper.toFiniteNumber(options.eps),
        week52Low: sidecar ? helper.toFiniteNumber(sidecar.week52Low) : null,
        week52High: sidecar ? helper.toFiniteNumber(sidecar.week52High) : null,
        closeScoreDate: sidecarClose,
        close5dPrior: sidecar
            ? helper.toFiniteNumber(sidecar.close5dPrior)
            : null,
    };
    values.trafficLight = resolveTrafficLight(values);
    return values;
}

// The "show the working" popover attributes for one pick-detail cell (issue
// #841). The `<td>` ITSELF is the trigger rather than a span inside it: an
// unknown figure renders as a BLANK cell, and a zero-width span could never be
// clicked, so the popover that explains why it is blank would be unreachable.
// The attributes are the same ones every other `.clickable-value` on the
// dashboard carries, so the shared popover lifecycle (docs/popover_cleanup.js,
// docs/popover_dismiss.js) disposes and dismisses these with the rest.
function triggerAttributes(field, label, stock) {
    const safeStock = escape(
        stock === undefined || stock === null ? "" : stock,
    );
    const title = safeStock === ""
        ? escape(label)
        : `${escape(label)} - ${safeStock}`;
    return 'data-bs-toggle="popover" data-bs-trigger="click" ' +
        `data-bs-content="" data-bs-title="${title}" data-field="${
            escape(field)
        }" data-stock="${safeStock}"`;
}

// The traffic-light `<td>`: the light followed by every warning emoji, plus a
// visually-hidden text equivalent so the meaning is never colour- or
// glyph-only and survives with images disabled (issue #841). The emoji run is
// `aria-hidden` because the wording beside it already says what it means.
//
// Deliberately NO `title` attribute: Bootstrap 5.1 promotes a trigger's `title`
// to `data-bs-original-title` and renders it as the popover HEADING, which
// would leave these cells headed by a warning summary while every other value
// on the dashboard reads "Field - Stock". The wording lives in the accessible
// text and in the popover body instead.
function trafficLightCell(values, stock) {
    const fields = pickWorking().PICK_FIELDS;
    const verdict = (values && values.trafficLight) ||
        resolveTrafficLight(values || {});
    const warnings = Array.isArray(verdict.warnings) ? verdict.warnings : [];
    const emojis = verdict.light + warnings.map((w) => w.emoji).join("");
    return `<td class="pick-light clickable-value" ${
        triggerAttributes(fields.LIGHT, PICK_COLUMN_LABELS[0], stock)
    }><span aria-hidden="true">${escape(emojis)}</span><span ` +
        `class="visually-hidden">${
            escape(pickWorking().accessibleLightText(verdict))
        }</span></td>`;
}

// The five figure `<td>`s, in header order. Every unknown renders as a blank
// cell — never a zero, which would read as a real (and terrible) number — and
// every cell, blank or not, opens its own working popover: the working says
// what window the figure came from, whether it is approximate, and why a blank
// cell is blank (issue #841).
function pickDetailCells(values, stock) {
    const row = values && typeof values === "object" ? values : {};
    const helper = pickDetails();
    const fields = pickWorking().PICK_FIELDS;
    const cells = [
        [fields.ADV, "pick-adv", helper.formatCompactMoney(row.adv)],
        [fields.LOTS, "pick-lots", helper.formatCompactCount(row.lots)],
        [
            fields.FIVE_DAY_RETURN,
            "pick-five-day-return",
            formatSignedPercent(row.fiveDayReturn),
        ],
        [
            fields.EARNINGS_YIELD,
            "pick-earnings-yield",
            formatSignedPercent(row.earningsYield),
        ],
        [
            fields.POSITION,
            "pick-52-week-position",
            formatRangePercent(row.position),
        ],
    ];
    return cells
        .map(([field, className, text], index) =>
            `<td class="${className} clickable-value" ${
                triggerAttributes(field, PICK_COLUMN_LABELS[index + 1], stock)
            }>${escape(text)}</td>`
        )
        .join("");
}

globalThis.GRQPickColumns = {
    // Re-exported from docs/pick_working.js, which owns the light vocabulary
    // (issue #841), so the neutral marker has exactly one definition. A getter
    // keeps the resolution lazy, matching the rest of this module.
    get UNKNOWN_LIGHT() {
        return pickWorking().UNKNOWN_LIGHT;
    },
    PICK_COLUMN_COUNT,
    PICK_COLUMN_LABELS,
    formatSignedPercent,
    formatRangePercent,
    classifyPicksLoad,
    pickColumnValues,
    trafficLightCell,
    pickDetailCells,
};
