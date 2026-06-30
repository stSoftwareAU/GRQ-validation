// Market-data fail-loud quality gate (issue #675, quality gate form 3/3 of
// #671).
//
// Regression context: GRQValidator.loadMarketData() (docs/app.js) used to set
// `this.marketData = null` on every failure path — a fetch failure, an empty
// file, a header-only / zero-data-row CSV, or a parse error — and the dashboard
// then quietly rendered the soft "Limited data mode" placeholder. A broken data
// pipeline therefore looked like a normal (if sparse) dashboard and could pass
// unnoticed.
//
// This gate drives the REAL shared kernel
// GRQTrendPredictions.classifyMarketLoad() — the single source of truth that
// loadMarketData() and updateDisplay() both consume — over the REAL on-disk
// CSVs and over the exact silent-degradation shapes, asserting that every fault
// is classified as a VISIBLE, DISTINCT error state with an actionable reason,
// and that genuinely-full market data is classified as healthy.

import { assert, assertEquals } from "@std/assert";
import "../docs/projection.js";
import "../docs/trend_series.js";
import "../docs/trend_predictions.js";

interface MarketLoadState {
  state: "ok" | "error";
  reason: string;
  message?: string;
  tickerCount?: number;
  rowCount?: number;
}

const GRQTrendPredictions = (globalThis as unknown as {
  GRQTrendPredictions: {
    classifyMarketLoad: (
      input: { fetchOk?: boolean; text?: string | null },
    ) => MarketLoadState;
  };
}).GRQTrendPredictions;

const SCORES_DIR = "docs/scores";

interface ScoreIndexEntry {
  file: string;
  date: string;
}

async function loadScoreIndex(): Promise<ScoreIndexEntry[]> {
  const text = await Deno.readTextFile(`${SCORES_DIR}/index.json`);
  return JSON.parse(text).scores as ScoreIndexEntry[];
}

async function marketCsvFor(entry: ScoreIndexEntry): Promise<string | null> {
  const csvPath = `${SCORES_DIR}/${entry.file.replace(".tsv", ".csv")}`;
  try {
    return await Deno.readTextFile(csvPath);
  } catch {
    return null;
  }
}

// The published date carrying the most market-data rows: a date that
// unambiguously HAS full market data, chosen dynamically so the gate survives
// score files being added/renamed.
async function fullestMarketCsv(): Promise<
  { entry: ScoreIndexEntry; text: string; tickerCount: number }
> {
  const index = await loadScoreIndex();
  let best:
    | { entry: ScoreIndexEntry; text: string; tickerCount: number }
    | null = null;
  for (const entry of index) {
    const text = await marketCsvFor(entry);
    if (text === null) continue;
    const state = GRQTrendPredictions.classifyMarketLoad({
      fetchOk: true,
      text,
    });
    const tickerCount = state.tickerCount ?? 0;
    if (!best || tickerCount > best.tickerCount) {
      best = { entry, text, tickerCount };
    }
  }
  assert(best !== null, "no published score date has a readable market CSV");
  return best;
}

Deno.test("classifyMarketLoad: a date with full market data is healthy (ok)", async () => {
  const { entry, text } = await fullestMarketCsv();
  const state = GRQTrendPredictions.classifyMarketLoad({ fetchOk: true, text });

  assertEquals(
    state.state,
    "ok",
    `full market data for ${entry.date} must classify as healthy, not a fault`,
  );
  assertEquals(state.reason, "ok");
  assert(
    (state.tickerCount ?? 0) > 5,
    `expected the fullest market CSV (${entry.date}) to carry many tickers, got ${state.tickerCount}`,
  );
  assert((state.rowCount ?? 0) > 0, "healthy data must carry market rows");
});

Deno.test("classifyMarketLoad: a failed fetch is a loud, distinct fault", () => {
  const state = GRQTrendPredictions.classifyMarketLoad({ fetchOk: false });
  assertEquals(state.state, "error");
  assertEquals(state.reason, "fetch-failed");
  assert(
    (state.message ?? "").length > 0,
    "fault must carry an actionable message",
  );
});

Deno.test("classifyMarketLoad: an empty file is a loud, distinct fault", () => {
  for (const text of ["", "   ", "\n\n", null]) {
    const state = GRQTrendPredictions.classifyMarketLoad({
      fetchOk: true,
      text,
    });
    assertEquals(state.state, "error", `empty text ${JSON.stringify(text)}`);
    assertEquals(state.reason, "empty-file");
  }
});

