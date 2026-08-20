// "Show the working" text, accessible wording and legend for the pick-detail
// columns (issue #841, sub-issue of #835).
//
// The dashboard's house style is that every number can explain itself: a value
// is a `.clickable-value` wired to a Bootstrap popover whose body shows the
// inputs, the formula and the result. The pick-detail columns (issue #840) need
// it most — a bare `🟠 📈` says nothing until you know 📈 means "within 15% of
// the 52-week high, without a strong earnings yield".
//
// STRICT DIVISION OF LABOUR — this module EXPLAINS, it never calculates:
//   - every threshold, the light and the warning vocabulary come from
//     `globalThis.GRQPickDetails` (issue #836);
//   - the figures themselves come from `GRQPickColumns.pickColumnValues`
//     (issue #840), which passes its own inputs back in `values.inputs`;
//   - untrusted values are escaped through `globalThis.escapeHtml`.
// No threshold and no formula is re-implemented here: the wording quotes the
// shared constants, so retuning a threshold retunes its explanation too.
//
// It also owns the LIGHT vocabulary (🟢/🟠/🔴/⚪ and what each one means), so
// the popover body, the visually-hidden text behind the emoji and the legend
// below the table can never describe the same light differently.
//
// Mirrors docs/pick_details.js and docs/field_label.js: a classic <script> (no
// module syntax) publishing on `globalThis.GRQPickWorking`, so the browser
// dashboard and the Deno tests exercise the exact same code.

// The `data-field` id of each pick-detail value. These are the ids the popover
// machinery in docs/app.js dispatches on, and docs/field_label.js maps to the
// human-readable header label (issue #542) so a popover header never leaks a
// raw id.
const PICK_FIELDS = Object.freeze({
    LIGHT: "pick-light",
    ADV: "pick-adv",
    LOTS: "pick-lots",
    FIVE_DAY_RETURN: "pick-five-day-return",
    EARNINGS_YIELD: "pick-earnings-yield",
    POSITION: "pick-52-week-position",
});

// The neutral "not enough data" marker. Deliberately NEITHER 🟢 nor 🔴: an
// unknown value must never read as healthy and must never read as a warning.
// Owned here, beside the rest of the light vocabulary, and re-exported by
// docs/pick_columns.js so there is exactly one definition.
const UNKNOWN_LIGHT = "⚪";

// What each light MEANS, in words. The `word` is the colour-free name (so the
// meaning survives with colour and images disabled) and `meaning` is the full
// sentence used by the popover and the legend.
const LIGHTS = Object.freeze({
    "🟢": Object.freeze({
        word: "Green",
        meaning: "no warnings — nothing about this pick stands out",
    }),
    "🟠": Object.freeze({
        word: "Amber",
        meaning: "at least one minor warning, and no major warning",
    }),
    "🔴": Object.freeze({
        word: "Red",
        meaning: "at least one major warning",
    }),
    [UNKNOWN_LIGHT]: Object.freeze({
        word: "Unknown",
        meaning: "not enough data as at the score date to judge this pick",
    }),
});

function pickDetails() {
    const helper = globalThis.GRQPickDetails;
    if (!helper) {
        throw new Error(
            "GRQPickDetails is not loaded — docs/pick_details.js must be " +
                "loaded before docs/pick_working.js",
        );
    }
    return helper;
}

function escape(value) {
    const helper = globalThis.escapeHtml;
    if (typeof helper !== "function") {
        throw new Error(
            "escapeHtml is not loaded — docs/escape.js must be loaded before " +
                "docs/pick_working.js",
        );
    }
    return helper(value);
}

// --- number wording ---------------------------------------------------------

// A plain dollar amount to the cent ("$20.50"), or null when unusable.
function money(value) {
    const number = pickDetails().toFiniteNumber(value);
    return number === null ? null : `$${number.toFixed(2)}`;
}

// A percentage with an explicit sign ("+6.0%", "-12.3%"), or null.
function signedPercent(fraction) {
    const number = pickDetails().toFiniteNumber(fraction);
    if (number === null) {
        return null;
    }
    const rounded = Math.round(number * 1000) / 10;
    const sign = rounded > 0 ? "+" : (rounded < 0 ? "-" : "");
    return `${sign}${Math.abs(rounded).toFixed(1)}%`;
}

// An unsigned percentage ("85.0%"), used for thresholds and the range position.
function plainPercent(fraction) {
    const number = pickDetails().toFiniteNumber(fraction);
    return number === null ? null : `${(Math.round(number * 1000) / 10).toFixed(1)}%`;
}

