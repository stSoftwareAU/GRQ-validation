// Tests for the aggregate-dashboard totals-row column alignment (issue #406).
//
// The aggregate market view renders 9 column headers (`<th>`) and a footer
// "totals" row of `<td>` cells. A pre-existing bug emitted 10 totals cells, so
// every portfolio total rendered one column too far right (Portfolio Target
// landed under Current Price, Average Gain/Loss under Return above Cost of
// Capital) and the 10th cell had no matching header.
//
// These tests parse the ACTUAL shipped markup from docs/app.js — the
// aggregate-view `thead.innerHTML` template and the `totalsRow.innerHTML`
// template — split them into their top-level cells, and assert the structural
// invariants the fix guarantees: equal cell counts and 1:1 column alignment of
// each labelled total under the correct header.

import { assert, assertEquals } from "@std/assert";

const APP_JS = "docs/app.js";

/** Extract the first template-literal body assigned to `<target>.innerHTML`
 *  whose body contains every one of `must` (used to disambiguate the several
 *  innerHTML templates in the file). */
function extractTemplate(
  src: string,
  target: string,
  must: string[],
): string {
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

/** Split a row template into its top-level cells. Cells (`<td>`/`<th>`) are
 *  never nested in this markup, so each open tag begins exactly one cell. */
function cells(rowHtml: string, tag: "td" | "th"): string[] {
  const open = new RegExp(`<${tag}[\\s>]`, "g");
  // Drop the prefix before the first cell, keep one chunk per cell.
  return rowHtml.split(open).slice(1);
}

async function read(): Promise<string> {
  return await Deno.readTextFile(APP_JS);
}

// The aggregate-view header template, identified by its unique columns.
const HEADER_MARKERS = [
  "90-Day Target",
  "Gain/Loss",
  "Status/Projection",
  "Dividends",
];

Deno.test("aggregate totals row has exactly as many cells as headers", async () => {
  const src = await read();
  const headerHtml = extractTemplate(src, "thead", HEADER_MARKERS);
  const totalsHtml = extractTemplate(src, "totalsRow", ["Days Elapsed"]);

  const headerCount = cells(headerHtml, "th").length;
  const totalsCount = cells(totalsHtml, "td").length;

  assertEquals(headerCount, 9, "aggregate view must have 9 column headers");
  assertEquals(
    totalsCount,
    headerCount,
    `totals row must have ${headerCount} cells (one per header), no orphan cell`,
  );
});

Deno.test("Portfolio Target total sits under the 90-Day Target header", async () => {
  const src = await read();
  const headerHtml = extractTemplate(src, "thead", HEADER_MARKERS);
  const totalsHtml = extractTemplate(src, "totalsRow", ["Days Elapsed"]);

  const headerCells = cells(headerHtml, "th");
  const totalsCells = cells(totalsHtml, "td");

  const targetHeaderIdx = headerCells.findIndex((c) =>
    c.includes("90-Day Target")
  );
  const targetTotalIdx = totalsCells.findIndex((c) =>
    c.includes('data-field="portfolio-target"')
  );

  assert(targetHeaderIdx !== -1, "90-Day Target header must exist");
  assert(targetTotalIdx !== -1, "portfolio-target total cell must exist");
  assertEquals(
    targetTotalIdx,
    targetHeaderIdx,
    "Portfolio Target total must align with the 90-Day Target header",
  );
});

Deno.test("Average Gain/Loss total sits under the Gain/Loss header", async () => {
  const src = await read();
  const headerHtml = extractTemplate(src, "thead", HEADER_MARKERS);
  const totalsHtml = extractTemplate(src, "totalsRow", ["Days Elapsed"]);

  const headerCells = cells(headerHtml, "th");
  const totalsCells = cells(totalsHtml, "td");

  // The Gain/Loss header is the bare "Gain/Loss (%)" column — distinct from the
  // "Return above Cost of Capital" column, which also mentions a return figure.
  const gainHeaderIdx = headerCells.findIndex((c) => c.includes("Gain/Loss"));
  const gainTotalIdx = totalsCells.findIndex((c) =>
    c.includes("portfolioPerformance90Day")
  );

  assert(gainHeaderIdx !== -1, "Gain/Loss header must exist");
  assert(gainTotalIdx !== -1, "average gain/loss total cell must exist");
  assertEquals(
    gainTotalIdx,
    gainHeaderIdx,
    "Average Gain/Loss total must align with the Gain/Loss header",
  );
});

Deno.test("Portfolio Target tap-to-view popover is preserved", async () => {
  const src = await read();
  const totalsHtml = extractTemplate(src, "totalsRow", ["Days Elapsed"]);
  // The clickable popover trigger (data-field + toggle) must survive the
  // re-alignment — only its column position changes.
  assert(
    totalsHtml.includes('data-field="portfolio-target"') &&
      totalsHtml.includes('data-bs-toggle="popover"'),
    "Portfolio Target popover trigger must remain intact",
  );
});