Deno.test("classifyMarketLoad: a header-only / zero-row CSV is a loud, distinct fault (not Limited data mode)", () => {
  // The exact #671 silent-degradation shape: the file exists, has a header, but
  // carries no market rows. Previously this parsed to {} and rendered the soft
  // "Limited data mode" placeholder.
  const headerOnly = "date,ticker,high,low,open,close,split_coefficient\n";
  const state = GRQTrendPredictions.classifyMarketLoad({
    fetchOk: true,
    text: headerOnly,
  });
  assertEquals(state.state, "error");
  assertEquals(state.reason, "no-data-rows");
});

Deno.test("classifyMarketLoad: a real fault is never silently treated as healthy", () => {
  // Garbage / rows with no ticker parse to no usable data — must be a fault, not
  // a vacuous "ok".
  const garbage = "date,ticker,high\nnot,,a,real,row\n,,,\n";
  const state = GRQTrendPredictions.classifyMarketLoad({
    fetchOk: true,
    text: garbage,
  });
  assertEquals(state.state, "error");
  assert(
    state.reason !== "ok",
    "a CSV with no usable rows must classify as a fault",
  );
});

// --- Render mirror -------------------------------------------------------
//
// GRQValidator.updateDisplay() (docs/app.js) renders a fault via
// showMarketDataError(), which is heavily DOM-coupled. Mirroring the sibling
// smoke test (tests/dashboard_limited_data_smoke_test.ts), this faithfully
// reproduces that render decision over a minimal DOM stand-in so we can assert
// the stable hook a smoke test relies on: a genuine fault must render the loud
// `.market-data-error` / `data-market-data-state="error"` hook and must NOT
// render the soft `.limited-data-message` placeholder.

class FakeElement {
  className = "";
  innerHTML = "";
  private readonly attrs: Record<string, string> = {};

  classList = {
    add: (c: string) => {
      const set = new Set(this.className.split(/\s+/).filter(Boolean));
      set.add(c);
      this.className = [...set].join(" ");
    },
  };

  setAttribute(name: string, value: string): void {
    this.attrs[name] = value;
  }

  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }

  hasClass(c: string): boolean {
    return this.className.split(/\s+/).filter(Boolean).includes(c);
  }
}

// Faithful copy of updateDisplay()'s fault branch + showMarketDataError()
// (docs/app.js): a genuine fault renders the loud error hook; a healthy load
// leaves it absent. Returns the #error stand-in after the render decision.
function renderFaultRegion(
  marketDataError: MarketLoadState | null,
): FakeElement {
  const errorEl = new FakeElement();
  if (marketDataError && marketDataError.state === "error") {
    const reason = marketDataError.reason || "unknown";
    errorEl.classList.add("market-data-error");
    errorEl.setAttribute("data-market-data-state", "error");
    errorEl.setAttribute("data-market-data-reason", reason);
    errorEl.innerHTML =
      `<strong>Market data unavailable — data fault.</strong> ${
        marketDataError.message ?? ""
      }`;
  }
  return errorEl;
}

Deno.test("render: a data fault shows the loud error hook, not Limited data mode", () => {
  const fault = GRQTrendPredictions.classifyMarketLoad({ fetchOk: false });
  const errorEl = renderFaultRegion(fault);

  assert(
    errorEl.hasClass("market-data-error"),
    "fault must add the .market-data-error hook",
  );
  assertEquals(errorEl.getAttribute("data-market-data-state"), "error");
  assertEquals(errorEl.getAttribute("data-market-data-reason"), "fetch-failed");
  assert(
    !errorEl.innerHTML.includes("Limited data mode"),
    "a fault must NOT degrade to the soft Limited data mode placeholder",
  );
  assert(
    errorEl.innerHTML.includes("data fault"),
    "the loud error must clearly signal a data fault",
  );
});

Deno.test("render: healthy data leaves the loud error hook absent", () => {
  const errorEl = renderFaultRegion(null);
  assert(
    !errorEl.hasClass("market-data-error"),
    "healthy data must not carry the data-fault hook",
  );
  assertEquals(errorEl.getAttribute("data-market-data-state"), null);
});

Deno.test("classifyMarketLoad: distinct reasons keep the fault actionable", () => {
  const reasons = new Set([
    GRQTrendPredictions.classifyMarketLoad({ fetchOk: false }).reason,
    GRQTrendPredictions.classifyMarketLoad({ fetchOk: true, text: "" }).reason,
    GRQTrendPredictions.classifyMarketLoad({
      fetchOk: true,
      text: "date,ticker,high,low,open,close,split_coefficient\n",
    }).reason,
  ]);
  // Three different fault shapes must produce three distinguishable reasons so
  // the surfaced error names the actual problem.
  assertEquals(
    reasons.size,
    3,
    `expected distinct reasons, got ${[...reasons]}`,
  );
});
