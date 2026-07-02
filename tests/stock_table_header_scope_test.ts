// Tests for `scope="col"` on the #stockTable column headers (issue #696).
//
// The HTML bucket requires data-table `<th>` header cells to carry an explicit
// `scope` so screen readers can associate each data cell with its column
// header. `#stockTable` is a genuine data table (score/price/target columns),
// so every column-header `<th>` must declare `scope="col"`.
//
// The header row exists in THREE places that must stay consistent:
//   1. the static markup in docs/index.html (initial render), and
//   2. two `thead.innerHTML` templates in docs/app.js that REBUILD the header
//      at runtime — the aggregate market view and the basic (no-market-data)
//      view. If only the static markup were fixed, the runtime rebuild would
//      silently drop the scope again, so all three are asserted here.
//
// These assertions parse the REAL committed markup, not source keywords, and
// verify the structural invariant: within each header template, every `<th>`
// carries `scope="col"`.

import { assert, assertEquals } from "@std/assert";

const INDEX_HTML = "docs/index.html";
const APP_JS = "docs/app.js";

/** Split a run of markup into its top-level `<th>` cells. `<th>` cells are
 *  never nested in this markup, so each open tag begins exactly one cell. */
function thCells(html: string): string[] {
  return html.split(/<th[\s>]/).slice(1);
}

/** Assert every `<th>` cell in `headerHtml` carries `scope="col"`. */
function assertAllHaveScopeCol(headerHtml: string, label: string): void {
  const cells = thCells(headerHtml);
  assert(cells.length > 0, `${label}: expected at least one <th> cell`);
  cells.forEach((cell, i) => {
    // The cell chunk starts immediately after `<th` (the split consumed the
    // trailing whitespace/`>`); the attributes run up to the first `>`.
    const attrs = cell.slice(0, cell.indexOf(">"));
    assert(
      /\bscope\s*=\s*"col"/.test(attrs),
      `${label}: <th> #${i + 1} lacks scope="col" — attrs were: <th ${attrs}>`,
    );
  });
}

/** Extract the static #stockTable <thead> ... </thead> from docs/index.html. */
function extractStaticThead(html: string): string {
  const tableStart = html.indexOf('id="stockTable"');
  assert(tableStart !== -1, "could not find #stockTable in index.html");
  const theadStart = html.indexOf("<thead", tableStart);
  const theadEnd = html.indexOf("</thead>", theadStart);
  assert(
    theadStart !== -1 && theadEnd !== -1,
    "could not find #stockTable <thead>",
  );
  return html.slice(theadStart, theadEnd);
}

/** Extract the first `thead.innerHTML = \`...\`` template body in `src` whose
 *  body contains every marker in `must` (disambiguates the two templates). */
function extractHeadTemplate(src: string, must: string[]): string {
  const marker = "thead.innerHTML = `";
  let from = 0;
  while (true) {
    const start = src.indexOf(marker, from);
    assert(
      start !== -1,
      `could not find thead.innerHTML template matching ${must}`,
    );
    const bodyStart = start + marker.length;
    const end = src.indexOf("`", bodyStart);
    assert(end !== -1, "unterminated template literal");
    const body = src.slice(bodyStart, end);
    if (must.every((m) => body.includes(m))) return body;
    from = end + 1;
  }
}

Deno.test("index.html: static #stockTable headers all carry scope=col", async () => {
  const html = await Deno.readTextFile(INDEX_HTML);
  const thead = extractStaticThead(html);
  // Sanity: the header we expect is present so we are asserting the right table.
  assert(
    thead.includes("Stock"),
    "static thead should include the Stock column",
  );
  assert(
    thead.includes("Notes"),
    "static thead should include the Notes column",
  );
  assertAllHaveScopeCol(thead, "index.html static thead");
});

Deno.test("app.js: aggregate-view header rebuild carries scope=col", async () => {
  const src = await Deno.readTextFile(APP_JS);
  const template = extractHeadTemplate(src, [
    "Buy Price",
    "Stars",
    "Gain/Loss",
    "Dividends",
  ]);
  assertAllHaveScopeCol(template, "app.js aggregate-view thead");
});

Deno.test("app.js: basic-view header rebuild carries scope=col", async () => {
  const src = await Deno.readTextFile(APP_JS);
  const template = extractHeadTemplate(src, [
    "Dividend Per Share",
    "Intrinsic Value (Basic)",
    "Notes",
  ]);
  assertAllHaveScopeCol(template, "app.js basic-view thead");
});

Deno.test("thCells: counts and isolates top-level <th> cells", () => {
  const cells = thCells(`<th scope="col">A</th><th>B</th>`);
  assertEquals(cells.length, 2);
});
