// Dashboard pick-detail columns on the main stock table (issue #840, sub-issue
// of #835).
//
// The dashboard's aggregate stock table gained six columns so a reviewer can
// answer "is there a reason we didn't manually pick this stock?" without
// leaving the page: the 🔴/🟠/🟢 traffic light (plus warning emojis), dollar
// ADV, tradeable lots, the 5-day return, the earnings yield and the position in
// the 52-week range.
//
// These tests drive the REAL shipped rendering kernel — `docs/pick_columns.js`,
// published on `globalThis.GRQPickColumns` and consumed verbatim by
// `docs/app.js` — over three fixtures:
//
//   1. populated       — a recent score date WITH a `<date>-picks.csv` sidecar;
//   2. partly populated — no sidecar, ADV falling back to the in-page CSV via
//                         `GRQVolume.buildTrailingVolumeWindow`;
//   3. empty           — a 2024 date with no `volume` column, no `eps` and no
//                        sidecar: blank cells, a NEUTRAL unknown light, and no
//                        console errors.
//
// The maths itself is NOT re-tested here — `tests/pick_details_test.ts` owns
// the thresholds. What is asserted here is the rendering contract: which cells
// appear, how they are formatted, that untrusted values are escaped, and that
// an unknown value neither manufactures nor suppresses a warning.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import "../docs/escape.js";
import "../docs/volume_recommend.js";
import "../docs/pick_details.js";
// The pick columns now render "show the working" popovers and the accessible
// text behind each emoji, which live in docs/pick_working.js (issue #841).
import "../docs/pick_working.js";
import "../docs/pick_columns.js";

interface PickWarning {
  emoji: string;
  label: string;
}

interface TrafficLight {
  light: string;
  warnings: PickWarning[];
  majorWarn: boolean;
  minorWarn: boolean;
  known: boolean;
}

interface PickValues {
  price: number | null;
  adv: number | null;
  advSource: "sidecar" | "trailing" | "forward" | null;
  lots: number | null;
  fiveDayReturn: number | null;
  earningsYield: number | null;
  position: number | null;
  trafficLight: TrafficLight;
}

interface SidecarRow {
  week52Low: number | null;
  week52High: number | null;
  closeScoreDate: number | null;
  close5dPrior: number | null;
  advDollar10d: number | null;
}

interface PicksLoad {
  state: "ok" | "absent" | "error";
  reason: string;
  message: string;
  rows: Record<string, SidecarRow>;
}

const g = globalThis as unknown as {
  GRQPickColumns: {
    UNKNOWN_LIGHT: string;
    PICK_COLUMN_COUNT: number;
    classifyPicksLoad: (
      input: { ok?: boolean; status?: number; text?: string },
    ) => PicksLoad;
    pickColumnValues: (input: Record<string, unknown>) => PickValues;
    trafficLightCell: (values: PickValues) => string;
    pickDetailCells: (values: PickValues) => string;
    formatSignedPercent: (fraction: unknown) => string;
    formatRangePercent: (fraction: unknown) => string;
  };
  GRQPickDetails: {
    MIN_RED_LOTS: number;
    MIN_AMBER_LOTS: number;
    PARCEL_DOLLARS: number;
    HIGH_CUT: number;
    EY_STRONG_CUT: number;
    EY_WEAK_CUT: number;
    WARNINGS: Record<string, PickWarning>;
  };
};

const {
  UNKNOWN_LIGHT,
  PICK_COLUMN_COUNT,
  classifyPicksLoad,
  pickColumnValues,
  trafficLightCell,
  pickDetailCells,
  formatSignedPercent,
  formatRangePercent,
} = g.GRQPickColumns;

const { MIN_RED_LOTS, MIN_AMBER_LOTS, PARCEL_DOLLARS, WARNINGS } =
  g.GRQPickDetails;

/** Split a run of markup into its top-level `<td>` cells. */
function tdCells(html: string): string[] {
  return html.split(/<td[\s>]/).slice(1);
}

