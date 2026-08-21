// Popover wiring for the pick-detail columns (issue #841, sub-issue of #835).
//
// `tests/pick_working_test.ts` owns the WORDING of each popover. This file owns
// the wiring that carries it to the screen:
//
//   - every pick-detail cell is a `.clickable-value` popover trigger carrying
//     its `data-field` / `data-stock`, so the dashboard's existing popover
//     machinery picks it up — no second mechanism;
//   - the shared popover lifecycle (docs/popover_cleanup.js,
//     docs/popover_dismiss.js) therefore disposes and dismisses them on
//     re-render, which is what stops orphaned tips surviving a score-date
//     change;
//   - each field id maps to a HUMAN-READABLE label in docs/field_label.js
//     (issue #542), so a popover header reads `Field: Earnings Yield`, never
//     `Field: pick-earnings-yield`;
//   - the emoji cell carries a visually-hidden text equivalent, so its meaning
//     survives with colour and images disabled;
//   - the committed markup loads the new module and precaches it in the same
//     all-or-nothing service-worker shell update as app.js.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import "../docs/escape.js";
import "../docs/volume_recommend.js";
import "../docs/pick_details.js";
import "../docs/pick_working.js";
import "../docs/pick_columns.js";
import "../docs/field_label.js";
import "../docs/popover_cleanup.js";
import "../docs/popover_dismiss.js";

const g = globalThis as unknown as {
  GRQPickWorking: {
    PICK_FIELDS: Record<string, string>;
    working: (input: Record<string, unknown>) => string;
  };
  GRQPickColumns: {
    PICK_COLUMN_LABELS: string[];
    pickColumnValues: (
      input: Record<string, unknown>,
    ) => Record<string, unknown>;
    trafficLightCell: (values: unknown, stock?: string) => string;
    pickDetailCells: (values: unknown, stock?: string) => string;
  };
  GRQFieldLabel: {
    fieldLabel: (field: string) => string;
    workingHeader: (stock: string, field: string, date: string) => string;
  };
  GRQPopovers: {
    clearAllPopovers: (
      doc: unknown,
      api: unknown,
    ) => { disposed: number; swept: number };
  };
  GRQPopover: { POPOVER_TRIGGER_SELECTOR: string };
};

const { PICK_FIELDS } = g.GRQPickWorking;
const {
  PICK_COLUMN_LABELS,
  pickColumnValues,
  trafficLightCell,
  pickDetailCells,
} = g.GRQPickColumns;
const { fieldLabel, workingHeader } = g.GRQFieldLabel;

const SCORE_DATE = new Date("2026-07-19");

function values(overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  });
}

/** All six rendered cells for one row. */
function allCells(stock = "NYSE:GOOD") {
  const row = values();
  return trafficLightCell(row, stock) + pickDetailCells(row, stock);
}

// ---------------------------------------------------------------------------
// Every value is a popover trigger
// ---------------------------------------------------------------------------

Deno.test("every pick-detail cell is a clickable-value popover trigger", () => {
  const html = allCells();
  for (const field of Object.values(PICK_FIELDS)) {
    assertStringIncludes(html, `data-field="${field}"`);
  }
  assertEquals(
    html.split('data-bs-toggle="popover"').length - 1,
    6,
    "all six cells must be popover triggers",
  );
  assertEquals(
    html.split("clickable-value").length - 1,
    6,
    "all six cells must carry the shared .clickable-value class",
  );
  assertEquals(
    html.split('data-stock="NYSE:GOOD"').length - 1,
    6,
    "every cell must name its stock so the popover can find its row",
  );
});

Deno.test("a blank cell is still a trigger, so it can explain why it is blank", () => {
  // A 2024 date: no sidecar, no volume, no eps — every figure unknown.
  const empty = pickColumnValues({
    sidecar: null,
    series: [],
    scoreDate: SCORE_DATE,
    buyPrice: null,
  });
  const html = pickDetailCells(empty, "NYSE:OLD");
  assertEquals(
    html.split('data-bs-toggle="popover"').length - 1,
    5,
    "an unknown figure must still open its working",
  );
  // The cell is blank, so the `<td>` itself is the trigger — there is no inner
  // span to click — and the working behind it says why the figure is unknown.
  assertStringIncludes(html, '<td class="pick-adv clickable-value"');
  assertStringIncludes(
    g.GRQPickWorking.working({
      field: PICK_FIELDS.ADV,
      values: empty,
      context: { scoreDateISO: "2026-07-19", weekdayWindow: 10 },
    }),
    "Unknown:",
  );
});

Deno.test("the cells escape an untrusted ticker in every attribute", () => {
  const html = allCells('"><script>alert(1)</script>');
  assert(!html.includes("<script>"), "the ticker must never be rendered raw");
  assertStringIncludes(html, "&lt;script&gt;");
});

Deno.test("the traffic-light cell carries a text equivalent for its emoji", () => {
  const html = trafficLightCell(
    values({
      sidecar: {
        week52Low: 50,
        week52High: 150,
        closeScoreDate: 100,
        close5dPrior: 98,
        advDollar10d: 2000000, // 100 lots: thin liquidity
      },
      eps: 3,
    }),
    "NYSE:THIN",
  );
  // The glyph is hidden from assistive tech; the words carry the meaning.
  assertStringIncludes(html, 'aria-hidden="true"');
  assertStringIncludes(html, 'class="visually-hidden"');
  assertStringIncludes(html, "Amber");
  assertStringIncludes(html, "Thin liquidity");
});

