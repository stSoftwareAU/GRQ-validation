// Markup wiring for the dashboard's pick-detail columns (issue #840).
//
// `tests/stock_table_pick_columns_test.ts` owns the rendering behaviour. This
// file owns the wiring the behaviour depends on, which lives in committed
// markup rather than in a callable function:
//
//   - docs/index.html loads docs/pick_details.js and docs/pick_columns.js
//     BEFORE docs/app.js, which calls `GRQPickColumns` at render time;
//   - the service worker precaches both modules in the same all-or-nothing
//     shell update as app.js, so a fresh app.js is never cached beside a
//     missing GRQPickColumns.
//
// CHANGED BY ISSUE #855: this file used to assert that BOTH aggregate header
// rows carried all six pick-detail columns. They no longer do — the columns
// render on the single-stock view only, from one header row built by
// `GRQPickColumns.pickDetailHeaderRow()`. That placement, and the aggregate
// table's freedom from these columns, is owned by
// `tests/pick_columns_single_stock_view_test.ts`.

import { assert, assertStringIncludes } from "@std/assert";
import "../docs/escape.js";
import "../docs/volume_recommend.js";
import "../docs/pick_details.js";
// The pick columns now render "show the working" popovers and the accessible
// text behind each emoji, which live in docs/pick_working.js (issue #841).
import "../docs/pick_working.js";
import "../docs/pick_columns.js";

const INDEX_HTML = await Deno.readTextFile("docs/index.html");
const SW_JS = await Deno.readTextFile("docs/sw.js");

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
