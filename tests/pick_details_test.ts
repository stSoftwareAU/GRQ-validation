// Tests for the shared stock-pick metrics helper (issue #836, sub-issue of
// #835) — the single source of truth for lots, earnings yield, 5-day return,
// 52-week position and the pick traffic light consumed by every other #835
// sub-issue.
//
// These exercise the real shipped module, published on
// `globalThis.GRQPickDetails` by importing it, mirroring
// tests/volume_recommend_test.ts and tests/format_test.ts — the browser
// dashboard and these tests run the exact same file.
import { assert, assertEquals } from "@std/assert";
import "../docs/pick_details.js";

interface PickWarning {
  emoji: string;
  label: string;
}

interface TrafficLight {
  light: string;
  warnings: PickWarning[];
  majorWarn: boolean;
  minorWarn: boolean;
}

const g = globalThis as unknown as {
  GRQPickDetails: {
    PARCEL_DOLLARS: number;
    MIN_RED_LOTS: number;
    MIN_AMBER_LOTS: number;
    HIGH_CUT: number;
    LOW_CUT: number;
    DROP_CUT: number;
    EY_WEAK_CUT: number;
    EY_STRONG_CUT: number;
    DELIST_PRICE: number;
    lotsFromAdv: (advDollars: unknown) => number | null;
    earningsYield: (eps: unknown, price: unknown) => number | null;
    fiveDayReturn: (
      closeNow: unknown,
      closeFivePrior: unknown,
    ) => number | null;
    fiftyTwoWeekPosition: (
      price: unknown,
      low52: unknown,
      high52: unknown,
    ) => number | null;
    pickTrafficLight: (metrics: Record<string, unknown>) => TrafficLight;
    formatCompactMoney: (value: unknown) => string;
    formatCompactCount: (value: unknown) => string;
  };
};

const {
  PARCEL_DOLLARS,
  MIN_RED_LOTS,
  MIN_AMBER_LOTS,
  HIGH_CUT,
  LOW_CUT,
  DROP_CUT,
  EY_WEAK_CUT,
  EY_STRONG_CUT,
  DELIST_PRICE,
  lotsFromAdv,
  earningsYield,
  fiveDayReturn,
  fiftyTwoWeekPosition,
  pickTrafficLight,
  formatCompactMoney,
  formatCompactCount,
} = g.GRQPickDetails;

/** Emoji list of a traffic-light result, for order-sensitive assertions. */
function emojis(result: TrafficLight): string[] {
  return result.warnings.map((warning) => warning.emoji);
}

/** A healthy green pick: liquid, mid-range, flat, strong earnings yield. */
function healthy(overrides: Record<string, unknown> = {}) {
  return {
    price: 10,
    lots: 500,
    position: 0.5,
    fiveDayReturn: 0.01,
    earningsYield: 0.08,
    ...overrides,
  };
}

Deno.test("pick_details publishes helpers on globalThis.GRQPickDetails", () => {
  assertEquals(typeof lotsFromAdv, "function");
  assertEquals(typeof earningsYield, "function");
  assertEquals(typeof fiveDayReturn, "function");
  assertEquals(typeof fiftyTwoWeekPosition, "function");
  assertEquals(typeof pickTrafficLight, "function");
  assertEquals(typeof formatCompactMoney, "function");
  assertEquals(typeof formatCompactCount, "function");
});

Deno.test("thresholds are the user's spreadsheet constants, unchanged", () => {
  assertEquals(PARCEL_DOLLARS, 20000);
  assertEquals(MIN_RED_LOTS, 50);
  assertEquals(MIN_AMBER_LOTS, 200);
  assertEquals(HIGH_CUT, 0.85);
  assertEquals(LOW_CUT, 0.15);
  assertEquals(DROP_CUT, -0.10);
  assertEquals(EY_WEAK_CUT, 0.02);
  assertEquals(EY_STRONG_CUT, 0.06);
  assertEquals(DELIST_PRICE, 1);
});

// --- lotsFromAdv -----------------------------------------------------------

Deno.test("lotsFromAdv divides dollar ADV by the $20k parcel", () => {
  assertEquals(lotsFromAdv(1_000_000), 50);
  assertEquals(lotsFromAdv(4_000_000), 200);
  assertEquals(lotsFromAdv(30_000), 1.5);
  // Numeric strings come from interpolated CSV cells.
  assertEquals(lotsFromAdv("1000000"), 50);
});

