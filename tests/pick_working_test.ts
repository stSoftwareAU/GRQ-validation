// "Show the working" popovers, accessible wording and the warning legend for
// the pick-detail columns (issue #841, sub-issue of #835).
//
// The dashboard's house style is that every number explains itself. A bare
// `🟠 📈` in a table cell is unreadable until you know 📈 means "within 15% of
// the 52-week high, without a strong earnings yield", so each pick-detail value
// opens a popover showing its inputs, its formula and its result, and a legend
// below the table decodes every glyph.
//
// These tests drive the REAL shipped kernel — `docs/pick_working.js`, published
// on `globalThis.GRQPickWorking` and consumed verbatim by `docs/app.js` and
// `docs/pick_columns.js`. The maths is NOT re-tested here
// (`tests/pick_details_test.ts` owns the thresholds); what is asserted is the
// EXPLANATION contract: the inputs and the formula are shown, an unknown value
// says why it is blank, the traffic light names every warning with its
// threshold and the value that tripped it, and the legend decodes every glyph.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import "../docs/escape.js";
import "../docs/volume_recommend.js";
import "../docs/pick_details.js";
import "../docs/pick_working.js";
import "../docs/pick_columns.js";

interface PickWarning {
  emoji: string;
  label: string;
}

interface LegendEntry {
  kind: string;
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
  advSource: string | null;
  lots: number | null;
  fiveDayReturn: number | null;
  earningsYield: number | null;
  position: number | null;
  inputs: Record<string, number | boolean | null>;
  trafficLight: TrafficLight;
}

const g = globalThis as unknown as {
  GRQPickWorking: {
    PICK_FIELDS: Record<string, string>;
    UNKNOWN_LIGHT: string;
    isPickField: (field: unknown) => boolean;
    working: (input: Record<string, unknown>) => string;
    warningLines: (values: unknown) => string[];
    lightSummary: (verdict: unknown) => string;
    accessibleLightText: (verdict: unknown) => string;
    hasAnyWarning: (rows: unknown) => boolean;
    legendEntries: () => LegendEntry[];
    legendHtml: () => string;
  };
  GRQPickColumns: {
    UNKNOWN_LIGHT: string;
    pickColumnValues: (input: Record<string, unknown>) => PickValues;
  };
  GRQPickDetails: {
    MIN_RED_LOTS: number;
    MIN_AMBER_LOTS: number;
    PARCEL_DOLLARS: number;
    EY_WEAK_CUT: number;
    EY_STRONG_CUT: number;
    HIGH_CUT: number;
    LOW_CUT: number;
    DROP_CUT: number;
    DELIST_PRICE: number;
    WARNINGS: Record<string, PickWarning>;
  };
};

const {
  PICK_FIELDS,
  isPickField,
  working,
  warningLines,
  accessibleLightText,
  hasAnyWarning,
  legendEntries,
  legendHtml,
} = g.GRQPickWorking;
const { pickColumnValues } = g.GRQPickColumns;
const { WARNINGS } = g.GRQPickDetails;

const SCORE_DATE = new Date("2026-07-19");
const CONTEXT = { scoreDateISO: "2026-07-19", weekdayWindow: 10 };

/** A sidecar row as `classifyPicksLoad` would parse it. */
function sidecar(overrides: Record<string, number | null> = {}) {
  return {
    week52Low: 50,
    week52High: 150,
    closeScoreDate: 100,
    close5dPrior: 98,
    advDollar10d: 8000000,
    ...overrides,
  };
}

/** Values for a fully-populated row: liquid, mid-range, strong yield. */
function healthyValues(overrides: Record<string, unknown> = {}) {
  return pickColumnValues({
    sidecar: sidecar(),
    series: [],
    scoreDate: SCORE_DATE,
    eps: 8,
    buyPrice: 100,
    ...overrides,
  });
}

function body(field: string, values: unknown) {
  return working({ field, values, context: CONTEXT });
}

// ---------------------------------------------------------------------------
// Field dispatch
// ---------------------------------------------------------------------------

Deno.test("isPickField recognises exactly the six pick-detail fields", () => {
  const fields = Object.values(PICK_FIELDS);
  assertEquals(fields.length, 6);
  for (const field of fields) {
    assert(isPickField(field), `${field} must be a pick field`);
  }
  for (const other of ["buy-price", "stars", "", "pick", null, undefined]) {
    assert(!isPickField(other), `${String(other)} must not be a pick field`);
  }
});

