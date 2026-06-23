// Tests for the portfolio "Actual" and "Dividends" show-the-working popovers
// (issue #426).
//
// Two layers are exercised, mirroring portfolio_return_above_cost_of_capital_test.ts:
//   1. The REAL shipped helpers from docs/projection.js — the single source of
//      truth for the equal-weighted Actual figure and its dividend component —
//      driven with fixture inputs and asserted on their RETURN VALUES.
//   2. The ACTUAL shipped markup in docs/app.js — the aggregate-view totals row —
//      parsed to confirm the Actual and Dividends totals render as CSP-clean
//      `.clickable-value` popover triggers in the correct columns.

import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import "../docs/projection.js";

const g = globalThis as unknown as {
  GRQProjection: {
    calculatePerformanceReturn: (
      buyPrice: number,
      currentPrice: number,
      totalDividends?: number,
    ) => number | null;
    calculateIncludedPortfolioPerformance: (
      stocks: Array<
        { buyPrice: number; currentPrice: number; totalDividends?: number }
      >,
    ) => number | null;
    dividendReturnPercent: (
      buyPrice: number,
      totalDividends?: number,
    ) => number | null;
    calculateIncludedPortfolioDividendYield: (
      stocks: Array<
        { buyPrice: number; currentPrice: number; totalDividends?: number }
      >,
    ) => number | null;
  };
};
const GRQProjection = g.GRQProjection;

const APP_JS = "docs/app.js";

// --- pure helper: dividend yield component ---------------------------------

Deno.test("dividendReturnPercent - dividends as a percentage of buy price", () => {
  // $0.10 of dividends on a $10 buy price = 1.0%.
  assertEquals(GRQProjection.dividendReturnPercent(10, 0.1), 1.0);
});

Deno.test("dividendReturnPercent - no dividends -> 0%", () => {
  assertEquals(GRQProjection.dividendReturnPercent(40, 0), 0);
  assertEquals(GRQProjection.dividendReturnPercent(40), 0);
});

Deno.test("dividendReturnPercent - missing/non-positive buy price -> null", () => {
  assertEquals(GRQProjection.dividendReturnPercent(0, 1), null);
  assertEquals(GRQProjection.dividendReturnPercent(-5, 1), null);
});

Deno.test("dividendReturnPercent - ABC 1.0% vs XYZ 0.25% is a 4x ratio", () => {
  const abc = GRQProjection.dividendReturnPercent(10, 0.1) as number; // 1.0%
  const xyz = GRQProjection.dividendReturnPercent(40, 0.1) as number; // 0.25%
  assertAlmostEquals(abc / xyz, 4, 1e-9);
});

// --- pure helper: equal-weighted portfolio dividend yield ------------------

Deno.test("calculateIncludedPortfolioDividendYield - equal-weighted mean of yields", () => {
  const stocks = [
    { buyPrice: 10, currentPrice: 11, totalDividends: 0.1 }, // 1.0%
    { buyPrice: 40, currentPrice: 44, totalDividends: 0.1 }, // 0.25%
  ];
  // (1.0 + 0.25) / 2 = 0.625
  assertAlmostEquals(
    GRQProjection.calculateIncludedPortfolioDividendYield(stocks) as number,
    0.625,
    1e-9,
  );
});

Deno.test("calculateIncludedPortfolioDividendYield - excluded stocks drop out and reweight", () => {
  const stocks = [
    { buyPrice: 10, currentPrice: 11, totalDividends: 0.1 }, // 1.0% (included)
    { buyPrice: 40, currentPrice: 44, totalDividends: 0.1 }, // 0.25% (included)
    { buyPrice: 0, currentPrice: 5, totalDividends: 0.1 }, // excluded (no buy price)
  ];
  // Excluded stock removed entirely -> average over the remaining two only.
  assertAlmostEquals(
    GRQProjection.calculateIncludedPortfolioDividendYield(stocks) as number,
    0.625,
    1e-9,
  );
});

Deno.test("calculateIncludedPortfolioDividendYield - no included stocks -> null", () => {
  assertEquals(
    GRQProjection.calculateIncludedPortfolioDividendYield([
      { buyPrice: 0, currentPrice: 0, totalDividends: 1 },
    ]),
    null,
  );
  assertEquals(
    GRQProjection.calculateIncludedPortfolioDividendYield(
      undefined as unknown as [],
    ),
    null,
  );
});

// --- reconciliation: Actual = price component + dividend component ----------

Deno.test("portfolio Actual reconciles to its price and dividend components", () => {
  const stocks = [
    { buyPrice: 10, currentPrice: 11, totalDividends: 0.1 },
    { buyPrice: 40, currentPrice: 44, totalDividends: 0.1 },
  ];
  const actual = GRQProjection.calculateIncludedPortfolioPerformance(
    stocks,
  ) as number;
  const dividendComponent = GRQProjection
    .calculateIncludedPortfolioDividendYield(stocks) as number;

  // Equal-weighted price return component, computed independently.
  const priceComponent = stocks
    .map((s) => ((s.currentPrice - s.buyPrice) / s.buyPrice) * 100)
    .reduce((sum, v) => sum + v, 0) / stocks.length;

  // Acceptance: the Dividends popover total is exactly the dividend slice of
  // the Actual figure, so price + dividend reconcile to Actual.
  assertAlmostEquals(actual, priceComponent + dividendComponent, 1e-9);
});