Deno.test("lotsFromAdv returns null for unusable ADV, never NaN", () => {
  assertEquals(lotsFromAdv(null), null);
  assertEquals(lotsFromAdv(undefined), null);
  assertEquals(lotsFromAdv(""), null);
  assertEquals(lotsFromAdv("not-a-number"), null);
  assertEquals(lotsFromAdv(Number.NaN), null);
  assertEquals(lotsFromAdv(Number.POSITIVE_INFINITY), null);
  assertEquals(lotsFromAdv(-5), null);
});

Deno.test("lotsFromAdv treats a genuine zero ADV as zero lots", () => {
  // Zero dollar volume is real data (the name did not trade), not a gap.
  assertEquals(lotsFromAdv(0), 0);
});

// --- earningsYield ---------------------------------------------------------

Deno.test("earningsYield is EPS over price and is not clamped positive", () => {
  assertEquals(earningsYield(1, 20), 0.05);
  assertEquals(earningsYield(-2, 10), -0.2);
  assertEquals(earningsYield(0, 10), 0);
  assertEquals(earningsYield("1", "20"), 0.05);
});

Deno.test("earningsYield returns null for unusable inputs", () => {
  assertEquals(earningsYield(1, 0), null);
  assertEquals(earningsYield(1, -10), null);
  assertEquals(earningsYield(null, 10), null);
  assertEquals(earningsYield("", 10), null);
  assertEquals(earningsYield(1, "not-a-number"), null);
});

// --- fiveDayReturn ---------------------------------------------------------

Deno.test("fiveDayReturn is the ratio of now to five sessions prior", () => {
  assertEquals(fiveDayReturn(11, 10), 0.10000000000000009);
  assertEquals(fiveDayReturn(9, 10), -0.09999999999999998);
  assertEquals(fiveDayReturn(10, 10), 0);
});

Deno.test("fiveDayReturn returns null for unusable inputs", () => {
  assertEquals(fiveDayReturn(10, 0), null);
  assertEquals(fiveDayReturn(10, null), null);
  assertEquals(fiveDayReturn(null, 10), null);
  assertEquals(fiveDayReturn("not-a-number", 10), null);
  assertEquals(fiveDayReturn(10, -1), null);
});

// --- fiftyTwoWeekPosition --------------------------------------------------

Deno.test("fiftyTwoWeekPosition places price within the 52-week range", () => {
  assertEquals(fiftyTwoWeekPosition(15, 10, 20), 0.5);
  assertEquals(fiftyTwoWeekPosition(10, 10, 20), 0);
  assertEquals(fiftyTwoWeekPosition(20, 10, 20), 1);
  assertEquals(fiftyTwoWeekPosition("19", "10", "20"), 0.9);
});

Deno.test("fiftyTwoWeekPosition returns null for a zero-width range", () => {
  // high52 == low52 would divide by zero; an equal high and low carries no
  // meaningful position.
  assertEquals(fiftyTwoWeekPosition(10, 10, 10), null);
  assertEquals(fiftyTwoWeekPosition(10, 20, 15), null);
});

Deno.test("fiftyTwoWeekPosition returns null for unusable inputs", () => {
  assertEquals(fiftyTwoWeekPosition(null, 10, 20), null);
  assertEquals(fiftyTwoWeekPosition(15, "", 20), null);
  assertEquals(fiftyTwoWeekPosition(15, 10, "not-a-number"), null);
});

// --- pickTrafficLight: green ----------------------------------------------

Deno.test("pickTrafficLight is green for a liquid mid-range strong-EY pick", () => {
  const result = pickTrafficLight(healthy());
  assertEquals(result.light, "🟢");
  assertEquals(result.majorWarn, false);
  assertEquals(result.minorWarn, false);
  // A strong earnings yield is still annotated.
  assertEquals(emojis(result), ["💰"]);
});

// --- pickTrafficLight: red (each major cause) ------------------------------

Deno.test("pickTrafficLight is red when price is below the delist floor", () => {
  const result = pickTrafficLight(healthy({ price: 0.99 }));
  assertEquals(result.light, "🔴");
  assertEquals(result.majorWarn, true);
  assertEquals(emojis(result), ["🚫", "💰"]);
});