/** The ADV "show the working" popover body for a row (issue #841). */
function advWorking(values: PickValues): string {
  return (globalThis as unknown as {
    GRQPickWorking: { working: (input: Record<string, unknown>) => string };
  }).GRQPickWorking.working({
    field: "pick-adv",
    values,
    context: { scoreDateISO: "2026-07-19", weekdayWindow: 10 },
  });
}

/** The visible text of the nth `<td>` in a cell run. */
function cellText(html: string, index: number): string {
  const cell = tdCells(html)[index];
  assert(cell !== undefined, `no cell at index ${index} in ${html}`);
  const body = cell.slice(cell.indexOf(">") + 1);
  return body.slice(0, body.indexOf("</td>")).trim();
}

// A liquid, healthy name: $4M ADV (200 lots), mid-range, strong earnings yield.
const HEALTHY_SIDECAR = [
  "ticker,week52_low,week52_high,close_score_date,close_5d_prior,adv_dollar_10d",
  "NYSE:GOOD,50.00,150.00,100.00,98.00,8000000.00",
].join("\n");

// ---------------------------------------------------------------------------
// Sidecar loading and classification
// ---------------------------------------------------------------------------

Deno.test("classifyPicksLoad parses a well-formed sidecar into per-ticker rows", () => {
  const load = classifyPicksLoad({
    ok: true,
    status: 200,
    text: HEALTHY_SIDECAR,
  });

  assertEquals(load.state, "ok");
  const row = load.rows["NYSE:GOOD"];
  assert(row, "expected a row for NYSE:GOOD");
  assertEquals(row.week52Low, 50);
  assertEquals(row.week52High, 150);
  assertEquals(row.closeScoreDate, 100);
  assertEquals(row.close5dPrior, 98);
  assertEquals(row.advDollar10d, 8000000);
});

Deno.test("classifyPicksLoad treats a blank sidecar cell as unknown, never zero", () => {
  const load = classifyPicksLoad({
    ok: true,
    status: 200,
    text: [
      "ticker,week52_low,week52_high,close_score_date,close_5d_prior,adv_dollar_10d",
      "NYSE:THIN,,,12.50,,",
    ].join("\n"),
  });

  const row = load.rows["NYSE:THIN"];
  assert(row, "expected a row for NYSE:THIN");
  assertEquals(row.week52Low, null);
  assertEquals(row.advDollar10d, null, "a blank ADV must be unknown, not 0");
  assertEquals(row.closeScoreDate, 12.5);
});

Deno.test("classifyPicksLoad reports a missing sidecar as absent, not an error", () => {
  // Older dates predate the sidecar entirely. A 404 must degrade the columns,
  // never fault the dashboard's market-data load.
  const load = classifyPicksLoad({ ok: false, status: 404, text: "" });

  assertEquals(load.state, "absent");
  assertEquals(Object.keys(load.rows).length, 0);
});

Deno.test("classifyPicksLoad fails loud on a sidecar whose header is wrong", () => {
  // A fetched-but-unusable file is a genuine fault: it must be reported, not
  // quietly reconciled as "no picks".
  const load = classifyPicksLoad({
    ok: true,
    status: 200,
    text: "symbol,junk\nNYSE:GOOD,1",
  });

  assertEquals(load.state, "error");
  assertEquals(load.reason, "bad-header");
  assertEquals(Object.keys(load.rows).length, 0);
});

Deno.test("classifyPicksLoad fails loud on a header-only sidecar", () => {
  const load = classifyPicksLoad({
    ok: true,
    status: 200,
    text:
      "ticker,week52_low,week52_high,close_score_date,close_5d_prior,adv_dollar_10d",
  });

  assertEquals(load.state, "error");
  assertEquals(load.reason, "no-data-rows");
});

// ---------------------------------------------------------------------------
// Fixture 1 — populated (sidecar present)
// ---------------------------------------------------------------------------

