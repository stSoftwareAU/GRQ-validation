// Tests for the portfolio "Return above Cost of Capital" total + popover
// (issue #407).
//
// Two layers are exercised:
//   1. The REAL shipped helpers from docs/projection.js — the single source of
//      truth for the cost-of-capital hurdle and the return-above-hurdle maths —
//      driven with fixture inputs and asserted on their RETURN VALUES.
//   2. The ACTUAL shipped markup in docs/app.js — the aggregate-view header and
//      totals-row templates — parsed to confirm the new total renders in the
//      correct (7th) column as a CSP-clean `.clickable-value` popover trigger.

import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import "../docs/projection.js";

const g = globalThis as unknown as {
  GRQProjection: {
    costOfCapitalHurdle: (costOfCapital: number, daysElapsed: number) => number;
    returnAboveCostOfCapital: (
      performance: number | null,
      costOfCapital: number,
      daysElapsed: number,
    ) => number | null;
  };
};
const GRQProjection = g.GRQProjection;

const APP_JS = "docs/app.js";

// --- pure helper: cost-of-capital hurdle -----------------------------------

Deno.test("costOfCapitalHurdle - 10%/yr over 90 days ≈ 2.5%", () => {
  // (10 / 365) * 90 = 2.4657...
  assertAlmostEquals(GRQProjection.costOfCapitalHurdle(10, 90), 2.4657, 0.001);
});

Deno.test("costOfCapitalHurdle - zero days elapsed -> 0%", () => {
  assertEquals(GRQProjection.costOfCapitalHurdle(10, 0), 0);
});

// --- pure helper: return above cost of capital -----------------------------

Deno.test("returnAboveCostOfCapital - average Gain/Loss minus the shared hurdle", () => {
  // Known fixture: average Gain/Loss 12.0%, 10%/yr hurdle over 90 days.
  const averageGainLoss = 12.0;
  const hurdle = GRQProjection.costOfCapitalHurdle(10, 90);
  const expected = averageGainLoss - hurdle; // 12 - 2.4657 = 9.534...
  assertAlmostEquals(
    GRQProjection.returnAboveCostOfCapital(averageGainLoss, 10, 90) as number,
    expected,
    1e-9,
  );
});

Deno.test("returnAboveCostOfCapital - equals the mean of the per-stock figures", () => {
  // The portfolio total must equal the mean of each included stock's
  // Return above Cost of Capital (acceptance criterion, issue #407).
  const perStockGainLoss = [10, 14]; // mean = 12
  const costOfCapital = 10;
  const daysElapsed = 90;

  const perStockReturns = perStockGainLoss.map((p) =>
    GRQProjection.returnAboveCostOfCapital(
      p,
      costOfCapital,
      daysElapsed,
    ) as number
  );
  const meanOfPerStock = perStockReturns.reduce((s, v) => s + v, 0) /
    perStockReturns.length;

  const averageGainLoss = perStockGainLoss.reduce((s, v) => s + v, 0) /
    perStockGainLoss.length;
  const portfolioTotal = GRQProjection.returnAboveCostOfCapital(
    averageGainLoss,
    costOfCapital,
    daysElapsed,
  ) as number;

  assertAlmostEquals(portfolioTotal, meanOfPerStock, 1e-9);
});

Deno.test("returnAboveCostOfCapital - null performance -> null", () => {
  assertEquals(GRQProjection.returnAboveCostOfCapital(null, 10, 90), null);
});

// --- shipped markup: the totals cell lands in the right column -------------

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

Deno.test("portfolio Return above Cost of Capital total sits under its header", async () => {
  const src = await Deno.readTextFile(APP_JS);
  const headerHtml = extractTemplate(src, "thead", HEADER_MARKERS);
  const totalsHtml = extractTemplate(src, "totalsRow", ["Days Elapsed"]);

  const headerCells = cells(headerHtml, "th");
  const totalsCells = cells(totalsHtml, "td");

  // The Return above Cost of Capital header is the column that is NOT the bare
  // Gain/Loss column but carries the label constant.
  const headerIdx = headerCells.findIndex((c) =>
    c.includes("RETURN_ABOVE_COST_OF_CAPITAL_LABEL")
  );
  const totalIdx = totalsCells.findIndex((c) =>
    c.includes('data-field="portfolio-return-above-cost-of-capital"')
  );

  assert(headerIdx !== -1, "Return above Cost of Capital header must exist");
  assert(totalIdx !== -1, "portfolio return-above-cost total cell must exist");
  assertEquals(
    totalIdx,
    headerIdx,
    "portfolio Return above Cost of Capital total must align with its header",
  );
});

Deno.test("portfolio Return above Cost of Capital total is a CSP-clean popover trigger", async () => {
  const src = await Deno.readTextFile(APP_JS);
  const totalsHtml = extractTemplate(src, "totalsRow", ["Days Elapsed"]);
  const cell = cells(totalsHtml, "td").find((c) =>
    c.includes('data-field="portfolio-return-above-cost-of-capital"')
  );
  assert(cell, "totals cell must exist");
  // Tap-to-view popover via data attributes only — no inline JS handler (#268).
  assert(cell.includes("clickable-value"), "must be a clickable-value span");
  assert(cell.includes('data-bs-toggle="popover"'), "must trigger a popover");
  assert(cell.includes('data-stock=""'), "portfolio total has no single stock");
  assert(!/\bon\w+=/.test(cell), "must not use inline JS event handlers");
});