Deno.test("pickTrafficLight is not red at exactly the delist price", () => {
  const result = pickTrafficLight(healthy({ price: 1 }));
  assertEquals(result.light, "🟢");
  assertEquals(emojis(result), ["💰"]);
});

Deno.test("pickTrafficLight is red on poor liquidity below 50 lots", () => {
  const result = pickTrafficLight(healthy({ lots: 49.9 }));
  assertEquals(result.light, "🔴");
  assertEquals(result.majorWarn, true);
  assertEquals(emojis(result), ["🫗", "💰"]);
});

Deno.test("pickTrafficLight is red on a weak earnings yield", () => {
  const result = pickTrafficLight(healthy({ earningsYield: 0.019 }));
  assertEquals(result.light, "🔴");
  assertEquals(result.majorWarn, true);
  assertEquals(emojis(result), ["🩸"]);
});

Deno.test("pickTrafficLight is red with 🔥 for a negative earnings yield", () => {
  // A negative EPS gives a negative yield: 🔥, never 🩸, and always red.
  const ey = earningsYield(-1.5, 10);
  assertEquals(ey, -0.15);
  const result = pickTrafficLight(healthy({ earningsYield: ey }));
  assertEquals(result.light, "🔴");
  assertEquals(result.majorWarn, true);
  assertEquals(emojis(result), ["🔥"]);
});

Deno.test("a red major cause outranks any minor cause", () => {
  const result = pickTrafficLight(
    healthy({ price: 0.5, lots: 10, fiveDayReturn: -0.5, position: 0.99 }),
  );
  assertEquals(result.light, "🔴");
  assertEquals(result.majorWarn, true);
  assertEquals(result.minorWarn, true);
  assertEquals(emojis(result), ["🚫", "🫗", "📈", "🪃", "💰"]);
});

// --- pickTrafficLight: amber (each minor cause) ----------------------------

Deno.test("pickTrafficLight is amber on thin liquidity between 50 and 200 lots", () => {
  const result = pickTrafficLight(healthy({ lots: 120 }));
  assertEquals(result.light, "🟠");
  assertEquals(result.majorWarn, false);
  assertEquals(result.minorWarn, true);
  assertEquals(emojis(result), ["🥃", "💰"]);
});

Deno.test("pickTrafficLight is amber on a big 5-day drop", () => {
  const result = pickTrafficLight(healthy({ fiveDayReturn: -0.2 }));
  assertEquals(result.light, "🟠");
  assertEquals(result.minorWarn, true);
  assertEquals(emojis(result), ["🪃", "💰"]);
});

Deno.test("pickTrafficLight is amber at the 52-week high without a strong EY", () => {
  const result = pickTrafficLight(
    healthy({ position: 0.9, earningsYield: 0.04 }),
  );
  assertEquals(result.light, "🟠");
  assertEquals(result.minorWarn, true);
  assertEquals(emojis(result), ["📈"]);
});

Deno.test("pickTrafficLight is amber at the 52-week low without a strong EY", () => {
  const result = pickTrafficLight(
    healthy({ position: 0.05, earningsYield: 0.04 }),
  );
  assertEquals(result.light, "🟠");
  assertEquals(result.minorWarn, true);
  assertEquals(emojis(result), ["📉"]);
});

Deno.test("a strong earnings yield excuses being at the 52-week high or low", () => {
  const high = pickTrafficLight(healthy({ position: 0.99 }));
  assertEquals(high.light, "🟢");
  assertEquals(high.minorWarn, false);
  // The position is still reported, it just does not trip the light.
  assertEquals(emojis(high), ["📈", "💰"]);

  const low = pickTrafficLight(healthy({ position: 0.01 }));
  assertEquals(low.light, "🟢");
  assertEquals(low.minorWarn, false);
  assertEquals(emojis(low), ["📉", "💰"]);
});

// --- pickTrafficLight: exact boundaries ------------------------------------

Deno.test("lots boundary: 50 is amber (inclusive), just under 50 is red", () => {
  assertEquals(pickTrafficLight(healthy({ lots: MIN_RED_LOTS })).light, "🟠");
  assertEquals(
    pickTrafficLight(healthy({ lots: MIN_RED_LOTS - 0.01 })).light,
    "🔴",
  );
});

