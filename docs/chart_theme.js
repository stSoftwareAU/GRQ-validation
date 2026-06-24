// Themed colours for Chart.js-drawn CANVAS text — the single source of truth
// shared by the main dashboard chart (docs/app.js) and tested by
// tests/chart_theme_contrast_test.ts (issue #497, part of milestone #484).
//
// Why this exists: chart titles, axis titles, tick labels and legend labels are
// painted onto the <canvas>, NOT the DOM. DOM-based accessibility checkers
// (pa11y / axe) fundamentally cannot inspect canvas pixels for contrast, so the
// previous hard-coded `color: '#333'` chart title slipped past the a11y gate
// and was effectively invisible on the dark card background. Centralising the
// canvas text/grid colours here lets a Deno test assert they clear WCAG 2.1 AA
// contrast against the chart's card background, in both themes — closing the
// gap the DOM gate cannot cover.
//
// Like docs/color_key.js, docs/projection.js and docs/series_label_colour.js
// this is a PURE classic script: no module syntax, helpers published on
// `globalThis`, so the browser dashboard (via app.js) and the Deno tests
// exercise the exact same colours.

(function () {
    // The card surface the chart canvas sits on, per theme (docs/styles.css:
    // the light card is effectively white; the dark `.card` uses
    // --grq-surface #1e2228, and the gradient market cards lighten to #262b33).
    // We measure contrast against the LIGHTER dark stop (#262b33) as the worst
    // case for light text, so clearing AA here clears it on the darker surface
    // too — matching the convention in docs/series_label_colour.js.
    const BACKGROUNDS = {
        light: "#ffffff",
        dark: "#262b33",
    };

    // Foreground colour for canvas-drawn text (title, axis titles, ticks,
    // legend labels), per theme. Matches the values docs/trend.js already uses
    // so both charts read identically.
    const TEXT = {
        light: "#212529",
        dark: "#f8f9fa",
    };

    // Grid line colour per theme. Grid lines are decorative structure, not text,
    // so they are intentionally low-contrast and exempt from the AA text rule.
    const GRID = {
        light: "rgba(0, 0, 0, 0.1)",
        dark: "rgba(255, 255, 255, 0.1)",
    };

    // Minimum WCAG 2.1 AA contrast for normal-size text.
    const AA_CONTRAST = 4.5;

    // Anything that is not exactly "dark" falls back to the light theme, so a
    // missing/unknown theme can never silently pick the dark (low-contrast on a
    // light page) palette.
    function normaliseTheme(theme) {
        return theme === "dark" ? "dark" : "light";
    }

    function chartTextColour(theme) {
        return TEXT[normaliseTheme(theme)];
    }

    function chartGridColour(theme) {
        return GRID[normaliseTheme(theme)];
    }

    function chartBackground(theme) {
        return BACKGROUNDS[normaliseTheme(theme)];
    }

    // Convenience bundle for a Chart.js options builder.
    function chartTheme(theme) {
        const t = normaliseTheme(theme);
        return { text: TEXT[t], grid: GRID[t], background: BACKGROUNDS[t] };
    }

    globalThis.GRQChartTheme = {
        BACKGROUNDS,
        TEXT,
        GRID,
        AA_CONTRAST,
        chartTextColour,
        chartGridColour,
        chartBackground,
        chartTheme,
    };
})();