Deno.test("working throws for a field it does not own rather than rendering an empty body", () => {
  let threw = false;
  try {
    working({ field: "buy-price", values: healthyValues(), context: CONTEXT });
  } catch (error) {
    threw = true;
    assertStringIncludes(String(error), "buy-price");
  }
  assert(threw, "an unknown field must fail loud, not return an empty popover");
});

// ---------------------------------------------------------------------------
// ADV — the window, the source and the formula
// ---------------------------------------------------------------------------

Deno.test("ADV working shows the window, the sidecar source and the mean", () => {
  const text = body(PICK_FIELDS.ADV, healthyValues());
  assertStringIncludes(text, "mean(daily volume × daily low price)");
  assertStringIncludes(text, "10 trading days to 2026-07-19");
  assertStringIncludes(text, "pick-details sidecar");
  assertStringIncludes(text, "$8.00M");
});

Deno.test("ADV working names the in-page CSV fallback when there is no sidecar", () => {
  const values = pickColumnValues({
    sidecar: null,
    series: [{ date: new Date("2026-07-18"), low: 100, volume: 60000 }],
    scoreDate: SCORE_DATE,
    eps: 8,
    buyPrice: 100,
  });
  const text = body(PICK_FIELDS.ADV, values);
  assertStringIncludes(text, "in-page market CSV");
  assertStringIncludes(text, "$6.00M");
});

Deno.test("ADV working flags the forward window as approximate", () => {
  // The committed per-date CSV is score-date-FORWARD, so most dates fall back
  // to the ten days AFTER the score date. The popover must say so.
  const values = pickColumnValues({
    sidecar: null,
    series: [{ date: new Date("2026-07-20"), low: 100, volume: 60000 }],
    scoreDate: SCORE_DATE,
    eps: 8,
    buyPrice: 100,
  });
  assertEquals(values.advSource, "forward");
  const text = body(PICK_FIELDS.ADV, values);
  assertStringIncludes(text, "APPROXIMATE");
  assertStringIncludes(text, "FOLLOWING the score date");
});

Deno.test("ADV working explains a blank cell instead of showing an empty body", () => {
  const values = pickColumnValues({
    sidecar: null,
    series: [],
    scoreDate: SCORE_DATE,
    buyPrice: null,
  });
  assertEquals(values.adv, null);
  const text = body(PICK_FIELDS.ADV, values);
  assertStringIncludes(text, "Unknown:");
  assertStringIncludes(text, "no pick-details sidecar");
  assert(text.trim().length > 0, "an unknown value still gets a full body");
});

// ---------------------------------------------------------------------------
// Lots — the division and the band it falls in
// ---------------------------------------------------------------------------

Deno.test("Lots working shows ADV ÷ parcel = lots and names the band", () => {
  const text = body(PICK_FIELDS.LOTS, healthyValues());
  assertStringIncludes(text, "$20,000");
  assertStringIncludes(text, "$8.00M ÷ $20,000 = 400 lots");
  assertStringIncludes(text, `${g.GRQPickDetails.MIN_AMBER_LOTS} lots or more`);
  assertStringIncludes(text, "no liquidity warning");
});

Deno.test("Lots working names the poor-liquidity band for a thin name", () => {
  const values = healthyValues({
    sidecar: sidecar({ advDollar10d: 200000 }), // 10 lots
  });
  const text = body(PICK_FIELDS.LOTS, values);
  assertStringIncludes(text, "= $200.00k ÷ $20,000 = 10 lots");
  assertStringIncludes(text, `under ${g.GRQPickDetails.MIN_RED_LOTS} lots`);
  assertStringIncludes(text, "major warning");
  assertStringIncludes(text, WARNINGS.POOR_LIQUIDITY.emoji);
});

Deno.test("Lots working names the thin-liquidity band between the two floors", () => {
  const values = healthyValues({
    sidecar: sidecar({ advDollar10d: 2000000 }), // 100 lots
  });
  const text = body(PICK_FIELDS.LOTS, values);
  assertStringIncludes(text, "= $2.00M ÷ $20,000 = 100 lots");
  assertStringIncludes(text, "thin liquidity");
  assertStringIncludes(text, WARNINGS.THIN_LIQUIDITY.emoji);
});

Deno.test("Lots working says why it is blank when the ADV is unknown", () => {
  const values = pickColumnValues({
    sidecar: null,
    series: [],
    scoreDate: SCORE_DATE,
    buyPrice: null,
  });
  const text = body(PICK_FIELDS.LOTS, values);
  assertStringIncludes(text, "Unknown: the ADV is unknown");
  assertStringIncludes(text, "no pick-details sidecar");
});