Deno.test("lots boundary: 200 is green (exclusive upper bound on amber)", () => {
  assertEquals(pickTrafficLight(healthy({ lots: MIN_AMBER_LOTS })).light, "🟢");
  assertEquals(
    pickTrafficLight(healthy({ lots: MIN_AMBER_LOTS - 0.01 })).light,
    "🟠",
  );
});

Deno.test("position boundary: exactly 0.85 counts as at-high (inclusive)", () => {
  const at = pickTrafficLight(
    healthy({ position: HIGH_CUT, earningsYield: 0.04 }),
  );
  assertEquals(at.light, "🟠");
  assertEquals(emojis(at), ["📈"]);

  const below = pickTrafficLight(
    healthy({ position: HIGH_CUT - 0.01, earningsYield: 0.04 }),
  );
  assertEquals(below.light, "🟢");
  assertEquals(emojis(below), []);
});

Deno.test("position boundary: exactly 0.15 counts as at-low (inclusive)", () => {
  const at = pickTrafficLight(
    healthy({ position: LOW_CUT, earningsYield: 0.04 }),
  );
  assertEquals(at.light, "🟠");
  assertEquals(emojis(at), ["📉"]);

  const above = pickTrafficLight(
    healthy({ position: LOW_CUT + 0.01, earningsYield: 0.04 }),
  );
  assertEquals(above.light, "🟢");
  assertEquals(emojis(above), []);
});

Deno.test("5-day return boundary: exactly -0.10 is a big drop (inclusive)", () => {
  const at = pickTrafficLight(healthy({ fiveDayReturn: DROP_CUT }));
  assertEquals(at.light, "🟠");
  assertEquals(emojis(at), ["🪃", "💰"]);

  const above = pickTrafficLight(healthy({ fiveDayReturn: DROP_CUT + 0.01 }));
  assertEquals(above.light, "🟢");
  assertEquals(emojis(above), ["💰"]);
});

Deno.test("EY boundary: exactly 0.02 is no longer weak (exclusive)", () => {
  const at = pickTrafficLight(healthy({ earningsYield: EY_WEAK_CUT }));
  assertEquals(at.light, "🟢");
  assertEquals(at.majorWarn, false);
  assertEquals(emojis(at), []);

  const below = pickTrafficLight(
    healthy({ earningsYield: EY_WEAK_CUT - 0.001 }),
  );
  assertEquals(below.light, "🔴");
  assertEquals(emojis(below), ["🩸"]);
});

Deno.test("EY boundary: exactly 0.06 is strong (inclusive)", () => {
  const at = pickTrafficLight(
    healthy({ position: 0.99, earningsYield: EY_STRONG_CUT }),
  );
  assertEquals(at.light, "🟢");
  assertEquals(emojis(at), ["📈", "💰"]);

  const below = pickTrafficLight(
    healthy({ position: 0.99, earningsYield: EY_STRONG_CUT - 0.001 }),
  );
  assertEquals(below.light, "🟠");
  assertEquals(emojis(below), ["📈"]);
});

Deno.test("EY of exactly 0 is 🩸, not 🔥", () => {
  const result = pickTrafficLight(healthy({ earningsYield: 0 }));
  assertEquals(result.light, "🔴");
  assertEquals(emojis(result), ["🩸"]);
});

// --- pickTrafficLight: unknown inputs never fabricate a warning ------------

Deno.test("pickTrafficLight with every input unknown is green with no warnings", () => {
  const result = pickTrafficLight({});
  assertEquals(result.light, "🟢");
  assertEquals(result.majorWarn, false);
  assertEquals(result.minorWarn, false);
  assertEquals(result.warnings, []);
});

Deno.test("an unknown value never turns the light red", () => {
  for (
    const blank of [
      null,
      undefined,
      "",
      "not-a-number",
      Number.NaN,
    ] as unknown[]
  ) {
    const result = pickTrafficLight({
      price: blank,
      lots: blank,
      position: blank,
      fiveDayReturn: blank,
      earningsYield: blank,
    });
    assertEquals(result.light, "🟢", `blank ${String(blank)} must stay green`);
    assertEquals(result.majorWarn, false);
    assertEquals(result.minorWarn, false);
    assertEquals(result.warnings, []);
  }
});