Deno.test("portfolio Actual equals the mean of per-stock total returns", () => {
  const stocks = [
    { buyPrice: 10, currentPrice: 11, totalDividends: 0.1 },
    { buyPrice: 40, currentPrice: 44, totalDividends: 0.1 },
  ];
  const perStock = stocks.map((s) =>
    GRQProjection.calculatePerformanceReturn(
      s.buyPrice,
      s.currentPrice,
      s.totalDividends,
    ) as number
  );
  const mean = perStock.reduce((sum, v) => sum + v, 0) / perStock.length;
  assertAlmostEquals(
    GRQProjection.calculateIncludedPortfolioPerformance(stocks) as number,
    mean,
    1e-9,
  );
});

// --- shipped markup: the totals cells land in the right columns ------------

/** Extract the first `<target>.innerHTML = \`...\`` template body containing
 *  every marker in `must`. */
function extractTemplate(src: string, target: string, must: string[]): string {
  const marker = `${target}.innerHTML = \``;
  let from = 0;
  while (true) {
    const start = src.indexOf(marker, from);
    assert(start !== -1, `could not find ${target}.innerHTML matching ${must}`);
    const bodyStart = start + marker.length;
    const end = src.indexOf("`", bodyStart);
    assert(end !== -1, "unterminated template literal");
    const body = src.slice(bodyStart, end);
    if (must.every((m) => body.includes(m))) return body;
    from = end + 1;
  }
}

/** Split a row template into its top-level cells (cells are never nested). */
function cells(rowHtml: string, tag: "td" | "th"): string[] {
  const open = new RegExp(`<${tag}[\\s>]`, "g");
  return rowHtml.split(open).slice(1);
}

const HEADER_MARKERS = [
  "90-Day Target",
  "Gain/Loss",
  "Status/Projection",
  "Dividends",
];

Deno.test("portfolio Actual total sits under the Gain/Loss header", async () => {
  const src = await Deno.readTextFile(APP_JS);
  const headerHtml = extractTemplate(src, "thead", HEADER_MARKERS);
  const totalsHtml = extractTemplate(src, "totalsRow", ["Days Elapsed"]);

  const headerCells = cells(headerHtml, "th");
  const totalsCells = cells(totalsHtml, "td");

  const headerIdx = headerCells.findIndex((c) => c.includes("Gain/Loss (%)"));
  const totalIdx = totalsCells.findIndex((c) =>
    c.includes('data-field="portfolio-actual"')
  );

  assert(headerIdx !== -1, "Gain/Loss header must exist");
  assert(totalIdx !== -1, "portfolio Actual total cell must exist");
  assertEquals(
    totalIdx,
    headerIdx,
    "portfolio Actual total must align with the Gain/Loss header",
  );
});

Deno.test("portfolio Dividends total sits under the Dividends header", async () => {
  const src = await Deno.readTextFile(APP_JS);
  const headerHtml = extractTemplate(src, "thead", HEADER_MARKERS);
  const totalsHtml = extractTemplate(src, "totalsRow", ["Days Elapsed"]);

  const headerCells = cells(headerHtml, "th");
  const totalsCells = cells(totalsHtml, "td");

  const headerIdx = headerCells.findIndex((c) => c.includes("Dividends"));
  const totalIdx = totalsCells.findIndex((c) =>
    c.includes('data-field="portfolio-dividends"')
  );

  assert(headerIdx !== -1, "Dividends header must exist");
  assert(totalIdx !== -1, "portfolio Dividends total cell must exist");
  assertEquals(
    totalIdx,
    headerIdx,
    "portfolio Dividends total must align with the Dividends header",
  );
});

Deno.test("portfolio Actual and Dividends totals are CSP-clean popover triggers", async () => {
  const src = await Deno.readTextFile(APP_JS);
  const totalsHtml = extractTemplate(src, "totalsRow", ["Days Elapsed"]);
  const totalsCells = cells(totalsHtml, "td");

  for (const field of ["portfolio-actual", "portfolio-dividends"]) {
    const cell = totalsCells.find((c) => c.includes(`data-field="${field}"`));
    assert(cell, `${field} totals cell must exist`);
    // Tap-to-view popover via data attributes only — no inline JS handler (#268).
    assert(
      cell.includes("clickable-value"),
      `${field} must be clickable-value`,
    );
    assert(
      cell.includes('data-bs-toggle="popover"'),
      `${field} must trigger a popover`,
    );
    assert(
      cell.includes('data-stock=""'),
      `${field} portfolio total has no single stock`,
    );
    assert(
      !/\bon\w+=/.test(cell),
      `${field} must not use inline JS event handlers`,
    );
  }
});

Deno.test("portfolio Actual and Dividends are routed as portfolio totals (no stock)", async () => {
  const src = await Deno.readTextFile(APP_JS);
  // The clickableValues loop must treat the two new fields as portfolio totals
  // (getWorking called with an empty stock symbol), like portfolio-target.
  assert(
    src.includes('field === "portfolio-actual"'),
    "portfolio-actual must be handled as a portfolio total",
  );
  assert(
    src.includes('field === "portfolio-dividends"'),
    "portfolio-dividends must be handled as a portfolio total",
  );
});