// ---------------------------------------------------------------------------
// Earnings yield — both inputs, the formula, the band
// ---------------------------------------------------------------------------

Deno.test("Earnings Yield working shows eps ÷ score-date price with both inputs", () => {
  const text = body(PICK_FIELDS.EARNINGS_YIELD, healthyValues());
  assertStringIncludes(text, "earnings per share ÷ the price");
  assertStringIncludes(text, "$8.00 ÷ $100.00");
  assertStringIncludes(text, "+8.0%");
  assertStringIncludes(text, "strong earnings yield");
  assertStringIncludes(text, WARNINGS.STRONG_EY.emoji);
});

Deno.test("Earnings Yield working reports a negative yield as loss making", () => {
  const text = body(PICK_FIELDS.EARNINGS_YIELD, healthyValues({ eps: -4 }));
  assertStringIncludes(text, "$-4.00 ÷ $100.00");
  assertStringIncludes(text, "-4.0%");
  assertStringIncludes(text, WARNINGS.NEGATIVE_EY.emoji);
  assertStringIncludes(text, "major warning");
});

Deno.test("Earnings Yield working blames the missing eps column on a pre-eps date", () => {
  const values = healthyValues({ eps: undefined });
  assertEquals(values.earningsYield, null);
  const text = body(PICK_FIELDS.EARNINGS_YIELD, values);
  assertStringIncludes(text, "Unknown:");
  assertStringIncludes(text, "no eps for this stock");
  // The input it DOES have is still shown, so the reader can see the half it has.
  assertStringIncludes(text, "Score-date price: $100.00");
});

// ---------------------------------------------------------------------------
// 52-week position — the range, the window, the cuts
// ---------------------------------------------------------------------------

Deno.test("52-Week Position working shows the range arithmetic and its window", () => {
  const text = body(PICK_FIELDS.POSITION, healthyValues());
  assertStringIncludes(
    text,
    "(price − 52-week low) ÷ (52-week high − 52-week low)",
  );
  assertStringIncludes(text, "($100.00 − $50.00) ÷ ($150.00 − $50.00)");
  assertStringIncludes(text, "50.0% of the 52-week range");
  assertStringIncludes(text, "52 weeks to 2026-07-19");
  assertStringIncludes(text, "85.0% or above");
  assertStringIncludes(text, "15.0% or below");
});

Deno.test("52-Week Position working says why it is blank without a sidecar", () => {
  const values = pickColumnValues({
    sidecar: null,
    series: [],
    scoreDate: SCORE_DATE,
    eps: 8,
    buyPrice: 100,
  });
  const text = body(PICK_FIELDS.POSITION, values);
  assertStringIncludes(text, "Unknown:");
  assertStringIncludes(text, "52-week high and low are unknown");
});

// ---------------------------------------------------------------------------
// 5-day return — the two closes
// ---------------------------------------------------------------------------

Deno.test("5-Day Return working shows both closes and the score date", () => {
  const text = body(PICK_FIELDS.FIVE_DAY_RETURN, healthyValues());
  assertStringIncludes(text, "($100.00 ÷ $98.00) − 1");
  assertStringIncludes(text, "+2.0%");
  assertStringIncludes(text, "2026-07-19");
  assertStringIncludes(text, "five trading days earlier");
});

Deno.test("5-Day Return working says why it is blank when the prior close is missing", () => {
  const values = healthyValues({ sidecar: sidecar({ close5dPrior: null }) });
  assertEquals(values.fiveDayReturn, null);
  const text = body(PICK_FIELDS.FIVE_DAY_RETURN, values);
  assertStringIncludes(text, "Unknown:");
  assertStringIncludes(text, "close five trading days");
});

// ---------------------------------------------------------------------------
// The traffic light — every warning, its threshold, and red vs amber
// ---------------------------------------------------------------------------

Deno.test("traffic-light working names each warning with its threshold and the value that tripped it", () => {
  // 10 lots (poor liquidity, major) and a 1% earnings yield (weak, major).
  const values = healthyValues({
    sidecar: sidecar({ advDollar10d: 200000 }),
    eps: 1,
  });
  const text = body(PICK_FIELDS.LIGHT, values);

  assertStringIncludes(text, "🔴");
  assertStringIncludes(text, "Red");
  assertStringIncludes(text, WARNINGS.POOR_LIQUIDITY.label);
  assertStringIncludes(text, `under ${g.GRQPickDetails.MIN_RED_LOTS} lots`);
  assertStringIncludes(text, "value: 10 lots");
  assertStringIncludes(text, WARNINGS.WEAK_EY.label);
  assertStringIncludes(text, "value: +1.0%");
  assertStringIncludes(text, "major — turns the light red");
});