// A lot count in words ("120 lots", "1.20k lots"), or null.
function lotsText(value) {
    const helper = pickDetails();
    const number = helper.toFiniteNumber(value);
    if (number === null) {
        return null;
    }
    const figure = number >= 1000
        ? helper.formatCompactCount(number)
        : `${Math.round(number * 10) / 10}`;
    return `${figure} lots`;
}

// The $20,000 parcel, written the way the user says it. Grouped by hand rather
// than through toLocaleString so the wording cannot shift with the runtime's
// default locale.
function parcelText() {
    const parcel = Math.round(pickDetails().PARCEL_DOLLARS);
    return `$${String(parcel).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

// --- unknown-value reasons --------------------------------------------------
//
// A blank cell must never open an empty popover: the body says WHY the value is
// blank. These build the "why" for each figure from what the row actually had.

function inputsOf(values) {
    const row = values && typeof values === "object" ? values : {};
    return row.inputs && typeof row.inputs === "object" ? row.inputs : {};
}

function advUnknownReason(values) {
    return inputsOf(values).hasSidecar
        ? "the pick-details sidecar for this date carries no average dollar " +
            "volume for this stock, and the in-page market CSV has no usable " +
            "volume for the window"
        : "there is no pick-details sidecar for this date, and the in-page " +
            "market CSV has no usable volume for the window";
}

function priceUnknownReason(values) {
    return inputsOf(values).hasSidecar
        ? "the pick-details sidecar carries no score-date close for this " +
            "stock and the dashboard found no buy price near the score date"
        : "the dashboard found no market price within five days of the score " +
            "date";
}

function rangeUnknownReason(values) {
    const inputs = inputsOf(values);
    if (!inputs.hasSidecar) {
        return "there is no pick-details sidecar for this date, so the 52-week " +
            "high and low are unknown — nothing else on the page carries them";
    }
    if (inputs.week52Low === null || inputs.week52High === null) {
        return "the pick-details sidecar carries no 52-week high/low for this " +
            "stock";
    }
    return "the recorded 52-week high is not above the low, so the position " +
        "in the range carries no meaning";
}

function priorCloseUnknownReason(values) {
    const inputs = inputsOf(values);
    if (!inputs.hasSidecar) {
        return "there is no pick-details sidecar for this date, and the " +
            "in-page market CSV starts at the score date, so the close five " +
            "trading days earlier is unknown";
    }
    return "the pick-details sidecar carries no close five trading days " +
        "before the score date for this stock";
}

function epsUnknownReason() {
    return "the score file for this date carries no eps for this stock — the " +
        "eps column was added to the score TSV by issue #837, so earlier " +
        "dates have none";
}

// --- the per-field working text ---------------------------------------------

function scoreDateOf(context) {
    const options = context && typeof context === "object" ? context : {};
    return typeof options.scoreDateISO === "string" && options.scoreDateISO !== ""
        ? options.scoreDateISO
        : "the score date";
}

function windowOf(context) {
    const options = context && typeof context === "object" ? context : {};
    const window = pickDetails().toFiniteNumber(options.weekdayWindow);
    return window === null ? 10 : window;
}

// Where the ADV came from, in one sentence. `advSource` is set by
// `GRQPickColumns.pickColumnValues`.
function advSourceLine(values, context) {
    const window = windowOf(context);
    const scoreDate = scoreDateOf(context);
    switch (values.advSource) {
        case "sidecar":
            return "= Source: the pick-details sidecar for this score date " +
                `(scores/${scoreDate}-picks.csv)`;
        case "trailing":
            return "= Source: the in-page market CSV — there is no " +
                "pick-details sidecar for this date, so the same trailing " +
                "window was recomputed from the loaded rows";
        case "forward":
            return "= Source: the in-page market CSV — APPROXIMATE. There is " +
                "no pick-details sidecar for this date and the in-page CSV " +
                `starts at the score date, so this is the ${window} trading ` +
                "days FOLLOWING the score date, not the ones before it";
        default:
            return "= Source: none — the figure could not be computed";
    }
}

function advWorking(values, context) {
    const window = windowOf(context);
    const lines = [
        "ADV working:",
        `= mean(daily volume × daily low price) over the ${window} trading ` +
        `days to ${scoreDateOf(context)}`,
        advSourceLine(values, context),
    ];
    const adv = pickDetails().toFiniteNumber(values.adv);
    lines.push(
        adv === null
            ? `= Unknown: ${advUnknownReason(values)}`
            : `= ${pickDetails().formatCompactMoney(adv)}`,
    );
    return lines.join("\n");
}

// Which liquidity band a lot count falls in, quoting the shared thresholds.
function lotsBandLine(lots) {
    const helper = pickDetails();
    if (lots < helper.MIN_RED_LOTS) {
        return `= Band: under ${helper.MIN_RED_LOTS} lots ⇒ ${
            helper.WARNINGS.POOR_LIQUIDITY.emoji
        } poor liquidity, a major warning (red light)`;
    }
    if (lots < helper.MIN_AMBER_LOTS) {
        return `= Band: ${helper.MIN_RED_LOTS} to under ${helper.MIN_AMBER_LOTS} ` +
            `lots ⇒ ${helper.WARNINGS.THIN_LIQUIDITY.emoji} thin liquidity, a ` +
            "minor warning (amber light)";
    }
    return `= Band: ${helper.MIN_AMBER_LOTS} lots or more ⇒ no liquidity warning`;
}

function lotsWorking(values, context) {
    const helper = pickDetails();
    const lines = [
        "Lots working:",
        `= ADV ÷ ${parcelText()} parcel`,
    ];
    const adv = helper.toFiniteNumber(values.adv);
    const lots = helper.toFiniteNumber(values.lots);
    if (adv === null || lots === null) {
        lines.push(`= Unknown: the ADV is unknown, so the lots cannot be worked out`);
        lines.push(`= Why the ADV is unknown: ${advUnknownReason(values)}`);
        return lines.join("\n");
    }
    lines.push(
        `= ${helper.formatCompactMoney(adv)} ÷ ${parcelText()} = ${lotsText(lots)}`,
    );
    lines.push(advSourceLine(values, context));
    lines.push(lotsBandLine(lots));
    return lines.join("\n");
}

// Which earnings-yield band the value falls in, quoting the shared thresholds.
function earningsYieldBandLine(ey) {
    const helper = pickDetails();
    if (ey < 0) {
        return `= Below 0.0% ⇒ ${helper.WARNINGS.NEGATIVE_EY.emoji} negative ` +
            "earnings yield (loss making), a major warning (red light)";
    }
    if (ey < helper.EY_WEAK_CUT) {
        return `= Under ${plainPercent(helper.EY_WEAK_CUT)} ⇒ ${
            helper.WARNINGS.WEAK_EY.emoji
        } weak earnings yield, a major warning (red light)`;
    }
    if (ey >= helper.EY_STRONG_CUT) {
        return `= ${plainPercent(helper.EY_STRONG_CUT)} or better ⇒ ${
            helper.WARNINGS.STRONG_EY.emoji
        } strong earnings yield, which also excuses sitting at the 52-week ` +
            "high or low";
    }
    return `= Between ${plainPercent(helper.EY_WEAK_CUT)} and ${
        plainPercent(helper.EY_STRONG_CUT)
    } ⇒ no earnings-yield warning`;
}

function earningsYieldWorking(values, context) {
    const helper = pickDetails();
    const inputs = inputsOf(values);
    const lines = [
        "Earnings Yield working:",
        `= earnings per share ÷ the price as at ${scoreDateOf(context)}`,
    ];
    const eps = helper.toFiniteNumber(inputs.eps);
    const price = helper.toFiniteNumber(values.price);
    const ey = helper.toFiniteNumber(values.earningsYield);
    if (ey === null) {
        lines.push(
            `= Unknown: ${
                eps === null ? epsUnknownReason() : priceUnknownReason(values)
            }`,
        );
        if (eps !== null) {
            lines.push(`= Earnings per share: ${money(eps)}`);
        }
        if (price !== null) {
            lines.push(`= Score-date price: ${money(price)}`);
        }
        return lines.join("\n");
    }
    lines.push(`= ${money(eps)} ÷ ${money(price)}`);
    lines.push(`= ${signedPercent(ey)}`);
    lines.push(earningsYieldBandLine(ey));
    return lines.join("\n");
}

function positionWorking(values, context) {
    const helper = pickDetails();
    const inputs = inputsOf(values);
    const lines = [
        "52-Week Position working:",
        "= (price − 52-week low) ÷ (52-week high − 52-week low)",
    ];
    const position = helper.toFiniteNumber(values.position);
    const price = helper.toFiniteNumber(values.price);
    if (position === null) {
        lines.push(
            `= Unknown: ${
                price === null
                    ? priceUnknownReason(values)
                    : rangeUnknownReason(values)
            }`,
        );
        return lines.join("\n");
    }
    lines.push(
        `= (${money(price)} − ${money(inputs.week52Low)}) ÷ (${
            money(inputs.week52High)
        } − ${money(inputs.week52Low)})`,
    );
    lines.push(`= ${plainPercent(position)} of the 52-week range`);
    lines.push(
        `= Window: the 52 weeks to ${
            scoreDateOf(context)
        }, from the pick-details sidecar`,
    );
    lines.push(
        `= ${plainPercent(helper.HIGH_CUT)} or above is ${
            helper.WARNINGS.AT_HIGH.emoji
        } near the high; ${plainPercent(helper.LOW_CUT)} or below is ${
            helper.WARNINGS.AT_LOW.emoji
        } near the low`,
    );
    return lines.join("\n");
}

function fiveDayReturnWorking(values, context) {
    const helper = pickDetails();
    const inputs = inputsOf(values);
    const lines = [
        "5-Day Return working:",
        "= (close on the score date ÷ close five trading days earlier) − 1",
    ];
    const change = helper.toFiniteNumber(values.fiveDayReturn);
    const closeNow = helper.toFiniteNumber(inputs.closeScoreDate);
    if (change === null) {
        lines.push(
            `= Unknown: ${
                closeNow === null
                    ? priceUnknownReason(values)
                    : priorCloseUnknownReason(values)
            }`,
        );
        return lines.join("\n");
    }
    lines.push(`= (${money(closeNow)} ÷ ${money(inputs.close5dPrior)}) − 1`);
    lines.push(`= ${signedPercent(change)}`);
    lines.push(
        `= Closes from the pick-details sidecar: ${
            money(closeNow)
        } on the score date (${
            scoreDateOf(context)
        }) and ${
            money(inputs.close5dPrior)
        } five trading days earlier (the sidecar records the closes, not their calendar dates)`,
    );
    lines.push(
        `= ${signedPercent(helper.DROP_CUT)} or worse is ${
            helper.WARNINGS.BIG_DROP.emoji
        } a big drop, a minor warning`,
    );
    return lines.join("\n");
}

// --- the traffic light ------------------------------------------------------

// The severity of one warning, as words. A warning is "major" when it turns the
// light red, "minor" when it turns it amber, "noted" when a strong earnings
// yield stops it doing either, and "good news" for 💰 itself.
function warningSeverity(warning, values) {
    const helper = pickDetails();
    const W = helper.WARNINGS;
    const ey = helper.toFiniteNumber(values.earningsYield);
    const strongEy = ey !== null && ey >= helper.EY_STRONG_CUT;
    switch (warning.emoji) {
        case W.DELIST.emoji:
        case W.POOR_LIQUIDITY.emoji:
        case W.NEGATIVE_EY.emoji:
        case W.WEAK_EY.emoji:
            return "major — turns the light red";
        case W.THIN_LIQUIDITY.emoji:
        case W.BIG_DROP.emoji:
            return "minor — turns the light amber";
        case W.AT_HIGH.emoji:
        case W.AT_LOW.emoji:
            return strongEy
                ? "noted — the strong earnings yield stops this tripping the light"
                : "minor — turns the light amber";
        case W.STRONG_EY.emoji:
            return "good news — not a warning";
        default:
            return "noted";
    }
}

// The threshold that a warning tests, and the value that met it.
function warningEvidence(warning, values) {
    const helper = pickDetails();
    const W = helper.WARNINGS;
    switch (warning.emoji) {
        case W.DELIST.emoji:
            return {
                threshold: `price under $${helper.DELIST_PRICE.toFixed(2)}`,
                value: money(values.price),
            };
        case W.POOR_LIQUIDITY.emoji:
            return {
                threshold: `under ${helper.MIN_RED_LOTS} lots`,
                value: lotsText(values.lots),
            };
        case W.THIN_LIQUIDITY.emoji:
            return {
                threshold: `${helper.MIN_RED_LOTS} to under ${helper.MIN_AMBER_LOTS} lots`,
                value: lotsText(values.lots),
            };
        case W.AT_HIGH.emoji:
            return {
                threshold: `${plainPercent(helper.HIGH_CUT)} of the 52-week range or above`,
                value: plainPercent(values.position),
            };
        case W.AT_LOW.emoji:
            return {
                threshold: `${plainPercent(helper.LOW_CUT)} of the 52-week range or below`,
                value: plainPercent(values.position),
            };
        case W.BIG_DROP.emoji:
            return {
                threshold: `5-day return of ${signedPercent(helper.DROP_CUT)} or worse`,
                value: signedPercent(values.fiveDayReturn),
            };
        case W.NEGATIVE_EY.emoji:
            return {
                threshold: "earnings yield below 0.0%",
                value: signedPercent(values.earningsYield),
            };
        case W.WEAK_EY.emoji:
            return {
                threshold: `earnings yield under ${plainPercent(helper.EY_WEAK_CUT)}`,
                value: signedPercent(values.earningsYield),
            };
        case W.STRONG_EY.emoji:
            return {
                threshold: `earnings yield of ${plainPercent(helper.EY_STRONG_CUT)} or better`,
                value: signedPercent(values.earningsYield),
            };
        default:
            return { threshold: "", value: null };
    }
}

// One line per warning: the emoji, its wording, the threshold it tests, the
// value that met it, and whether it turned the light red or amber.
function warningLines(values) {
    const row = values && typeof values === "object" ? values : {};
    const verdict = row.trafficLight && typeof row.trafficLight === "object"
        ? row.trafficLight
        : {};
    const warnings = Array.isArray(verdict.warnings) ? verdict.warnings : [];
    return warnings.map((warning) => {
        const evidence = warningEvidence(warning, row);
        const value = evidence.value === null ? "unknown" : evidence.value;
        return `${warning.emoji} ${warning.label} — threshold: ${
            evidence.threshold
        }; value: ${value} (${warningSeverity(warning, row)})`;
    });
}

// Which figures the row did not have. Named so the ⚪ light says what is
// missing rather than leaving the reader guessing.
function unknownFigures(values) {
    const helper = pickDetails();
    const row = values && typeof values === "object" ? values : {};
    return [
        ["the price as at the score date", row.price],
        ["ADV and lots", row.adv],
        ["the 52-week position", row.position],
        ["the 5-day return", row.fiveDayReturn],
        ["the earnings yield", row.earningsYield],
    ]
        .filter(([, value]) => helper.toFiniteNumber(value) === null)
        .map(([name]) => name);
}

// "🟠 Amber — at least one minor warning, and no major warning".
function lightSummary(verdict) {
    const light = verdict && typeof verdict.light === "string"
        ? verdict.light
        : UNKNOWN_LIGHT;
    const meaning = LIGHTS[light];
    return meaning ? `${light} ${meaning.word} — ${meaning.meaning}` : light;
}

// The text equivalent of the traffic-light cell, for the visually-hidden span
// behind the emoji: the meaning survives with colour and images disabled.
function accessibleLightText(verdict) {
    const source = verdict && typeof verdict === "object" ? verdict : {};
    const light = typeof source.light === "string" ? source.light : UNKNOWN_LIGHT;
    const meaning = LIGHTS[light];
    const head = meaning ? `${meaning.word}: ${meaning.meaning}` : light;
    const warnings = Array.isArray(source.warnings) ? source.warnings : [];
    if (warnings.length === 0) {
        return `${head}.`;
    }
    return `${head}. ${warnings.map((warning) => warning.label).join(". ")}.`;
}

// The red-vs-amber rules, quoting the shared thresholds so the reader can see
// which condition is major and which is minor.
function lightRuleLines() {
    const helper = pickDetails();
    return [
        `= Major (🔴): a price under $${
            helper.DELIST_PRICE.toFixed(2)
        }, under ${helper.MIN_RED_LOTS} lots, or an earnings yield under ${
            plainPercent(helper.EY_WEAK_CUT)
        }`,
        `= Minor (🟠): a 5-day fall of ${
            plainPercent(Math.abs(helper.DROP_CUT))
        } or more, ${helper.MIN_RED_LOTS} to under ${helper.MIN_AMBER_LOTS} lots, ` +
        `or sitting at the 52-week high or low without a strong (${
            plainPercent(helper.EY_STRONG_CUT)
        } or better) earnings yield`,
    ];
}

function trafficLightWorking(values) {
    const row = values && typeof values === "object" ? values : {};
    const verdict = row.trafficLight && typeof row.trafficLight === "object"
        ? row.trafficLight
        : {};
    const lines = ["Pick working:", `= ${lightSummary(verdict)}`];

    const warnings = warningLines(row);
    if (warnings.length > 0) {
        lines.push("= Warnings that fired:");
        warnings.forEach((line) => lines.push(`  ${line}`));
    } else {
        lines.push("= No warning fired");
    }

    const missing = unknownFigures(row);
    if (missing.length > 0) {
        lines.push(`= Not known as at the score date: ${missing.join(", ")}`);
    }

    lightRuleLines().forEach((line) => lines.push(line));
    return lines.join("\n");
}

// --- public entry point -----------------------------------------------------

function isPickField(field) {
    return Object.values(PICK_FIELDS).indexOf(field) !== -1;
}

// The popover body for one pick-detail field.
//
// Input: { field, values, context } where `values` is a
// `GRQPickColumns.pickColumnValues` row and `context` carries the score date
// (`scoreDateISO`) and the ADV window (`weekdayWindow`).
//
// Throws for a field this module does not own — a caller that dispatches on the
// wrong id fails loud rather than rendering an empty popover.
function working(input) {
    const options = input && typeof input === "object" ? input : {};
    const field = options.field;
    if (!isPickField(field)) {
        throw new Error(
            `GRQPickWorking.working: "${field}" is not a pick-detail field`,
        );
    }
    const context = options.context;
    // A row the caller could not supply is still explained, rather than opening
    // an empty popover: every figure simply reads as unknown.
    const values = options.values && typeof options.values === "object"
        ? options.values
        : {};

    switch (field) {
        case PICK_FIELDS.LIGHT:
            return trafficLightWorking(values);
        case PICK_FIELDS.ADV:
            return advWorking(values, context);
        case PICK_FIELDS.LOTS:
            return lotsWorking(values, context);
        case PICK_FIELDS.FIVE_DAY_RETURN:
            return fiveDayReturnWorking(values, context);
        case PICK_FIELDS.EARNINGS_YIELD:
            return earningsYieldWorking(values, context);
        default:
            return positionWorking(values, context);
    }
}

// --- the legend -------------------------------------------------------------

// Whether the loaded report needs the legend at all: it appears only when at
// least one stock carries something to decode — a warning emoji, or a light
// that is not the plain 🟢. A clean report stays uncluttered (issue #599's
// pattern for the Low-volume legend).
function hasAnyWarning(rows) {
    if (!Array.isArray(rows)) {
        return false;
    }
    return rows.some((row) => {
        const verdict = row && typeof row === "object" && row.trafficLight
            ? row.trafficLight
            : null;
        if (!verdict) {
            return false;
        }
        const warnings = Array.isArray(verdict.warnings) ? verdict.warnings : [];
        return warnings.length > 0 || verdict.light !== "🟢";
    });
}

// Every glyph the pick columns can show, with the words that decode it: the
// four lights first, then the nine warnings in the shared vocabulary's order.
// `kind` lets the renderer group them; `label` carries the meaning, so the
// legend still reads correctly with images and colour disabled.
function legendEntries() {
    const helper = pickDetails();
    const lights = Object.keys(LIGHTS).map((light) => ({
        kind: "light",
        emoji: light,
        label: `${LIGHTS[light].word} — ${LIGHTS[light].meaning}`,
    }));
    const warnings = Object.keys(helper.WARNINGS).map((key) => ({
        kind: "warning",
        emoji: helper.WARNINGS[key].emoji,
        label: helper.WARNINGS[key].label,
    }));
    return lights.concat(warnings);
}

// The legend markup for below the table. The emoji is `aria-hidden` and the
// wording carries the meaning, so nothing is colour- or glyph-only.
function legendHtml() {
    const items = legendEntries()
        .map((entry) =>
            `<li class="pick-legend-item pick-legend-${escape(entry.kind)}">` +
            `<span class="pick-legend-emoji" aria-hidden="true">${
                escape(entry.emoji)
            }</span> <span class="pick-legend-label">${
                escape(entry.label)
            }</span></li>`
        )
        .join("");
    return '<ul class="pick-legend list-unstyled mb-0">' + items + "</ul>";
}

globalThis.GRQPickWorking = {
    PICK_FIELDS,
    UNKNOWN_LIGHT,
    LIGHTS,
    isPickField,
    working,
    warningLines,
    lightSummary,
    accessibleLightText,
    hasAnyWarning,
    legendEntries,
    legendHtml,
};