Deno.test("populated: the six columns render from the sidecar and the score TSV", () => {
  const rows =
    classifyPicksLoad({ ok: true, status: 200, text: HEALTHY_SIDECAR }).rows;
  const values = pickColumnValues({
    sidecar: rows["NYSE:GOOD"],
    eps: 8, // 8 / 100 = 8% earnings yield — comfortably strong
    buyPrice: 101,
    series: [],
    scoreDate: new Date("2026-07-19"),
  });

  assertEquals(values.adv, 8000000);
  assertEquals(values.lots, 8000000 / PARCEL_DOLLARS);
  assertEquals(values.price, 100, "the sidecar's score-date close wins");
  assertEquals(values.position, 0.5);
  assertEquals(values.earningsYield, 0.08);

  const detail = pickDetailCells(values);
  assertEquals(tdCells(detail).length, 5);
  assertEquals(cellText(detail, 0), "$8.00M");
  assertEquals(cellText(detail, 1), "400");
  assertEquals(cellText(detail, 2), "+2.0%");
  assertEquals(cellText(detail, 3), "+8.0%");
  assertEquals(cellText(detail, 4), "50.0%");
});

Deno.test("populated: a healthy liquid name with a strong yield shows 🟢 and 💰", () => {
  const values = pickColumnValues({
    sidecar: {
      week52Low: 50,
      week52High: 150,
      closeScoreDate: 100,
      close5dPrior: 98,
      advDollar10d: 8000000,
    },
    eps: 8,
  });

  const cell = trafficLightCell(values);
  assertStringIncludes(cell, "🟢");
  assertStringIncludes(cell, WARNINGS.STRONG_EY.emoji);
  assert(!cell.includes("🔴"), "a healthy name must not render red");
});

Deno.test("populated: a thin-ADV name shows 🔴 and 🫗", () => {
  // Under MIN_RED_LOTS parcels a day is the major liquidity warning.
  const thinAdv = (MIN_RED_LOTS - 10) * PARCEL_DOLLARS;
  const values = pickColumnValues({
    sidecar: {
      week52Low: 50,
      week52High: 150,
      closeScoreDate: 100,
      close5dPrior: 98,
      advDollar10d: thinAdv,
    },
    eps: 8,
  });

  const cell = trafficLightCell(values);
  assertStringIncludes(cell, "🔴");
  assertStringIncludes(cell, WARNINGS.POOR_LIQUIDITY.emoji);
  assertStringIncludes(cell, WARNINGS.POOR_LIQUIDITY.label);
});

Deno.test("populated: sitting at the 52-week high without a strong yield shows 🟠 and 📈", () => {
  const values = pickColumnValues({
    sidecar: {
      week52Low: 50,
      week52High: 100,
      closeScoreDate: 100, // exactly at the high
      close5dPrior: 99,
      advDollar10d: MIN_AMBER_LOTS * PARCEL_DOLLARS * 2,
    },
    // Between the weak and the strong cut: not a major warning, but not strong
    // enough to excuse being at the high.
    eps: 4,
  });

  const cell = trafficLightCell(values);
  assertStringIncludes(cell, "🟠");
  assertStringIncludes(cell, WARNINGS.AT_HIGH.emoji);
  assert(!cell.includes("🔴"), "a minor warning must not render red");
});

Deno.test("populated: a negative EPS renders a NEGATIVE yield, never a blank", () => {
  const values = pickColumnValues({
    sidecar: {
      week52Low: 50,
      week52High: 150,
      closeScoreDate: 100,
      close5dPrior: 98,
      advDollar10d: 8000000,
    },
    eps: -2.5,
  });

  assertEquals(values.earningsYield, -0.025);
  assertEquals(cellText(pickDetailCells(values), 3), "-2.5%");
  const cell = trafficLightCell(values);
  assertStringIncludes(cell, WARNINGS.NEGATIVE_EY.emoji);
  assertStringIncludes(cell, "🔴");
});

Deno.test("populated: a 5-day fall renders signed and trips the 🪃 warning", () => {
  const values = pickColumnValues({
    sidecar: {
      week52Low: 50,
      week52High: 150,
      closeScoreDate: 85,
      close5dPrior: 100,
      advDollar10d: 8000000,
    },
    eps: 8,
  });

  assertEquals(cellText(pickDetailCells(values), 2), "-15.0%");
  assertStringIncludes(trafficLightCell(values), WARNINGS.BIG_DROP.emoji);
});

