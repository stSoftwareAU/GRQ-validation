// Controller for the "Portfolio Actual vs Target over time" Trend view
// (issue #430, milestone #422).
//
// This is the visible feature: a Chart.js line chart trending the portfolio's
// average Actual % against its average Target % over the matured-prediction
// history, so we can see whether predictions improve over time. It is a
// SEPARATE page (docs/trend.html) — the existing per-prediction dashboard
// (docs/index.html) is left completely untouched — reusing the shared modules:
//   - docs/projection.js        shared actuals / target / split kernels,
//   - docs/trend_series.js      matured series + day/week/month/quarter buckets,
//   - docs/trend_predictions.js parse each score date's files → engine inputs,
//   - docs/index_overlay.js     optional benchmark-index overlay datasets,
//   - docs/trend_settings.js    remembers grouping + index toggles,
//   - docs/format.js / theme.js formatting + the Auto/Light/Dark toggle.
//
// The data engine is the single source of truth for the maths; this file only
// loads each matured score date's files, hands the resolved predictions to the
// engine, and renders the result. Re-grouping and toggling indices re-bucket
// the already-loaded series in memory — no re-fetch.

(function () {
    "use strict";

    // Line colours matching the existing dashboard's conventions (docs/app.js):
    // Actual is the blue series, Target the gold series.
    const ACTUAL_COLOUR = "rgba(102, 126, 234, 1)";
    const TARGET_COLOUR = "rgba(255, 193, 7, 1)";

    // Fetch a same-origin text file, returning "" when it is missing or fails
    // (e.g. a score date with no dividend file) so one absent file never breaks
    // the whole view.
    async function fetchText(url) {
        try {
            const response = await fetch(url, { cache: "no-store" });
            if (!response.ok) {
                return "";
            }
            return await response.text();
        } catch (_err) {
            return "";
        }
    }

    // Fetch and parse a same-origin JSON file, returning null on any failure.
    async function fetchJson(url) {
        try {
            const response = await fetch(url, { cache: "no-store" });
            if (!response.ok) {
                return null;
            }
            return await response.json();
        } catch (_err) {
            return null;
        }
    }

    class GRQTrendView {
        constructor() {
            this.today = new Date();
            this.series = []; // matured per-date points from the data engine
            this.scoreDates = []; // matured score-date strings (for the overlay)
            this.marketIndices = null; // docs/market-indices.json contents
            this.chart = null;

            const settings = globalThis.GRQTrendSettings
                ? GRQTrendSettings.readTrendSettings()
                : { grouping: "month", toggles: {} };
            this.granularity = settings.grouping;
            this.toggles = settings.toggles;

            this.elements = {
                loading: document.getElementById("trendLoading"),
                error: document.getElementById("trendError"),
                empty: document.getElementById("trendEmpty"),
                chartCard: document.getElementById("trendChartCard"),
                canvas: document.getElementById("trendChart"),
                groupingSelect: document.getElementById("groupingSelect"),
                overlayControls: document.getElementById("overlayControls"),
            };
        }

        async init() {
            this.buildGroupingControl();
            this.buildOverlayControls();
            try {
                await this.loadData();
            } catch (error) {
                this.showError(
                    "Failed to load trend data: " +
                        (error && error.message ? error.message : error),
                );
                return;
            }
            this.render();
        }

        // Wire the grouping <select> to the persisted choice and re-render on
        // change (default month lives in GRQTrendSettings).
        buildGroupingControl() {
            const select = this.elements.groupingSelect;
            if (!select) {
                return;
            }
            select.value = this.granularity;
            select.addEventListener("change", () => {
                this.granularity = select.value;
                if (globalThis.GRQTrendSettings) {
                    GRQTrendSettings.writeGrouping(this.granularity);
                }
                this.render();
            });
        }

        // Build one on/off checkbox per benchmark index, restored from the
        // persisted toggles. Flipping one re-renders the chart live.
        buildOverlayControls() {
            const container = this.elements.overlayControls;
            const overlay = globalThis.GRQIndexOverlay;
            if (!container || !overlay) {
                return;
            }
            container.replaceChildren();
            for (const index of overlay.OVERLAY_INDICES) {
                const wrapper = document.createElement("div");
                wrapper.className = "form-check form-check-inline";

                const input = document.createElement("input");
                input.className = "form-check-input";
                input.type = "checkbox";
                input.id = "overlay-" + index.key;
                input.checked = Boolean(this.toggles[index.key]);
                input.addEventListener("change", () => {
                    this.toggles = globalThis.GRQTrendSettings
                        ? GRQTrendSettings.setIndexToggle(
                            index.key,
                            input.checked,
                        )
                        : Object.assign({}, this.toggles, {
                            [index.key]: input.checked,
                        });
                    this.render();
                });

                const label = document.createElement("label");
                label.className = "form-check-label";
                label.setAttribute("for", input.id);
                label.textContent = index.name;

                wrapper.append(input, label);
                container.append(wrapper);
            }
        }

        // Load the matured-prediction history: read the score index, keep only
        // matured score dates, fetch each one's files in parallel and resolve
        // them into the engine's prediction inputs.
        async loadData() {
            const index = await fetchJson("scores/index.json");
            const scores = index && Array.isArray(index.scores)
                ? index.scores
                : [];
            const matured = scores.filter((entry) =>
                entry && entry.file && entry.date &&
                GRQTrendSeries.isMaturedScoreDate(entry.date, this.today)
            );

            const predictions = await Promise.all(
                matured.map(async (entry) => {
                    const base = "scores/" + entry.file;
                    const [tsv, csv, dividends] = await Promise.all([
                        fetchText(base),
                        fetchText(base.replace(".tsv", ".csv")),
                        fetchText(base.replace(".tsv", "-dividends.csv")),
                    ]);
                    return GRQTrendPredictions.buildPrediction(
                        entry.date,
                        tsv,
                        csv,
                        dividends,
                    );
                }),
            );

            this.series = GRQTrendSeries.buildMaturedTrendSeries(
                predictions,
                this.today,
            );
            this.scoreDates = matured.map((entry) => entry.date);
            this.marketIndices = await fetchJson("market-indices.json");
        }

        // Active theme ("light"/"dark"), matching styles.css, so the chart text
        // stays legible (and AA-contrasting) in both themes.
        detectTheme() {
            const body = document.body;
            if (body && body.classList.contains("dark-mode-forced")) {
                return "dark";
            }
            if (body && body.classList.contains("light-mode-forced")) {
                return "light";
            }
            const prefersDark = typeof globalThis.matchMedia === "function" &&
                globalThis.matchMedia("(prefers-color-scheme: dark)").matches;
            return prefersDark ? "dark" : "light";
        }

        // Assemble the chart datasets for the current grouping + toggles from the
        // already-loaded series: Actual, Target, then any enabled index overlays.
        buildDatasets() {
            const buckets = GRQTrendSeries.aggregateTrendSeries(
                this.series,
                this.granularity,
            );
            const datasets = [
                {
                    label: "Actual",
                    data: buckets.map((b) => ({ x: b.date, y: b.actualPct })),
                    borderColor: ACTUAL_COLOUR,
                    backgroundColor: "rgba(102, 126, 234, 0.1)",
                    borderWidth: 3,
                    fill: false,
                    pointRadius: 4,
                    tension: 0.2,
                },
                {
                    label: "Target",
                    data: buckets.map((b) => ({ x: b.date, y: b.targetPct })),
                    borderColor: TARGET_COLOUR,
                    backgroundColor: "rgba(255, 193, 7, 0.1)",
                    borderWidth: 3,
                    fill: false,
                    pointRadius: 4,
                    tension: 0.2,
                },
            ];

            const overlay = globalThis.GRQIndexOverlay;
            if (overlay && this.marketIndices) {
                const overlayData = overlay.buildIndexOverlayData(
                    this.scoreDates,
                    this.marketIndices,
                    this.today,
                    this.granularity,
                    this.toggles,
                );
                for (const dataset of overlayData.datasets) {
                    datasets.push({
                        label: dataset.name,
                        data: dataset.points,
                        borderColor: dataset.borderColor || undefined,
                        backgroundColor: dataset.backgroundColor || undefined,
                        borderWidth: 2,
                        borderDash: [6, 4],
                        fill: false,
                        pointRadius: 3,
                        tension: 0.2,
                    });
                }
            }

            return { datasets, bucketCount: buckets.length };
        }

        render() {
            const { datasets, bucketCount } = this.buildDatasets();

            this.hide(this.elements.loading);
            this.hide(this.elements.error);

            // Empty / sparse-data state: fewer than one matured bucket means
            // there is nothing to trend yet.
            if (bucketCount < 1) {
                this.destroyChart();
                this.hide(this.elements.chartCard);
                this.show(this.elements.empty);
                return;
            }

            this.hide(this.elements.empty);
            this.show(this.elements.chartCard);
            this.drawChart(datasets);
        }

        drawChart(datasets) {
            if (!this.elements.canvas || typeof Chart === "undefined") {
                return;
            }
            const theme = this.detectTheme();
            const textColour = theme === "dark" ? "#f8f9fa" : "#212529";
            const gridColour = theme === "dark"
                ? "rgba(255, 255, 255, 0.1)"
                : "rgba(0, 0, 0, 0.1)";

            const data = { datasets };
            const options = {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: "index", intersect: false },
                plugins: {
                    legend: { labels: { color: textColour } },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const value = context.parsed.y;
                                const formatted = globalThis.GRQFormat
                                    ? GRQFormat.formatPercent(value)
                                    : value.toFixed(2) + "%";
                                return context.dataset.label + ": " + formatted;
                            },
                        },
                    },
                },
                scales: {
                    x: {
                        type: "time",
                        time: { unit: this.timeUnit() },
                        ticks: { color: textColour },
                        grid: { color: gridColour },
                        title: {
                            display: true,
                            text: "Prediction date",
                            color: textColour,
                        },
                    },
                    y: {
                        ticks: {
                            color: textColour,
                            callback: (value) => value + "%",
                        },
                        grid: { color: gridColour },
                        title: {
                            display: true,
                            text: "Return (%)",
                            color: textColour,
                        },
                    },
                },
            };

            if (this.chart) {
                this.chart.data = data;
                this.chart.options = options;
                this.chart.update();
            } else {
                this.chart = new Chart(this.elements.canvas, {
                    type: "line",
                    data,
                    options,
                });
            }
        }

        // The Chart.js time-axis unit best matching the current grouping.
        timeUnit() {
            switch (this.granularity) {
                case "day":
                    return "day";
                case "week":
                    return "week";
                case "quarter":
                    return "quarter";
                default:
                    return "month";
            }
        }

        destroyChart() {
            if (this.chart) {
                this.chart.destroy();
                this.chart = null;
            }
        }

        showError(message) {
            this.hide(this.elements.loading);
            this.hide(this.elements.empty);
            this.hide(this.elements.chartCard);
            if (this.elements.error) {
                this.elements.error.textContent = message;
                this.show(this.elements.error);
            }
        }

        show(el) {
            if (el) {
                el.style.display = "";
            }
        }

        hide(el) {
            if (el) {
                el.style.display = "none";
            }
        }
    }

    globalThis.GRQTrendView = GRQTrendView;

    // DOM wiring. Skipped entirely when there is no document (Deno tests).
    if (typeof document === "undefined") {
        return;
    }

    function start() {
        new GRQTrendView().init();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start);
    } else {
        start();
    }
})();
