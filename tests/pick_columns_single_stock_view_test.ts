// The pick-detail columns belong to the SINGLE-STOCK view only (issue #855).
//
// Issue #840 put six pick-detail columns — Pick, ADV, Lots, 5-Day Return,
// Earnings Yield and 52-Week Position — on the dashboard's AGGREGATE table.
// They crowded the portfolio figures out of a phone screen, and they are a
// per-stock review aid rather than a portfolio figure, so #855 moves them to
// the single-stock view (`?stock=…`, the `.stock-detail-view` state) and
// removes them from the aggregate table at every viewport width.
//
// The move is display-only: the maths, the inclusion predicate and the sidecar
// load are untouched (`tests/pick_columns_isolation_test.ts` keeps pinning
// that). What this file owns is WHERE the columns render:
//
//   - the real `pickDetailHeaderRow()` / `pickDetailRowCells()` helpers build
//     one header row and one body row that align 1:1, carry every popover
//     trigger, and escape an untrusted ticker;
//   - neither committed aggregate header row (the static markup in
//     docs/index.html, the rebuild in docs/app.js) mentions a pick column;
//   - the single-stock branch of docs/app.js renders through those helpers and
//     leaves the table on screen rather than hiding it;
//   - the pick-warning legend follows the columns — the aggregate and basic
//     renders clear `this.pickValues`, so the legend hides with them.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import "../docs/escape.js";
import "../docs/volume_recommend.js";
import "../docs/pick_details.js";
import "../docs/pick_working.js";
import "../docs/pick_columns.js";

const INDEX_HTML = await Deno.readTextFile("docs/index.html");
const APP_JS = await Deno.readTextFile("docs/app.js");

interface PickValues {
  trafficLight: { light: string };
  [key: string]: unknown;
}

const g = globalThis as unknown as {
  GRQPickColumns: {
    PICK_COLUMN_LABELS: string[];
    PICK_COLUMN_COUNT: number;
    pickColumnValues: (input: Record<string, unknown>) => PickValues;
    pickDetailHeaderRow: () => string;
    pickDetailRowCells: (values: unknown, stock: string) => string;
  };
  GRQPickWorking: { PICK_FIELDS: Record<string, string> };
};

const {
  PICK_COLUMN_LABELS,
  PICK_COLUMN_COUNT,
  pickColumnValues,
  pickDetailHeaderRow,
  pickDetailRowCells,
} = g.GRQPickColumns;

const SCORE_DATE = new Date("2026-07-19");

function values(): PickValues {
  return pickColumnValues({
    sidecar: {
      week52Low: 50,
      week52High: 150,
      closeScoreDate: 100,
      close5dPrior: 98,
      advDollar10d: 8000000,
    },
    series: [],
    scoreDate: SCORE_DATE,
    eps: 8,
    buyPrice: 100,
  });
}

/** Split a row of markup into its top-level `<th>`/`<td>` cells. */
function cells(html: string, tag: "th" | "td"): string[] {
  return html.split(new RegExp(`<${tag}[\\s>]`)).slice(1);
}

/** The static #stockTable `<thead>` from docs/index.html. */
function staticThead(): string {
  const table = INDEX_HTML.indexOf('id="stockTable"');
  assert(table !== -1, "could not find #stockTable in index.html");
  const start = INDEX_HTML.indexOf("<thead", table);
  const end = INDEX_HTML.indexOf("</thead>", start);
  assert(start !== -1 && end !== -1, "could not find #stockTable <thead>");
  return INDEX_HTML.slice(start, end);
}

/** The aggregate-view `thead.innerHTML` template from docs/app.js. */
function aggregateThead(): string {
  const marker = "thead.innerHTML = `";
  let from = 0;
  while (true) {
    const start = APP_JS.indexOf(marker, from);
    assert(start !== -1, "could not find the aggregate-view thead template");
    const bodyStart = start + marker.length;
    const end = APP_JS.indexOf("`", bodyStart);
    assert(end !== -1, "unterminated template literal");
    const body = APP_JS.slice(bodyStart, end);
    if (
      ["Buy Price", "Stars", "Gain/Loss", "Dividends"].every((m) =>
        body.includes(m)
      )
    ) {
      return body;
    }
    from = end + 1;
  }
}