// ---------------------------------------------------------------------------
// Human-readable popover headers (issue #542)
// ---------------------------------------------------------------------------

Deno.test("each pick field maps to its column header, never a raw id", () => {
  const expected: Record<string, string> = {
    [PICK_FIELDS.LIGHT]: PICK_COLUMN_LABELS[0],
    [PICK_FIELDS.ADV]: PICK_COLUMN_LABELS[1],
    [PICK_FIELDS.LOTS]: PICK_COLUMN_LABELS[2],
    [PICK_FIELDS.FIVE_DAY_RETURN]: PICK_COLUMN_LABELS[3],
    [PICK_FIELDS.EARNINGS_YIELD]: PICK_COLUMN_LABELS[4],
    [PICK_FIELDS.POSITION]: PICK_COLUMN_LABELS[5],
  };
  for (const [field, label] of Object.entries(expected)) {
    assertEquals(fieldLabel(field), label);
    assert(
      fieldLabel(field) !== field,
      `${field} must not fall back to its raw id`,
    );
  }
});

Deno.test("the working header reads Field: Earnings Yield, not the raw id", () => {
  const header = workingHeader(
    "NYSE:GOOD",
    PICK_FIELDS.EARNINGS_YIELD,
    "2026-07-19",
  );
  assertStringIncludes(header, "Field: Earnings Yield");
  assert(!header.includes("pick-earnings-yield"));
});

// ---------------------------------------------------------------------------
// The shared popover lifecycle disposes them (issue #370/#371)
// ---------------------------------------------------------------------------

Deno.test("clearAllPopovers disposes the pick-detail popovers on re-render", () => {
  // A minimal document holding one live popover per pick cell plus an orphaned
  // tip, mirroring what a score-date change leaves behind.
  const instances = Object.values(PICK_FIELDS).map(() => ({
    hidden: false,
    disposed: false,
    hide() {
      this.hidden = true;
    },
    dispose() {
      this.disposed = true;
    },
  }));
  const triggers = instances.map((instance) => ({ instance }));
  const tips = [{
    removed: false,
    remove() {
      this.removed = true;
    },
  }];
  const doc = {
    querySelectorAll(selector: string): unknown[] {
      if (selector === '[data-bs-toggle="popover"]') return triggers;
      if (selector === ".popover") return tips.filter((t) => !t.removed);
      return [];
    },
  };
  const api = {
    getInstance(el: unknown) {
      return (el as { instance: unknown }).instance;
    },
  };

  const result = g.GRQPopovers.clearAllPopovers(doc, api);
  assertEquals(result.disposed, 6, "every pick popover must be disposed");
  assertEquals(result.swept, 1, "an orphaned tip must be swept");
  assert(instances.every((i) => i.hidden && i.disposed));
  assertEquals(doc.querySelectorAll(".popover").length, 0);
});

Deno.test("the dismiss helper's trigger selector matches the pick cells", () => {
  // The pick cells carry BOTH halves of the shared selector, so tapping outside
  // dismisses them through the existing mechanism rather than a new one.
  const html = allCells();
  for (const part of g.GRQPopover.POPOVER_TRIGGER_SELECTOR.split(", ")) {
    const needle = part.startsWith(".")
      ? part.slice(1)
      : part.replace(/[[\]]/g, "");
    assertStringIncludes(html, needle);
  }
});

// ---------------------------------------------------------------------------
// Committed markup: module load order, the service-worker shell, the legend
// ---------------------------------------------------------------------------

const INDEX_HTML = await Deno.readTextFile("docs/index.html");
const APP_JS = await Deno.readTextFile("docs/app.js");
const SW_JS = await Deno.readTextFile("docs/sw.js");

Deno.test("index.html loads pick_working.js before pick_columns.js and app.js", () => {
  const order = [
    "pick_details.js",
    "pick_working.js",
    "pick_columns.js",
    "dashboard_boot.js",
  ].map((file) => ({ file, at: INDEX_HTML.indexOf(`src="${file}`) }));
  for (const { file, at } of order) {
    assert(at !== -1, `index.html must load ${file}`);
  }
  for (let i = 1; i < order.length; i++) {
    assert(
      order[i - 1].at < order[i].at,
      `${order[i - 1].file} must load before ${order[i].file}`,
    );
  }
});

Deno.test("sw.js precaches pick_working.js in the core shell", () => {
  const coreStart = SW_JS.indexOf("const CORE_ASSETS");
  const coreEnd = SW_JS.indexOf("];", coreStart);
  assert(coreStart !== -1 && coreEnd !== -1, "could not find CORE_ASSETS");
  assertStringIncludes(SW_JS.slice(coreStart, coreEnd), '"./pick_working.js"');
});

Deno.test("index.html carries the pick-warning legend, hidden by default", () => {
  const at = INDEX_HTML.indexOf('id="pickWarningsLegend"');
  assert(at !== -1, "index.html must carry the pick-warning legend");
  const block = INDEX_HTML.slice(at, at + 400);
  assertStringIncludes(block, "display: none");
  assertStringIncludes(block, 'id="pickWarningsLegendBody"');
});

Deno.test("app.js gates the legend on the shared helper and renders its wording", () => {
  // The legend must be driven by GRQPickWorking, not by a second copy of the
  // "does anything need decoding?" rule.
  assertStringIncludes(APP_JS, "GRQPickWorking.hasAnyWarning");
  assertStringIncludes(APP_JS, "GRQPickWorking.legendHtml");
  assertStringIncludes(APP_JS, "GRQPickWorking.isPickField");
  assertStringIncludes(APP_JS, "updatePickWarningsLegend()");
});