Deno.test("traffic-light working states which condition makes the light amber", () => {
  // Mid-band liquidity (100 lots) is the only warning: minor ⇒ amber.
  const values = healthyValues({
    sidecar: sidecar({ advDollar10d: 2000000 }),
    eps: 3,
  });
  const text = body(PICK_FIELDS.LIGHT, values);
  assertStringIncludes(text, "🟠");
  assertStringIncludes(text, "Amber");
  assertStringIncludes(text, "minor — turns the light amber");
  // Both rules are spelled out, so the reader sees why it is amber not red.
  assertStringIncludes(text, "Major (🔴)");
  assertStringIncludes(text, "Minor (🟠)");
});

Deno.test("traffic-light working marks a 52-week extreme excused by a strong yield", () => {
  // At the high (100%) but with a strong (8%) yield: reported, not tripping.
  const values = healthyValues({
    sidecar: sidecar({ closeScoreDate: 150 }),
    buyPrice: 150,
    eps: 12,
  });
  const text = body(PICK_FIELDS.LIGHT, values);
  assertStringIncludes(text, WARNINGS.AT_HIGH.emoji);
  assertStringIncludes(
    text,
    "strong earnings yield stops this tripping the light",
  );
  assertStringIncludes(text, "🟢");
});

Deno.test("traffic-light working reports a clean row as green with no warnings", () => {
  const text = body(PICK_FIELDS.LIGHT, healthyValues({ eps: 3 }));
  assertStringIncludes(text, "🟢");
  assertStringIncludes(text, "No warning fired");
});

Deno.test("traffic-light working names the figures missing behind an unknown light", () => {
  const values = pickColumnValues({
    sidecar: null,
    series: [],
    scoreDate: SCORE_DATE,
    buyPrice: null,
  });
  const text = body(PICK_FIELDS.LIGHT, values);
  assertStringIncludes(text, g.GRQPickWorking.UNKNOWN_LIGHT);
  assertStringIncludes(text, "Not known as at the score date");
  assertStringIncludes(text, "the 52-week position");
});

Deno.test("warningLines covers every warning in the shared vocabulary", () => {
  // Each warning must produce a line carrying its emoji, its threshold and a
  // value — no warning may render as a bare glyph.
  const rows = [
    healthyValues({
      sidecar: sidecar({ closeScoreDate: 0.5 }),
      buyPrice: 0.5,
      eps: 0.4,
    }),
    healthyValues({ sidecar: sidecar({ advDollar10d: 200000 }), eps: 1 }),
    healthyValues({ sidecar: sidecar({ advDollar10d: 2000000 }), eps: 3 }),
    healthyValues({ sidecar: sidecar({ closeScoreDate: 150 }), buyPrice: 150 }),
    healthyValues({
      sidecar: sidecar({ closeScoreDate: 51 }),
      buyPrice: 51,
      eps: 3,
    }),
    healthyValues({ sidecar: sidecar({ close5dPrior: 200 }), eps: 3 }),
    healthyValues({ eps: -4 }),
  ];
  const lines = rows.flatMap((row) => warningLines(row));
  for (const key of Object.keys(WARNINGS)) {
    const { emoji } = WARNINGS[key];
    assert(
      lines.some((line) => line.startsWith(emoji)),
      `no working line for the ${key} (${emoji}) warning`,
    );
  }
  for (const line of lines) {
    assertStringIncludes(line, "threshold:");
    assertStringIncludes(line, "value:");
  }
});

// ---------------------------------------------------------------------------
// Accessible text — the meaning must not be colour- or glyph-only
// ---------------------------------------------------------------------------

Deno.test("accessibleLightText names the light in words and lists every warning", () => {
  const values = healthyValues({
    sidecar: sidecar({ advDollar10d: 2000000 }),
    eps: 3,
  });
  const text = accessibleLightText(values.trafficLight);
  assertStringIncludes(text, "Amber");
  assertStringIncludes(text, WARNINGS.THIN_LIQUIDITY.label);
  // No colour word alone, and no bare emoji: the wording carries the meaning.
  assert(
    !/^[🟢🟠🔴⚪]/.test(text),
    "the accessible text must not lead with the emoji",
  );
});