/** The body of `updateStockTable`'s single-stock branch, from the branch test
 *  to the `} else {` that starts the aggregate view. */
function singleStockBranch(): string {
  const start = APP_JS.indexOf("if (this.selectedStock) {");
  assert(start !== -1, "could not find the single-stock branch in app.js");
  const end = APP_JS.indexOf("// Aggregate view - show table", start);
  assert(end !== -1, "could not find the end of the single-stock branch");
  return APP_JS.slice(start, end);
}

// ---------------------------------------------------------------------------
// The rendered rows
// ---------------------------------------------------------------------------

Deno.test("the single-stock header row carries Stock plus every pick column", () => {
  const header = pickDetailHeaderRow();
  const headerCells = cells(header, "th");
  assertEquals(
    headerCells.length,
    PICK_COLUMN_COUNT + 1,
    "the header is the identity column plus the six pick columns",
  );
  assertStringIncludes(headerCells[0], ">Stock</th>");
  PICK_COLUMN_LABELS.forEach((label, index) => {
    assertStringIncludes(
      headerCells[index + 1],
      `>${label}</th>`,
      `pick column ${index} should be ${label}`,
    );
  });
});

Deno.test("every single-stock header declares scope=col, and Pick is tagged for pinning", () => {
  const headerCells = cells(pickDetailHeaderRow(), "th");
  for (const cell of headerCells) {
    const attrs = cell.slice(0, cell.indexOf(">"));
    assert(
      /\bscope\s*=\s*"col"/.test(attrs),
      `header cell lacks scope="col": ${cell}`,
    );
  }
  // The pinned-column rule in docs/styles.css keys off the CLASS, never a
  // position, so the header must carry it as well as the cells (issue #842).
  const pick = headerCells.find((cell) => cell.includes(">Pick</th>"));
  assert(pick !== undefined, "no Pick header rendered");
  assertStringIncludes(pick.slice(0, pick.indexOf(">")), "pick-light");
});

Deno.test("every single-stock header explains its column with a title", () => {
  const headerCells = cells(pickDetailHeaderRow(), "th").slice(1);
  for (const [index, cell] of headerCells.entries()) {
    const attrs = cell.slice(0, cell.indexOf(">"));
    const title = attrs.match(/\btitle\s*=\s*"([^"]*)"/);
    assert(
      title !== null && title[1].trim().length > 20,
      `${PICK_COLUMN_LABELS[index]} needs a title explaining the figure`,
    );
  }
});

Deno.test("the single-stock body row aligns 1:1 with its header row", () => {
  const bodyCells = cells(pickDetailRowCells(values(), "NYSE:GOOD"), "td");
  assertEquals(
    bodyCells.length,
    cells(pickDetailHeaderRow(), "th").length,
    "one body cell per header, so the row can never slide out of alignment",
  );
  assertStringIncludes(bodyCells[0], "NYSE:GOOD");
  assertStringIncludes(bodyCells[1], "pick-light");
});

Deno.test("every pick cell in the single-stock row is a popover trigger", () => {
  const html = pickDetailRowCells(values(), "NYSE:GOOD");
  for (const field of Object.values(g.GRQPickWorking.PICK_FIELDS)) {
    assertStringIncludes(html, `data-field="${field}"`);
  }
  assertEquals(
    html.split('data-bs-toggle="popover"').length - 1,
    PICK_COLUMN_COUNT,
    "all six pick cells must show their working",
  );
});

Deno.test("the single-stock row escapes an untrusted ticker", () => {
  const html = pickDetailRowCells(values(), '"><script>alert(1)</script>');
  assert(!html.includes("<script>"), "the ticker must never be rendered raw");
  assertStringIncludes(html, "&lt;script&gt;");
});

// ---------------------------------------------------------------------------
// The aggregate table carries none of them
// ---------------------------------------------------------------------------

