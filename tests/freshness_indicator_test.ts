// Fair-value freshness indicator helper (copied from app.js) — issue #547.
//
// Mirrors the Google-Sheet VLOOKUP-style approximate-match scale that turns a
// signed, whole-day analysis age into a freshness emoji:
//
//   age (whole days) | emoji
//   0–1              | 🌹
//   2–3              | 🌺
//   4–6              | 🥀
//   7–9              | 🍁
//   10–13            | 🍂
//   14+              | 🕸
//
// Special cases:
//   - no analysis row / avgStars === null → '' (no emoji)
//   - signed age negative (analysis dated after the score date) → '⚠️'

// Ascending [threshold, emoji] pairs — pick the largest threshold ≤ age.
const FRESHNESS_SCALE: ReadonlyArray<readonly [number, string]> = [
  [0, "🌹"],
  [2, "🌺"],
  [4, "🥀"],
  [7, "🍁"],
  [10, "🍂"],
  [14, "🕸"],
];

interface AnalysisRow {
  avgStars: number | null;
  signedDaysFromScore: number;
}

function getFreshnessIndicator(
  analysisData: Record<string, AnalysisRow>,
  stockSymbol: string,
): string {
  const analysis = analysisData?.[stockSymbol];

  // No analysis row, or stars show N/A → no emoji.
  if (!analysis || analysis.avgStars === null) {
    return "";
  }

  // Analysis dated after the score date — an invariant the pipeline must
  // never violate. Surface the bug instead of a freshness emoji.
  if (analysis.signedDaysFromScore < 0) {
    return "⚠️";
  }

  // VLOOKUP-style approximate match: largest threshold ≤ age.
  let emoji = FRESHNESS_SCALE[0][1];
  for (const [threshold, candidate] of FRESHNESS_SCALE) {
    if (analysis.signedDaysFromScore >= threshold) {
      emoji = candidate;
    } else {
      break;
    }
  }
  return emoji;
}

// Convenience wrapper so tests read like the data scenarios they describe.
function freshnessFor(
  avgStars: number | null,
  signedDaysFromScore: number,
): string {
  return getFreshnessIndicator(
    { "NYSE:TEST": { avgStars, signedDaysFromScore } },
    "NYSE:TEST",
  );
}

Deno.test("Freshness Indicator - bucket boundaries", () => {
  const cases: { age: number; expected: string }[] = [
    { age: 0, expected: "🌹" },
    { age: 1, expected: "🌹" },
    { age: 2, expected: "🌺" },
    { age: 3, expected: "🌺" },
    { age: 4, expected: "🥀" },
    { age: 6, expected: "🥀" },
    { age: 7, expected: "🍁" },
    { age: 9, expected: "🍁" },
    { age: 10, expected: "🍂" },
    { age: 13, expected: "🍂" },
    { age: 14, expected: "🕸" },
  ];

  for (const { age, expected } of cases) {
    assertEquals(
      freshnessFor(3.0, age),
      expected,
      `age ${age} → ${expected}`,
    );
  }
});

Deno.test("Freshness Indicator - large age stays in 🕸 bucket", () => {
  assertEquals(freshnessFor(3.0, 21), "🕸", "21 days → 🕸");
  assertEquals(freshnessFor(3.0, 30), "🕸", "30 days → 🕸");
});

Deno.test("Freshness Indicator - negative age surfaces ⚠️", () => {
  assertEquals(freshnessFor(3.0, -1), "⚠️", "analysis dated after score date");
  assertEquals(freshnessFor(3.0, -5), "⚠️", "well after score date");
});

Deno.test("Freshness Indicator - no analysis data returns ''", () => {
  assertEquals(
    getFreshnessIndicator({}, "NYSE:MISSING"),
    "",
    "missing stock → no emoji",
  );
});

Deno.test("Freshness Indicator - avgStars null returns ''", () => {
  assertEquals(freshnessFor(null, 0), "", "stars N/A → no emoji");
  assertEquals(
    freshnessFor(null, -3),
    "",
    "null stars wins over negative age",
  );
});

// Helper function for assertions (matches tests/star_rating_test.ts style).
function assertEquals(actual: unknown, expected: unknown, message?: string) {
  if (actual !== expected) {
    throw new Error(
      `Assertion failed: ${message || "Values are not equal"}\n` +
        `Expected: ${JSON.stringify(expected)}\n` +
        `Actual: ${JSON.stringify(actual)}`,
    );
  }
}