// ---------------------------------------------------------------------------
// Fixture 2 — partly populated (no sidecar, in-page CSV present)
// ---------------------------------------------------------------------------

Deno.test("partly populated: ADV, Lots and yield fall back to the in-page CSV", () => {
  const scoreDate = new Date("2026-07-20");
  const series = [
    { date: new Date("2026-07-20"), low: 100, volume: 60000 },
    // A row AFTER the score date must never leak into the trailing window.
    { date: new Date("2026-07-21"), low: 100, volume: 999999999 },
  ];

  const values = pickColumnValues({
    sidecar: null,
    series,
    scoreDate,
    eps: 8,
    buyPrice: 100,
  });

  assertEquals(
    values.adv,
    6000000,
    "ADV comes from volume × low on the score date",
  );
  assertEquals(values.lots, 300);
  assertEquals(
    values.price,
    100,
    "the buy price stands in for the sidecar close",
  );
  assertEquals(values.earningsYield, 0.08);
  // No sidecar ⇒ no 52-week range and no prior close: unknown, never invented.
  assertEquals(values.position, null);
  assertEquals(values.fiveDayReturn, null);

  const detail = pickDetailCells(values);
  assertEquals(cellText(detail, 0), "$6.00M");
  assertEquals(cellText(detail, 1), "300");
  assertEquals(cellText(detail, 2), "");
  assertEquals(cellText(detail, 3), "+8.0%");
  assertEquals(cellText(detail, 4), "");
});

Deno.test("partly populated: a known thin ADV still warns even though the range is unknown", () => {
  // "An unknown value must never manufacture a warning, and must never suppress
  // one either" — the liquidity warning survives the missing sidecar.
  const values = pickColumnValues({
    sidecar: null,
    series: [{ date: new Date("2026-07-20"), low: 10, volume: 1000 }],
    scoreDate: new Date("2026-07-20"),
    buyPrice: 10,
  });

  const cell = trafficLightCell(values);
  assertStringIncludes(cell, "🔴");
  assertStringIncludes(cell, WARNINGS.POOR_LIQUIDITY.emoji);
});

Deno.test("partly populated: a score-date-forward CSV still yields an ADV, flagged as approximate", () => {
  // The committed per-date CSV starts ON OR AFTER the score date, so on most
  // dates nothing sits on or before it and the trailing window is empty. The
  // columns must still populate — from the earliest window the page has — and
  // must say the figure is not as at the score date.
  const scoreDate = new Date("2026-07-19"); // a Sunday: no trading row
  const series = Array.from({ length: 12 }, (_, day) => ({
    date: new Date(2026, 6, 20 + day),
    low: 100,
    volume: 60000,
  }));

  const values = pickColumnValues({ sidecar: null, series, scoreDate, eps: 8 });

  assertEquals(values.adv, 6000000);
  assertEquals(values.advSource, "forward");
  // The "this is not as at the score date" caveat moved from the cell's title
  // attribute into the ADV working popover (issue #841): Bootstrap promotes a
  // trigger's `title` to the popover HEADING, so the caveat is stated in the
  // body instead, where it can spell out which window was used.
  assertStringIncludes(
    advWorking(values),
    "APPROXIMATE",
  );
});

Deno.test("partly populated: a usable trailing window is never labelled approximate", () => {
  const values = pickColumnValues({
    sidecar: null,
    series: [{ date: new Date("2026-07-20"), low: 100, volume: 60000 }],
    scoreDate: new Date("2026-07-20"),
    eps: 8,
  });

  assertEquals(values.advSource, "trailing");
  assert(
    !advWorking(values).includes("APPROXIMATE"),
    "an as-at-the-score-date ADV must not be flagged approximate",
  );
});

