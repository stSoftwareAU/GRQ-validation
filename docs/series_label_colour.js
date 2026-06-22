// Series title/label colour derivation for the market index cards (issue #278,
// milestone #269 item A).
//
// Problem: a market series' title/label colour did not match its chart line
// colour — the cards used hard-coded Bootstrap classes (text-primary, etc.)
// that were unrelated to the lines actually drawn. This module derives each
// title's colour from the SAME single source of truth the colour key reads:
// the Chart.js dataset's own `borderColor` (see docs/color_key.js). So the
// title always agrees with the line.
//
// The raw line colours are tuned for a chart line (semi-transparent, mid-tone)
// and would not always clear WCAG 2 AA text contrast (4.5:1) against the card
// background. `accessibleColour` keeps the line's hue but darkens it (light
// theme) or lightens it (dark theme) just enough to clear AA, so the title is
// recognisably the same colour as the line yet remains readable in both themes.
//
// Like docs/color_key.js and docs/projection.js this is a PURE classic script:
// no module syntax, helpers published on `globalThis`, so the browser dashboard
// (via app.js) and the Deno tests exercise the exact same code.

// Card backgrounds the title sits on, per theme. Light cards are effectively
// white; the dark card is a gradient — we take its LIGHTER stop (#262b33) as
// the worst case for a light foreground, so clearing AA here clears it across
// the whole gradient (see docs/styles.css .market-index-card).
const LIGHT_BG = { r: 255, g: 255, b: 255 };
const DARK_BG = { r: 0x26, g: 0x2b, b: 0x33 };

// Minimum WCAG 2 AA contrast for normal-size text.
const AA_CONTRAST = 4.5;

// Parse a CSS colour into 0-255 channels plus alpha. Accepts the forms the
// dashboard actually uses: rgb()/rgba() and #rgb/#rrggbb hex. Returns null for
// anything unparseable so callers can skip it.
function parseRgb(colour) {
    if (typeof colour !== "string") return null;
    const text = colour.trim();

    const rgbMatch = text.match(
        /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i,
    );
    if (rgbMatch) {
        const r = Number(rgbMatch[1]);
        const g = Number(rgbMatch[2]);
        const b = Number(rgbMatch[3]);
        const a = rgbMatch[4] === undefined ? 1 : Number(rgbMatch[4]);
        if ([r, g, b, a].some((n) => !Number.isFinite(n))) return null;
        return { r, g, b, a };
    }

    const hexMatch = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hexMatch) {
        let hex = hexMatch[1];
        if (hex.length === 3) {
            hex = hex.split("").map((c) => c + c).join("");
        }
        return {
            r: parseInt(hex.slice(0, 2), 16),
            g: parseInt(hex.slice(2, 4), 16),
            b: parseInt(hex.slice(4, 6), 16),
            a: 1,
        };
    }

    return null;
}

// sRGB 0-255 channel -> linear-light component, per the WCAG relative-luminance
// definition.
function channelToLinear(value) {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

// WCAG relative luminance of an {r,g,b} colour (0 = black, 1 = white).
function relativeLuminance(rgb) {
    return (
        0.2126 * channelToLinear(rgb.r) +
        0.7152 * channelToLinear(rgb.g) +
        0.0722 * channelToLinear(rgb.b)
    );
}

// WCAG contrast ratio between two opaque colours (1:1 .. 21:1).
function contrastRatio(a, b) {
    const la = relativeLuminance(a);
    const lb = relativeLuminance(b);
    const lighter = Math.max(la, lb);
    const darker = Math.min(la, lb);
    return (lighter + 0.05) / (darker + 0.05);
}

function clampChannel(n) {
    return Math.max(0, Math.min(255, Math.round(n)));
}

// Scale a colour toward black (factor < 1) preserving hue: each channel is
// multiplied by the same factor, so the ratios between R/G/B are unchanged.
function darken(rgb, factor) {
    return {
        r: clampChannel(rgb.r * factor),
        g: clampChannel(rgb.g * factor),
        b: clampChannel(rgb.b * factor),
    };
}

// Blend a colour toward white by `amount` (0 = unchanged, 1 = white). Keeps the
// hue's relative ordering while raising luminance for the dark theme.
function lighten(rgb, amount) {
    return {
        r: clampChannel(rgb.r + (255 - rgb.r) * amount),
        g: clampChannel(rgb.g + (255 - rgb.g) * amount),
        b: clampChannel(rgb.b + (255 - rgb.b) * amount),
    };
}

// Derive an AA-compliant title colour from a chart line colour, for the given
// theme ("light" | "dark"). The hue is preserved (the title stays the same
// colour family as the line); only lightness is nudged until the contrast
// against the theme's card background clears AA. Returns a CSS "rgb(r, g, b)"
// string, or "" if the input colour cannot be parsed.
function accessibleColour(colour, theme) {
    const parsed = parseRgb(colour);
    if (parsed === null) return "";

    const isDark = theme === "dark";
    const bg = isDark ? DARK_BG : LIGHT_BG;

    // Start from the opaque hue (drop the line's transparency).
    let rgb = { r: parsed.r, g: parsed.g, b: parsed.b };

    // Step lightness in small increments until AA is met (or we bottom/top out).
    // 40 steps of 0.025 spans the full range, so this always terminates.
    for (let i = 0; i <= 40 && contrastRatio(rgb, bg) < AA_CONTRAST; i++) {
        const base = { r: parsed.r, g: parsed.g, b: parsed.b };
        rgb = isDark ? lighten(base, i * 0.025) : darken(base, 1 - i * 0.025);
    }

    return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
}

// Find the chart line colour paired with a title `label`, reading the live
// Chart.js datasets — the single source of truth shared with docs/color_key.js.
// Matches by trimmed, case-insensitive label. Returns the dataset's raw
// `borderColor` string, or "" when there is no usable match.
function lookupSeriesColour(datasets, label) {
    if (!Array.isArray(datasets)) return "";
    if (typeof label !== "string") return "";
    const wanted = label.trim().toLowerCase();
    if (wanted === "") return "";

    for (const dataset of datasets) {
        if (!dataset || typeof dataset !== "object") continue;
        const dsLabel = typeof dataset.label === "string"
            ? dataset.label.trim().toLowerCase()
            : "";
        if (dsLabel !== wanted) continue;

        const colour = typeof dataset.borderColor === "string"
            ? dataset.borderColor.trim()
            : "";
        return colour;
    }
    return "";
}

// Convenience: look up a series' line colour by label and return the
// AA-compliant title colour for the given theme. Returns "" when the series is
// absent, so the caller leaves the title at its default rather than recolouring
// it to nothing.
function seriesLabelColour(datasets, label, theme) {
    const line = lookupSeriesColour(datasets, label);
    if (line === "") return "";
    return accessibleColour(line, theme);
}

// Publish on globalThis so the browser dashboard (classic script) and the Deno
// tests both reach the exact same helpers, mirroring docs/color_key.js.
globalThis.GRQSeriesLabelColour = {
    LIGHT_BG,
    DARK_BG,
    AA_CONTRAST,
    parseRgb,
    relativeLuminance,
    contrastRatio,
    accessibleColour,
    lookupSeriesColour,
    seriesLabelColour,
};
