// Behavioural regression guard for issue #708: charts kept the previous theme's
// colours after a theme switch, leaving canvas-drawn axis/tick/legend/title text
// unreadable (near-white on white after switching to light; dark-on-dark after
// switching to dark).
//
// Root cause: Chart.js paints those colours ONCE at chart build from
// GRQChartTheme.chartTheme(detectTheme()). The theme-change handlers re-themed
// only the DOM market-card titles, never the live chart — the code even noted
// "the chart is not rebuilt on a theme switch". DOM accessibility gates cannot
// inspect canvas pixels, so nothing caught it.
//
// The fix adds GRQChartTheme.applyChartTheme(chart, theme): the single source of
// truth that re-applies every theme-sourced colour (default text, title, legend
// labels, per-axis titles/ticks, grid lines) to a LIVE Chart.js instance and
// repaints it. app.js, trend.js and the shared pop-out chart all call it on the
// theme-toggle click and the prefers-color-scheme change, in both directions.
//
// These tests build a chart-like object coloured for one theme, switch it to the
// other, and assert NO stale colours remain and the chart repainted. They fail
// on the pre-fix code (no applyChartTheme) and pass with the fix — no
// source-text greps, real shipped helper exercised.
import { assert, assertEquals } from "@std/assert";
import "../docs/chart_theme.js";

interface ScaleLike {
  title?: { color?: string };
  ticks?: { color?: string };
  grid?: { color?: string };
}

interface ChartLike {
  updateCount: number;
  update: () => void;
  options: {
    color?: string;
    plugins?: {
      title?: { color?: string };
      legend?: { labels?: { color?: string } };
    };
    scales?: Record<string, ScaleLike>;
  };
}

const g = globalThis as unknown as {
  GRQChartTheme: {
    TEXT: { light: string; dark: string };
    GRID: { light: string; dark: string };
    applyChartTheme: (chart: unknown, theme: unknown) => boolean;
  };
};

const theme = g.GRQChartTheme;

// A chart built the way docs/app.js builds the main dashboard chart: default
// text colour, canvas title, desktop legend, both visible axes (title + ticks +
// grid) — every colour sourced from the given theme bundle.
function buildChart(t: "light" | "dark"): ChartLike {
  const text = theme.TEXT[t];
  const grid = theme.GRID[t];
  const chart: ChartLike = {
    updateCount: 0,
    update() {
      this.updateCount++;
    },
    options: {
      color: text,
      plugins: {
        title: { color: text },
        legend: { labels: { color: text } },
      },
      scales: {
        x: {
          title: { color: text },
          ticks: { color: text },
          grid: { color: grid },
        },
        y: {
          title: { color: text },
          ticks: { color: text },
          grid: { color: grid },
        },
      },
    },
  };
  return chart;
}

// Every theme-sourced colour on the chart, flattened for assertions.
function textColours(chart: ChartLike): string[] {
  const o = chart.options;
  const out: string[] = [];
  if (o.color !== undefined) out.push(o.color);
  if (o.plugins?.title?.color !== undefined) out.push(o.plugins.title.color);
  if (o.plugins?.legend?.labels?.color !== undefined) {
    out.push(o.plugins.legend.labels.color);
  }
  for (const key of Object.keys(o.scales ?? {})) {
    const s = (o.scales ?? {})[key];
    if (s.title?.color !== undefined) out.push(s.title.color);
    if (s.ticks?.color !== undefined) out.push(s.ticks.color);
  }
  return out;
}

function gridColours(chart: ChartLike): string[] {
  const o = chart.options;
  const out: string[] = [];
  for (const key of Object.keys(o.scales ?? {})) {
    const s = (o.scales ?? {})[key];
    if (s.grid?.color !== undefined) out.push(s.grid.color);
  }
  return out;
}

Deno.test("applyChartTheme is published on GRQChartTheme", () => {
  assert(typeof theme.applyChartTheme === "function");
});

Deno.test("light chart switched to dark keeps NO stale light colours", () => {
  const chart = buildChart("light");
  // Sanity: it really starts as a light-themed chart.
  assert(textColours(chart).every((c) => c === theme.TEXT.light));

  const changed = theme.applyChartTheme(chart, "dark");
  assertEquals(changed, true);

  // Every canvas text colour is now the dark colour — the reported bug (stale
  // near-white text on a light page, or here light text left behind) is gone.
  for (const c of textColours(chart)) {
    assertEquals(c, theme.TEXT.dark);
  }
  for (const c of gridColours(chart)) {
    assertEquals(c, theme.GRID.dark);
  }
  // The live chart was repainted.
  assertEquals(chart.updateCount, 1);
});

Deno.test("dark chart switched to light keeps NO stale dark colours", () => {
  const chart = buildChart("dark");
  assert(textColours(chart).every((c) => c === theme.TEXT.dark));

  const changed = theme.applyChartTheme(chart, "light");
  assertEquals(changed, true);

  for (const c of textColours(chart)) {
    assertEquals(c, theme.TEXT.light);
  }
  for (const c of gridColours(chart)) {
    assertEquals(c, theme.GRID.light);
  }
  assertEquals(chart.updateCount, 1);
});

Deno.test("an unknown theme falls back to the readable light palette", () => {
  const chart = buildChart("dark");
  theme.applyChartTheme(chart, "midnight");
  for (const c of textColours(chart)) {
    assertEquals(c, theme.TEXT.light);
  }
});

Deno.test("applyChartTheme is a safe no-op for a missing/half-built chart", () => {
  assertEquals(theme.applyChartTheme(null, "dark"), false);
  assertEquals(theme.applyChartTheme({}, "dark"), false);
  // A chart with no update() must not throw.
  const noUpdate = { options: { color: theme.TEXT.light } };
  assertEquals(theme.applyChartTheme(noUpdate, "dark"), true);
  assertEquals(noUpdate.options.color, theme.TEXT.dark);
});