Deno.test("an unknown earnings yield is neither weak nor strong", () => {
  // Missing EY must not fabricate 🩸/🔥 (red) nor excuse being at the high.
  const result = pickTrafficLight(healthy({ earningsYield: null }));
  assertEquals(result.light, "🟢");
  assertEquals(emojis(result), []);

  const atHigh = pickTrafficLight(
    healthy({ position: 0.99, earningsYield: null }),
  );
  assertEquals(atHigh.light, "🟠");
  assertEquals(emojis(atHigh), ["📈"]);
});

Deno.test("pickTrafficLight tolerates a missing metrics object", () => {
  assertEquals(
    pickTrafficLight(undefined as unknown as Record<string, never>).light,
    "🟢",
  );
  assertEquals(
    pickTrafficLight(null as unknown as Record<string, never>).warnings,
    [],
  );
});

Deno.test("pickTrafficLight derives lots from adv when lots is not supplied", () => {
  // ADV of $600k is 30 parcels a day — poor liquidity, red.
  const result = pickTrafficLight({ adv: 600_000, earningsYield: 0.08 });
  assertEquals(result.light, "🔴");
  assertEquals(emojis(result), ["🫗", "💰"]);

  // An explicit lots value wins over adv.
  const explicit = pickTrafficLight({
    adv: 600_000,
    lots: 500,
    earningsYield: 0.08,
  });
  assertEquals(explicit.light, "🟢");
  assertEquals(emojis(explicit), ["💰"]);
});

Deno.test("warnings carry a human-readable label alongside the emoji", () => {
  const result = pickTrafficLight(healthy({ price: 0.5 }));
  const delist = result.warnings[0];
  assertEquals(delist.emoji, "🚫");
  assert(
    typeof delist.label === "string" && delist.label.length > 0,
    "every warning needs a label for the accessible text",
  );
});

// --- compact formatters ----------------------------------------------------

Deno.test("formatCompactMoney formats whole dollars below $1k", () => {
  assertEquals(formatCompactMoney(0), "$0");
  assertEquals(formatCompactMoney(12.4), "$12");
  assertEquals(formatCompactMoney(999), "$999");
});

Deno.test("formatCompactMoney switches suffix at each k/M/B/T boundary", () => {
  assertEquals(formatCompactMoney(1_000), "$1.00k");
  assertEquals(formatCompactMoney(4_560), "$4.56k");
  assertEquals(formatCompactMoney(999_999), "$1000.00k");
  assertEquals(formatCompactMoney(1_000_000), "$1.00M");
  assertEquals(formatCompactMoney(1_230_000), "$1.23M");
  assertEquals(formatCompactMoney(1_000_000_000), "$1.00B");
  assertEquals(formatCompactMoney(2_500_000_000), "$2.50B");
  assertEquals(formatCompactMoney(1_000_000_000_000), "$1.00T");
  assertEquals(formatCompactMoney(3_400_000_000_000), "$3.40T");
});

Deno.test("formatCompactMoney puts the sign before the dollar symbol", () => {
  assertEquals(formatCompactMoney(-1_230_000), "-$1.23M");
  assertEquals(formatCompactMoney(-500), "-$500");
});

Deno.test("formatCompactMoney returns an empty string for a non-number", () => {
  assertEquals(formatCompactMoney(null), "");
  assertEquals(formatCompactMoney(undefined), "");
  assertEquals(formatCompactMoney(""), "");
  assertEquals(formatCompactMoney("1500"), "");
  assertEquals(formatCompactMoney(Number.NaN), "");
  assertEquals(formatCompactMoney(Number.POSITIVE_INFINITY), "");
});

Deno.test("formatCompactCount is the money format without the dollar sign", () => {
  assertEquals(formatCompactCount(0), "0");
  assertEquals(formatCompactCount(999), "999");
  assertEquals(formatCompactCount(1_000), "1.00k");
  assertEquals(formatCompactCount(1_230_000), "1.23M");
  assertEquals(formatCompactCount(1_000_000_000), "1.00B");
  assertEquals(formatCompactCount(1_000_000_000_000), "1.00T");
  assertEquals(formatCompactCount(-2_500), "-2.50k");
  assertEquals(formatCompactCount(Number.NaN), "");
  assertEquals(formatCompactCount("50"), "");
});

Deno.test("the compact formatters round to two decimals", () => {
  assertEquals(formatCompactMoney(1_234_567), "$1.23M");
  assertEquals(formatCompactMoney(1_235_000), "$1.24M");
  assertEquals(formatCompactCount(1_499), "1.50k");
});