Deno.test("accessibleLightText describes a green and an unknown light too", () => {
  const green = accessibleLightText(healthyValues({ eps: 3 }).trafficLight);
  assertStringIncludes(green, "Green");
  assertStringIncludes(green, "no warnings");

  const unknown = accessibleLightText(
    pickColumnValues({
      sidecar: null,
      series: [],
      scoreDate: SCORE_DATE,
      buyPrice: null,
    }).trafficLight,
  );
  assertStringIncludes(unknown, "Unknown");
  assertStringIncludes(unknown, "not enough data");
});

// ---------------------------------------------------------------------------
// The legend
// ---------------------------------------------------------------------------

Deno.test("the legend decodes all four lights and all nine warning emojis", () => {
  const entries = legendEntries();
  assertEquals(entries.filter((e) => e.kind === "light").length, 4);
  assertEquals(entries.filter((e) => e.kind === "warning").length, 9);
  for (const key of Object.keys(WARNINGS)) {
    const entry = entries.find((e) => e.emoji === WARNINGS[key].emoji);
    assert(entry !== undefined, `the legend must decode ${key}`);
    assertEquals(entry?.label, WARNINGS[key].label);
  }
  for (const light of ["🟢", "🟠", "🔴", g.GRQPickWorking.UNKNOWN_LIGHT]) {
    assert(
      entries.some((e) => e.emoji === light),
      `the legend must decode the ${light} light`,
    );
  }
});

Deno.test("legendHtml hides the emoji from assistive tech and keeps the wording", () => {
  const html = legendHtml();
  assertStringIncludes(html, 'aria-hidden="true"');
  for (const key of Object.keys(WARNINGS)) {
    assertStringIncludes(html, WARNINGS[key].label);
  }
  // One list item per glyph, so nothing is dropped in rendering.
  assertEquals(html.split("<li").length - 1, legendEntries().length);
});

Deno.test("hasAnyWarning gates the legend on the loaded report", () => {
  const clean = healthyValues({ eps: 3 });
  assertEquals(clean.trafficLight.light, "🟢");
  assertEquals(
    hasAnyWarning([clean, clean]),
    false,
    "a clean report hides the legend",
  );

  const warned = healthyValues({
    sidecar: sidecar({ advDollar10d: 200000 }),
    eps: 1,
  });
  assertEquals(
    hasAnyWarning([clean, warned]),
    true,
    "one warned stock is enough to show the legend",
  );

  const unknown = pickColumnValues({
    sidecar: null,
    series: [],
    scoreDate: SCORE_DATE,
    buyPrice: null,
  });
  assertEquals(
    hasAnyWarning([unknown]),
    true,
    "an unknown light needs decoding too",
  );
  assertEquals(hasAnyWarning([]), false);
  assertEquals(hasAnyWarning(null), false);
});

// ---------------------------------------------------------------------------
// Single source of truth: the wording quotes the shared thresholds
// ---------------------------------------------------------------------------

Deno.test("the working text quotes the shared thresholds rather than its own numbers", () => {
  // Every number the explanation states must be derivable from the shared
  // constants, so retuning a threshold in docs/pick_details.js retunes the
  // wording with it.
  const d = g.GRQPickDetails;
  const percent = (fraction: number) => `${(fraction * 100).toFixed(1)}%`;

  const light = body(PICK_FIELDS.LIGHT, healthyValues({ eps: 3 }));
  assertStringIncludes(light, `$${d.DELIST_PRICE.toFixed(2)}`);
  assertStringIncludes(light, `under ${d.MIN_RED_LOTS} lots`);
  assertStringIncludes(light, percent(d.EY_WEAK_CUT));
  assertStringIncludes(light, percent(d.EY_STRONG_CUT));
  assertStringIncludes(light, percent(Math.abs(d.DROP_CUT)));
  assertStringIncludes(light, `${d.MIN_AMBER_LOTS} lots`);

  const position = body(PICK_FIELDS.POSITION, healthyValues());
  assertStringIncludes(position, percent(d.HIGH_CUT));
  assertStringIncludes(position, percent(d.LOW_CUT));

  const lots = body(PICK_FIELDS.LOTS, healthyValues());
  assertStringIncludes(lots, `$${d.PARCEL_DOLLARS.toLocaleString("en-AU")}`);
});
