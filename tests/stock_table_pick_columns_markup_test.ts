// Markup wiring for the dashboard's pick-detail columns (issue #840).
//
// `tests/stock_table_pick_columns_test.ts` owns the rendering behaviour. This
// file owns the wiring the behaviour depends on, which lives in committed
// markup rather than in a callable function:
//
//   - the six column headers exist in BOTH header rows (the static markup in
//     docs/index.html and the aggregate-view rebuild in docs/app.js) and are
//     labelled identically, so the two can never describe different columns;
//   - docs/index.html loads docs/pick_details.js and docs/pick_columns.js
//     BEFORE docs/app.js, which calls `GRQPickColumns` at render time;
//   - the service worker precaches both modules in the same all-or-nothing
//     shell update as app.js, so a fresh app.js is never cached beside a
//     missing GRQPickColumns.
//
// The label list comes from the real shipped module, so a rename there fails
// here rather than silently drifting from the markup.

import { assert, assertStringIncludes } from "@std/assert";
import "../docs/escape.js";
import "../docs/volume_recommend.js";
import "../docs/pick_details.js";
// The pick columns now render "show the working" popovers and the accessible
// text behind each emoji, which live in docs/pick_working.js (issue #841).
import "../docs/pick_working.js";
import "../docs/pick_columns.js";

const INDEX_HTML = await Deno.readTextFile("docs/index.html");
const APP_JS = await Deno.readTextFile("docs/app.js");
const SW_JS = await Deno.readTextFile("docs/sw.js");

const { PICK_COLUMN_LABELS } = (globalThis as unknown as {
  GRQPickColumns: { PICK_COLUMN_LABELS: string[] };
}).GRQPickColumns;

/** The static #stockTable `<thead>` from docs/index.html. */
function staticThead(): string {
  const tableStart = INDEX_HTML.indexOf('id="stockTable"');
  assert(tableStart !== -1, "could not find #stockTable in index.html");
  const start = INDEX_HTML.indexOf("<thead", tableStart);
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

Deno.test("both #stockTable header rows carry every pick-detail column", () => {
  const rows = {
    "index.html static": staticThead(),
    "app.js aggregate": aggregateThead(),
  };
  for (const [where, html] of Object.entries(rows)) {
    for (const label of PICK_COLUMN_LABELS) {
      assertStringIncludes(
        html,
        `>${label}</th>`,
        `${where} thead is missing the ${label} column`,
      );
    }
  }
});

Deno.test("index.html loads the pick modules before app.js", () => {
  // app.js itself is injected by dashboard_boot.js (issue #189, so the page can
  // keep a strict CSP), so "before app.js" means "before dashboard_boot.js".
  const order = [
    "escape.js",
    "volume_recommend.js",
    "pick_details.js",
    "pick_columns.js",
    "dashboard_boot.js",
  ].map((file) => ({ file, at: INDEX_HTML.indexOf(`src="${file}`) }));

  for (const { file, at } of order) {
    assert(at !== -1, `index.html must load ${file}`);
  }
  for (let i = 1; i < order.length; i++) {
    assert(
      order[i - 1].at < order[i].at,
      `${order[i - 1].file} must be loaded before ${order[i].file}`,
    );
  }
});

Deno.test("sw.js precaches the pick modules in the core shell", () => {
  const coreStart = SW_JS.indexOf("const CORE_ASSETS");
  const coreEnd = SW_JS.indexOf("];", coreStart);
  assert(
    coreStart !== -1 && coreEnd !== -1,
    "could not find CORE_ASSETS in sw.js",
  );
  const core = SW_JS.slice(coreStart, coreEnd);

  assertStringIncludes(core, '"./pick_details.js"');
  assertStringIncludes(core, '"./pick_columns.js"');
});

Deno.test("the pick columns never reach the inclusion predicate or the score", () => {
  // Issue #840 is display-only: #835 asks to SHOW why a name might not have
  // been picked, not to change what the portfolio holds. The shared inclusion
  // kernel must therefore know nothing about these values.
  const projection = Deno.readTextFileSync("docs/projection.js");
  for (const leak of ["GRQPickColumns", "pickColumnValues", "trafficLight"]) {
    assert(
      !projection.includes(leak),
      `docs/projection.js must not reference ${leak} — the pick columns are display-only`,
    );
  }
});
