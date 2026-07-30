// Tests for the issue #553 dividend-basis (flat 1/4 vs windowed) diagnostic.
//
// These exercise the REAL shipped kernels (docs/projection.js) and the real
// aggregation in scripts/dividend_basis_diagnostic.ts with synthetic data,
// asserting on computed results — not source text.

import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertThrows,
} from "@std/assert";
import { fromFileUrl } from "@std/path";
import "../docs/projection.js";
import "../docs/trend_predictions.js";
import {
  aggregateDate,
  buildReport,
  computeDividendBasisDiagnostic,
  type DateAggregate,
  DIVIDEND_DATA_PATH_ENV,
  DIVIDENDS_ROOT_USAGE,
  requireDividendsRoot,
  stripSymbol,
  summariseDiffs,
  trimmedMean,
} from "../scripts/dividend_basis_diagnostic.ts";

// deno-lint-ignore no-explicit-any
const P = (globalThis as any).GRQProjection;

function midnight(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

Deno.test("trailingAnnualDividends sums the year ending at the score date", () => {
  const scoreDate = midnight("2026-01-01");
  const divs = [
    { exDivDate: midnight("2025-02-15"), amount: 0.25 }, // in trailing year
    { exDivDate: midnight("2025-05-15"), amount: 0.25 }, // in trailing year
    { exDivDate: midnight("2025-08-15"), amount: 0.25 }, // in trailing year
    { exDivDate: midnight("2025-11-15"), amount: 0.25 }, // in trailing year
    { exDivDate: midnight("2026-02-15"), amount: 0.30 }, // after score date
    { exDivDate: midnight("2024-06-15"), amount: 0.20 }, // before the year
  ];
  assertAlmostEquals(P.trailingAnnualDividends(divs, scoreDate), 1.0, 1e-9);
});

Deno.test("trailingAnnualDividends boundaries: includes score date, excludes -365", () => {
  const scoreDate = midnight("2026-01-01");
  // exactly 365 days before score date -> excluded (strictly greater than).
  const onYearStart = { exDivDate: midnight("2025-01-01"), amount: 1 };
  // on the score date -> included.
  const onScoreDate = { exDivDate: midnight("2026-01-01"), amount: 2 };
  assertAlmostEquals(
    P.trailingAnnualDividends([onYearStart, onScoreDate], scoreDate),
    2,
    1e-9,
  );
});

Deno.test("trailingAnnualDividends returns 0 for empty/invalid input", () => {
  assertEquals(P.trailingAnnualDividends([], midnight("2026-01-01")), 0);
  assertEquals(P.trailingAnnualDividends(null, midnight("2026-01-01")), 0);
  assertEquals(P.trailingAnnualDividends([{ amount: 1 }], "nope"), 0);
});

Deno.test("dividendBasisDifferencePercent computes (flat - windowed)/buy*100", () => {
  // buy 100, flat 0.50, windowed 0.25 -> (0.25)/100*100 = 0.25 pp.
  assertAlmostEquals(P.dividendBasisDifferencePercent(0.5, 0.25, 100), 0.25);
  // flat == windowed -> zero difference.
  assertEquals(P.dividendBasisDifferencePercent(0.4, 0.4, 100), 0);
  // windowed exceeds flat -> negative (the offsetting direction).
  assertAlmostEquals(P.dividendBasisDifferencePercent(0.2, 0.6, 100), -0.4);
});

Deno.test("dividendBasisDifferencePercent guards bad inputs", () => {
  assertEquals(P.dividendBasisDifferencePercent(0.5, 0.25, 0), null);
  assertEquals(P.dividendBasisDifferencePercent(0.5, 0.25, -5), null);
  assertEquals(P.dividendBasisDifferencePercent(null, 0.25, 100), null);
  assertEquals(P.dividendBasisDifferencePercent(0.5, NaN, 100), null);
});

Deno.test("stripSymbol drops the exchange prefix and normalises dots", () => {
  assertEquals(stripSymbol("NYSE:SEM"), "SEM");
  assertEquals(stripSymbol("NASDAQ:IBKR"), "IBKR");
  assertEquals(stripSymbol("HEI.A"), "HEI-A");
  assertEquals(stripSymbol("PLAIN"), "PLAIN");
});

Deno.test("summariseDiffs computes mean/median/min/max/stdDev", () => {
  const s = summariseDiffs([1, 2, 3, 4]);
  assertEquals(s.count, 4);
  assertAlmostEquals(s.mean, 2.5);
  assertAlmostEquals(s.median, 2.5);
  assertEquals(s.min, 1);
  assertEquals(s.max, 4);
  assertAlmostEquals(s.stdDev, Math.sqrt(1.25));
});

Deno.test("summariseDiffs handles empty input", () => {
  const s = summariseDiffs([]);
  assertEquals(s, { count: 0, mean: 0, median: 0, min: 0, max: 0, stdDev: 0 });
});

Deno.test("trimmedMean drops the extreme tails so a single outlier cannot dominate", () => {
  // Without trimming the +100 outlier dominates; trimming 10% each side at this
  // size drops exactly the min and max, leaving a robust central mean of 0.
  const values = [-100, 0, 0, 0, 0, 0, 0, 0, 0, 100];
  assertAlmostEquals(trimmedMean(values, 0.0), 0); // 10 values, mean 0 anyway
  assertAlmostEquals(trimmedMean(values, 0.1), 0); // drops -100 and +100
  // A right-skewed set: raw mean is pulled up, trimmed mean is lower.
  const skew = [0, 0, 0, 0, 0, 0, 0, 0, 0, 50];
  assert(trimmedMean(skew, 0.0) > trimmedMean(skew, 0.1));
});

Deno.test("trimmedMean handles empty input", () => {
  assertEquals(trimmedMean([], 0.01), 0);
});

Deno.test("aggregateDate measures flat-vs-windowed difference for a semi-annual payer", () => {
  const scoreDate = midnight("2026-01-01");
  // One stock, buy ~100. Pays semi-annually: trailing year has two 0.50
  // dividends (annual 1.00 -> flat quarter 0.25). The forward 90-day window
  // catches NONE of its dividends (next pays in 2026-06), so windowed = 0.
  const scoreRows = [{
    stock: "NYSE:X",
    target: 130,
    score: 1,
    dividendPerShare: 0,
  }];
  const marketData = {
    "NYSE:X": [
      {
        date: midnight("2026-01-02"),
        high: 101,
        low: 99,
        open: 100,
        close: 100,
        splitCoefficient: 1,
      },
      {
        date: midnight("2026-03-30"),
        high: 120,
        low: 100,
        open: 110,
        close: 115,
        splitCoefficient: 1,
      },
    ],
  };
  // Committed in-window dividend CSV: empty for X over this window.
  const windowedDividends = {};
  // Full trailing history keyed by STRIPPED symbol.
  const fullHistory = {
    X: [
      { exDivDate: midnight("2025-06-15"), amount: 0.5 },
      { exDivDate: midnight("2025-12-15"), amount: 0.5 },
    ],
  };
  const agg = aggregateDate(
    "2026-01-01",
    scoreRows,
    marketData,
    windowedDividends,
    fullHistory,
    scoreDate,
  );
  // buyPrice = mid of 2026-01-02 = 100. flat = 1.00/4 = 0.25, windowed = 0.
  // diff = (0.25 - 0)/100 * 100 = 0.25 pp.
  assertEquals(agg.includedCount, 1);
  assertEquals(agg.rowDiffsPp.length, 1);
  assertAlmostEquals(agg.rowDiffsPp[0], 0.25, 1e-9);
  assertEquals(agg.windowedZeroCount, 1);
  assertAlmostEquals(agg.flatYieldsPct[0], 0.25, 1e-9);
  assertAlmostEquals(agg.windowedYieldsPct[0], 0, 1e-9);
});

Deno.test("aggregateDate: a quarterly payer with one in-window dividend nets near zero", () => {
  const scoreDate = midnight("2026-01-01");
  const scoreRows = [{
    stock: "NYSE:Q",
    target: 130,
    score: 1,
    dividendPerShare: 0,
  }];
  const marketData = {
    "NYSE:Q": [
      {
        date: midnight("2026-01-02"),
        high: 101,
        low: 99,
        open: 100,
        close: 100,
        splitCoefficient: 1,
      },
      {
        date: midnight("2026-03-30"),
        high: 110,
        low: 100,
        open: 105,
        close: 108,
        splitCoefficient: 1,
      },
    ],
  };
  // One realised in-window dividend of 0.25 (ex-div 2026-02-15 <= horizon).
  const windowedDividends = {
    "NYSE:Q": [{ exDivDate: midnight("2026-02-15"), amount: 0.25 }],
  };
  // Trailing year: four 0.25 quarterly dividends -> flat quarter 0.25.
  const fullHistory = {
    Q: [
      { exDivDate: midnight("2025-02-15"), amount: 0.25 },
      { exDivDate: midnight("2025-05-15"), amount: 0.25 },
      { exDivDate: midnight("2025-08-15"), amount: 0.25 },
      { exDivDate: midnight("2025-11-15"), amount: 0.25 },
    ],
  };
  const agg = aggregateDate(
    "2026-01-01",
    scoreRows,
    marketData,
    windowedDividends,
    fullHistory,
    scoreDate,
  );
  // flat 0.25, windowed 0.25 -> diff 0.
  assertEquals(agg.rowDiffsPp.length, 1);
  assertAlmostEquals(agg.rowDiffsPp[0], 0, 1e-9);
  assertEquals(agg.windowedZeroCount, 0);
});

Deno.test("buildReport: positive mean difference contributes to (widens) the gap", () => {
  const aggregates: DateAggregate[] = [
    {
      date: "2026-01-01",
      rowDiffsPp: [0.25, 0.10],
      flatYieldsPct: [0.25, 0.10],
      windowedYieldsPct: [0, 0],
      windowedZeroCount: 2,
      includedCount: 2,
    },
    {
      date: "2026-02-01",
      rowDiffsPp: [0.05, -0.05],
      flatYieldsPct: [0.30, 0.20],
      windowedYieldsPct: [0.25, 0.25],
      windowedZeroCount: 0,
      includedCount: 2,
    },
  ];
  const r = buildReport(aggregates);
  assertEquals(r.maturedDates, 2);
  assertEquals(r.rowCount, 4);
  assertAlmostEquals(r.meanDiffPp, (0.25 + 0.10 + 0.05 - 0.05) / 4); // 0.0875
  // Equal-weight per-row mean is the portfolio-level contribution.
  assertAlmostEquals(r.contributionPp, r.meanDiffPp);
  assert(r.contributionPp > 0, "flat > windowed should WIDEN the gap");
  // 2 of 4 rows realised zero in-window dividends.
  assertAlmostEquals(r.windowedZeroSharePct, 50);
  // All four rows are within +/-1 pp here.
  assertAlmostEquals(r.within1ppSharePct, 100);
  assert(Number.isFinite(r.trimmedMeanDiffPp), "trimmed mean is reported");
  assert(
    r.verdict.includes("CONTRIBUTES") && r.verdict.includes("flat training"),
    "verdict states the contributing direction",
  );
});

// --- Issue #805: the dividend-history root is REQUIRED, never defaulted. ---

Deno.test("requireDividendsRoot prefers the explicit argument over the environment", () => {
  assertEquals(
    requireDividendsRoot("/opt/history", "/env/history"),
    "/opt/history",
  );
  assertEquals(requireDividendsRoot("/opt/history", undefined), "/opt/history");
});

Deno.test("requireDividendsRoot falls back to the environment variable", () => {
  assertEquals(requireDividendsRoot(undefined, "/env/history"), "/env/history");
  // A blank/whitespace argument counts as "not supplied", not as an empty root.
  assertEquals(requireDividendsRoot("   ", "/env/history"), "/env/history");
});

Deno.test("requireDividendsRoot fails loud when no root is supplied", () => {
  // No silent fallback to a sibling checkout: the caller MUST supply a root.
  const err = assertThrows(
    () => requireDividendsRoot(undefined, undefined),
    Error,
  );
  assertEquals(err.message, DIVIDENDS_ROOT_USAGE);
  assertThrows(() => requireDividendsRoot("", "  "), Error);
});

Deno.test("the missing-root usage text names the argument, the variable and the layout", () => {
  assert(
    DIVIDENDS_ROOT_USAGE.includes("dividendsRoot"),
    "usage names the positional argument",
  );
  assert(
    DIVIDENDS_ROOT_USAGE.includes(DIVIDEND_DATA_PATH_ENV),
    "usage names the environment variable",
  );
  assert(
    DIVIDENDS_ROOT_USAGE.includes(
      "<root>/data/<UPPERCASE-FIRST-LETTER>/<SYMBOL>.json",
    ),
    "usage documents the expected on-disk layout",
  );
  assert(
    DIVIDENDS_ROOT_USAGE.includes("{ exDivDate, amount }"),
    "usage documents the record shape",
  );
  assertEquals(DIVIDEND_DATA_PATH_ENV, "GRQ_DIVIDEND_DATA_PATH");
});

Deno.test("computeDividendBasisDiagnostic reads an explicitly supplied root", async () => {
  // End-to-end over a committed fixture root (see tests/fixtures/README.md):
  // NYSE:X flat 0.25 / windowed 0 -> +0.25 pp; NYSE:Q flat 0.25 / windowed 0.25
  // -> 0 pp; both buy at 100. The second index date is not yet matured at the
  // as-of date, so exactly one date contributes.
  const fixture = fromFileUrl(
    new URL("./fixtures/dividend_basis/", import.meta.url),
  );
  const report = await computeDividendBasisDiagnostic(
    `${fixture}docs`,
    midnight("2026-06-01"),
    `${fixture}dividend-history`,
  );
  assertEquals(report.maturedDates, 1);
  assertEquals(report.rowCount, 2);
  assertAlmostEquals(report.meanDiffPp, 0.125, 1e-9);
  assertAlmostEquals(report.maxDiffPp, 0.25, 1e-9);
  assertAlmostEquals(report.minDiffPp, 0, 1e-9);
  assertAlmostEquals(report.meanFlatYieldPct, 0.25, 1e-9);
  assertAlmostEquals(report.meanWindowedYieldPct, 0.125, 1e-9);
  assertAlmostEquals(report.windowedZeroSharePct, 50, 1e-9);
  assert(report.verdict.includes("CONTRIBUTES"));
});

Deno.test("computeDividendBasisDiagnostic yields a zero flat credit for an unknown root", async () => {
  // A root with no matching history files is not an error: every ticker simply
  // contributes a 0 flat credit. This is the behaviour that used to hide the
  // missing private sibling checkout, which is why the root is now required.
  const fixture = fromFileUrl(
    new URL("./fixtures/dividend_basis/", import.meta.url),
  );
  const report = await computeDividendBasisDiagnostic(
    `${fixture}docs`,
    midnight("2026-06-01"),
    `${fixture}no-such-history`,
  );
  assertEquals(report.rowCount, 2);
  assertAlmostEquals(report.meanFlatYieldPct, 0, 1e-9);
  assertAlmostEquals(report.meanDiffPp, -0.125, 1e-9);
});

Deno.test("buildReport: realised dividends exceeding the flat quarter OFFSET the gap", () => {
  const aggregates: DateAggregate[] = [
    {
      date: "2026-01-01",
      rowDiffsPp: [-0.40, -0.20],
      flatYieldsPct: [0.20, 0.10],
      windowedYieldsPct: [0.60, 0.30],
      windowedZeroCount: 0,
      includedCount: 2,
    },
  ];
  const r = buildReport(aggregates);
  assert(r.contributionPp < 0);
  assert(
    r.verdict.includes("OFFSETS"),
    "verdict states the offsetting direction",
  );
});