Deno.test("the sidecar's ADV always wins over the in-page fallback", () => {
  const values = pickColumnValues({
    sidecar: {
      week52Low: 50,
      week52High: 150,
      closeScoreDate: 100,
      close5dPrior: 98,
      advDollar10d: 8000000,
    },
    series: [{ date: new Date("2026-07-19"), low: 1, volume: 1 }],
    scoreDate: new Date("2026-07-19"),
  });

  assertEquals(values.adv, 8000000);
  assertEquals(values.advSource, "sidecar");
});

// ---------------------------------------------------------------------------
// Fixture 3 — empty (2024: no volume column, no eps, no sidecar)
// ---------------------------------------------------------------------------

Deno.test("empty: a 2024 row renders blank cells and the neutral unknown light", () => {
  const values = pickColumnValues({
    sidecar: null,
    // Pre-volume-column CSV: the rows exist but carry no volume.
    series: [
      { date: new Date("2024-10-01"), low: 12.5, volume: null },
      { date: new Date("2024-10-02"), low: 12.7, volume: null },
    ],
    scoreDate: new Date("2024-10-02"),
    eps: null,
    buyPrice: 12.6,
  });

  assertEquals(values.adv, null);
  assertEquals(values.lots, null);
  assertEquals(values.earningsYield, null);
  assertEquals(values.position, null);
  assertEquals(values.fiveDayReturn, null);

  const detail = pickDetailCells(values);
  assertEquals(tdCells(detail).length, 5);
  for (let index = 0; index < 5; index++) {
    assertEquals(cellText(detail, index), "", `cell ${index} must be blank`);
  }

  const cell = trafficLightCell(values);
  assertStringIncludes(cell, UNKNOWN_LIGHT);
  assert(!cell.includes("🟢"), "an unknown light must not read as healthy");
  assert(!cell.includes("🔴"), "an unknown light must not read as a warning");
  assertEquals(
    values.trafficLight.warnings.length,
    0,
    "no manufactured warnings",
  );
});

Deno.test("empty: rendering a 2024 row logs nothing to console.error", () => {
  const original = console.error;
  const captured: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    captured.push(args);
  };
  try {
    const values = pickColumnValues({
      sidecar: null,
      series: [],
      scoreDate: new Date("2024-10-02"),
      eps: null,
      buyPrice: null,
    });
    trafficLightCell(values);
    pickDetailCells(values);
  } finally {
    console.error = original;
  }
  assertEquals(captured.length, 0, "the empty case must render without errors");
});

Deno.test("empty: a wholly absent row still renders the full complement of cells", () => {
  const values = pickColumnValues({});
  assertEquals(tdCells(pickDetailCells(values)).length, PICK_COLUMN_COUNT - 1);
  assertEquals(tdCells(trafficLightCell(values)).length, 1);
});

// ---------------------------------------------------------------------------
// Formatting and escaping
// ---------------------------------------------------------------------------

Deno.test("formatSignedPercent signs the value and blanks the unknown", () => {
  assertEquals(formatSignedPercent(0.0812), "+8.1%");
  assertEquals(formatSignedPercent(-0.0812), "-8.1%");
  assertEquals(formatSignedPercent(0), "0.0%");
  assertEquals(formatSignedPercent(null), "");
  assertEquals(formatSignedPercent("not-a-number"), "");
});

Deno.test("formatRangePercent renders the 52-week position unsigned", () => {
  assertEquals(formatRangePercent(0.5), "50.0%");
  assertEquals(formatRangePercent(1), "100.0%");
  assertEquals(formatRangePercent(0), "0.0%");
  assertEquals(formatRangePercent(null), "");
});

Deno.test("the traffic-light cell escapes its title through the shared helper", () => {
  const values = pickColumnValues({ sidecar: null });
  // Force an untrusted-looking label through the title path.
  values.trafficLight.warnings = [{
    emoji: "🚫",
    label: '"><script>x</script>',
  }];
  const cell = trafficLightCell(values);

  assert(
    !cell.includes("<script>"),
    "the title must be escaped by docs/escape.js, never interpolated raw",
  );
  assertStringIncludes(cell, "&lt;script&gt;");
});