Deno.test("neither aggregate header row carries a pick-detail column", () => {
  const rows = {
    "index.html static": staticThead(),
    "app.js aggregate": aggregateThead(),
  };
  for (const [where, html] of Object.entries(rows)) {
    for (const label of PICK_COLUMN_LABELS) {
      assert(
        !html.includes(`>${label}</th>`),
        `${where} still carries the ${label} column — the pick columns belong ` +
          "to the single-stock view only (issue #855)",
      );
    }
  }
});

Deno.test("the aggregate row template renders no pick cells", () => {
  // The aggregate `row.innerHTML` template is identified by the Buy Price
  // popover every aggregate row carries.
  const marker = "row.innerHTML = `";
  let from = 0;
  let template: string | null = null;
  while (template === null) {
    const start = APP_JS.indexOf(marker, from);
    assert(start !== -1, "could not find the aggregate row template");
    const bodyStart = start + marker.length;
    const end = APP_JS.indexOf("`", bodyStart);
    const body = APP_JS.slice(bodyStart, end);
    if (body.includes('data-field="buy-price"')) template = body;
    from = end + 1;
  }
  for (const call of ["trafficLightCell", "pickDetailCells"]) {
    assert(
      !template.includes(call),
      `the aggregate row must not call ${call} (issue #855)`,
    );
  }
});

// ---------------------------------------------------------------------------
// The single-stock branch renders them through the shared helpers
// ---------------------------------------------------------------------------

Deno.test("the single-stock branch renders the pick table through the helpers", () => {
  const branch = singleStockBranch();
  for (
    const call of [
      "GRQPickColumns.pickColumnValues",
      "GRQPickColumns.pickDetailHeaderRow()",
      "GRQPickColumns.pickDetailRowCells(",
    ]
  ) {
    assertStringIncludes(
      branch,
      call,
      `the single-stock view must render via ${call}`,
    );
  }
});

Deno.test("the single-stock branch leaves the stock table on screen", () => {
  const branch = singleStockBranch();
  assert(
    !/tableContainer\.style\.display\s*=\s*"none"/.test(branch),
    "the single-stock view must keep the table visible — it is where the " +
      "pick-detail columns now render (issue #855)",
  );
  assertStringIncludes(branch, 'tableContainer.style.display = "block"');
});

Deno.test("the single-stock branch keeps only the selected stock's pick values", () => {
  // `this.pickValues` drives both the popover working and the warning legend,
  // so a stale entry from a previous render would let a stock that is no longer
  // on screen explain itself through this one's cells (issue #841).
  const branch = singleStockBranch();
  assertStringIncludes(branch, "this.pickValues = {}");
  assert(
    /this\.pickValues\[[^\]]+\]\s*=\s*pickValues/.test(branch),
    "the selected stock's values must be the only ones kept",
  );
});

Deno.test("the aggregate and basic renders clear the pick values, hiding the legend", () => {
  // The legend decodes the pick columns, so it may only appear where they do:
  // a render with no pick cells must hold no pick values, which is what hides
  // the legend (`updatePickWarningsLegend` reads `this.pickValues`).
  const aggregate = (() => {
    const start = APP_JS.indexOf("// Aggregate view - show table");
    assert(start !== -1, "could not find the aggregate branch in app.js");
    const end = APP_JS.indexOf("updateBasicStockTable()", start);
    assert(end !== -1, "could not find the end of the aggregate branch");
    return APP_JS.slice(start, end);
  })();
  const basic = (() => {
    const start = APP_JS.indexOf("updateBasicStockTable()");
    const end = APP_JS.indexOf("getDividendsWithin90Days(", start);
    assert(end !== -1, "could not find the end of updateBasicStockTable");
    return APP_JS.slice(start, end);
  })();

  for (
    const [where, source] of Object.entries({ aggregate, basic })
  ) {
    assertStringIncludes(
      source,
      "this.pickValues = {}",
      `the ${where} render must hold no pick values — it renders no pick cells`,
    );
    assertStringIncludes(source, "this.updatePickWarningsLegend()");
  }
  for (const call of ["trafficLightCell", "pickDetailCells"]) {
    assert(
      !basic.includes(call),
      `the basic (no-market-data) view must render no pick cells (${call})`,
    );
  }
});
