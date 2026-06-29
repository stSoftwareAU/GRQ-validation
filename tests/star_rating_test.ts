// Load the shared projection helpers so the minimum-star filter predicate
// (issue #655) is exercised against the REAL shipped kernel rather than a copy.
import "../docs/projection.js";

const starFilterG = globalThis as unknown as {
  GRQProjection: {
    meetsStarThreshold: (
      avgStars: number | null | undefined,
      minStars: number,
    ) => boolean;
  };
};

// Star rating display function (copied from app.js)
function getStarRatingDisplay(avgStars: number | null | undefined): string {
  if (avgStars === null || avgStars === undefined) {
    return "";
  }

  // Round to nearest quarter using your logic
  const hundredStars = Math.min(Math.round(avgStars * 20), 100);
  const fullStars = Math.floor(hundredStars / 20);
  const remainderStars = hundredStars - fullStars * 20;
  const partialStars = Math.round(
    Math.min(Math.max(0, remainderStars), 20) / 5,
  );

  let display = "";

  // Add full moons for integer values
  for (let i = 0; i < fullStars; i++) {
    display += "🌕";
  }

  // Add partial moon for fractional part
  if (remainderStars > 0) {
    switch (partialStars) {
      case 0:
        display += "🌑"; // new moon (0-0.25)
        break;
      case 1:
        display += "🌒"; // quarter moon (0.25-0.5)
        break;
      case 2:
        display += "🌓"; // half moon (0.5-0.75)
        break;
      case 3:
        display += "🌔"; // three-quarter moon (0.75-1.0)
        break;
      case 4:
        // This should round up to next full star
        // Add one more full star
        display += "🌕";
        break;
    }
  }

  return display;
}

Deno.test("Star Rating Display - Basic Cases", () => {
  const testCases = [
    { input: 1.0, expected: "🌕", description: "1.0 stars" },
    { input: 2.0, expected: "🌕🌕", description: "2.0 stars" },
    { input: 3.0, expected: "🌕🌕🌕", description: "3.0 stars" },
    { input: 4.0, expected: "🌕🌕🌕🌕", description: "4.0 stars" },
    { input: 5.0, expected: "🌕🌕🌕🌕🌕", description: "5.0 stars" },
  ];

  testCases.forEach((testCase) => {
    const result = getStarRatingDisplay(testCase.input);
    assertEquals(result, testCase.expected, testCase.description);
  });
});

Deno.test("Star Rating Display - Quarter Star Cases", () => {
  const testCases = [
    {
      input: 1.25,
      expected: "🌕🌒",
      description: "1.25 stars (1 full + 1 quarter moon)",
    },
    {
      input: 1.5,
      expected: "🌕🌓",
      description: "1.5 stars (1 full + 1 half moon)",
    },
    {
      input: 1.75,
      expected: "🌕🌔",
      description: "1.75 stars (1 full + 3 quarters moon)",
    },
    {
      input: 2.25,
      expected: "🌕🌕🌒",
      description: "2.25 stars (2 full + 1 quarter moon)",
    },
    {
      input: 2.5,
      expected: "🌕🌕🌓",
      description: "2.5 stars (2 full + 1 half moon)",
    },
    {
      input: 2.75,
      expected: "🌕🌕🌔",
      description: "2.75 stars (2 full + 3 quarters moon)",
    },
    {
      input: 3.25,
      expected: "🌕🌕🌕🌒",
      description: "3.25 stars (3 full + 1 quarter moon)",
    },
    {
      input: 3.5,
      expected: "🌕🌕🌕🌓",
      description: "3.5 stars (3 full + 1 half moon)",
    },
    {
      input: 3.75,
      expected: "🌕🌕🌕🌔",
      description: "3.75 stars (3 full + 3 quarters moon)",
    },
    {
      input: 4.25,
      expected: "🌕🌕🌕🌕🌒",
      description: "4.25 stars (4 full + 1 quarter moon)",
    },
    {
      input: 4.5,
      expected: "🌕🌕🌕🌕🌓",
      description: "4.5 stars (4 full + 1 half moon)",
    },
    {
      input: 4.75,
      expected: "🌕🌕🌕🌕🌔",
      description: "4.75 stars (4 full + 3 quarters moon)",
    },
  ];

  testCases.forEach((testCase) => {
    const result = getStarRatingDisplay(testCase.input);
    assertEquals(result, testCase.expected, testCase.description);
  });
});

Deno.test("Star Rating Display - Rounding Cases", () => {
  const testCases = [
    {
      input: 1.12,
      expected: "🌕🌑",
      description: "1.12 = 22/20 = 1 full + 2 remainder = 0 partial = new moon",
    },
    {
      input: 1.37,
      expected: "🌕🌒",
      description:
        "1.37 = 27/20 = 1 full + 7 remainder = 1 partial = quarter moon",
    },
    {
      input: 1.62,
      expected: "🌕🌓",
      description:
        "1.62 = 32/20 = 1 full + 12 remainder = 2 partial = half moon",
    },
    {
      input: 1.87,
      expected: "🌕🌔",
      description: "1.87 rounds to 1.75 (three-quarter moon)",
    },
    {
      input: 2.12,
      expected: "🌕🌕🌑",
      description: "2.12 = 42/20 = 2 full + 2 remainder = 0 partial = new moon",
    },
    {
      input: 2.37,
      expected: "🌕🌕🌒",
      description:
        "2.37 = 47/20 = 2 full + 7 remainder = 1 partial = quarter moon",
    },
    {
      input: 2.62,
      expected: "🌕🌕🌓",
      description: "2.62 rounds to 2.5 (half moon)",
    },
    {
      input: 2.87,
      expected: "🌕🌕🌔",
      description: "2.87 rounds to 2.75 (three-quarter moon)",
    },
    {
      input: 3.24,
      expected: "🌕🌕🌕🌒",
      description: "3.24 rounds to 3.25 (quarter moon)",
    },
    {
      input: 3.49,
      expected: "🌕🌕🌕🌓",
      description: "3.49 rounds to 3.5 (half moon)",
    },
    {
      input: 3.51,
      expected: "🌕🌕🌕🌓",
      description: "3.51 rounds to 3.5 (half moon)",
    },
    {
      input: 3.74,
      expected: "🌕🌕🌕🌔",
      description: "3.74 rounds to 3.75 (three-quarter moon)",
    },
    {
      input: 3.76,
      expected: "🌕🌕🌕🌔",
      description: "3.76 rounds to 3.75 (three-quarter moon)",
    },
    { input: 3.99, expected: "🌕🌕🌕🌕", description: "3.99 rounds up to 4.0" },
    {
      input: 4.49,
      expected: "🌕🌕🌕🌕🌓",
      description: "4.49 rounds to 4.5 (half moon)",
    },
    {
      input: 4.95,
      expected: "🌕🌕🌕🌕🌕",
      description: "4.95 rounds up to 5.0",
    },
    { input: 0.99, expected: "🌕", description: "0.99 rounds up to 1.0" },
    {
      input: 0.12,
      expected: "🌑",
      description: "0.12 = 2/20 = 0 full + 2 remainder = 0 partial = new moon",
    },
    {
      input: 0.37,
      expected: "🌒",
      description: "0.37 rounds to 0.25 (quarter moon)",
    },
    {
      input: 0.62,
      expected: "🌓",
      description: "0.62 rounds to 0.5 (half moon)",
    },
    {
      input: 0.87,
      expected: "🌔",
      description: "0.87 rounds to 0.75 (three-quarter moon)",
    },
    // New test cases based on user examples
    {
      input: 3.1,
      expected: "🌕🌕🌕🌑",
      description: "3.1 = 62/20 = 3 full + 2 remainder = 0 partial = new moon",
    },
    {
      input: 3.005,
      expected: "🌕🌕🌕",
      description: "3.005 = 60/20 = 3 full + 0 remainder = no partial",
    },
    {
      input: 3.24,
      expected: "🌕🌕🌕🌒",
      description:
        "3.24 = 65/20 = 3 full + 5 remainder = 1 partial = quarter moon",
    },
    {
      input: 3.55,
      expected: "🌕🌕🌕🌓",
      description:
        "3.55 = 71/20 = 3 full + 11 remainder = 2 partial = half moon",
    },
    {
      input: 3.70,
      expected: "🌕🌕🌕🌔",
      description:
        "3.70 = 74/20 = 3 full + 14 remainder = 3 partial = three-quarter moon",
    },
    {
      input: 3.95,
      expected: "🌕🌕🌕🌕",
      description:
        "3.95 = 79/20 = 3 full + 19 remainder = 4 partial = rounds to 4 full",
    },
  ];

  testCases.forEach((testCase) => {
    const result = getStarRatingDisplay(testCase.input);
    assertEquals(result, testCase.expected, testCase.description);
  });
});

Deno.test("Star Rating Display - Edge Cases", () => {
  assertEquals(getStarRatingDisplay(null), "", "null input");
  assertEquals(getStarRatingDisplay(undefined), "", "undefined input");
  assertEquals(getStarRatingDisplay(0), "", "zero stars");
  assertEquals(
    getStarRatingDisplay(0.1),
    "🌑",
    "0.1 = 2/20 = 0 full + 2 remainder = 0 partial = new moon",
  );
  assertEquals(
    getStarRatingDisplay(5.1),
    "🌕🌕🌕🌕🌕",
    "5.1 = 102/20 = capped at 100 = 5 full + 0 remainder = no partial",
  );
});

Deno.test("Star Rating Display - Moon Phase Mapping", () => {
  // Test the moon phase mapping specifically
  const phaseTests = [
    { input: 0.25, expected: "🌒", description: "0.25 = quarter moon" },
    { input: 0.5, expected: "🌓", description: "0.5 = half moon" },
    { input: 0.75, expected: "🌔", description: "0.75 = three-quarter moon" },
    { input: 1.0, expected: "🌕", description: "1.0 = full moon" },
    {
      input: 1.25,
      expected: "🌕🌒",
      description: "1.25 = full + quarter moon",
    },
    {
      input: 1.5,
      expected: "🌕🌓",
      description: "1.5 = full + half moon",
    },
    {
      input: 1.75,
      expected: "🌕🌔",
      description: "1.75 = full + three-quarter moon",
    },
  ];

  phaseTests.forEach((testCase) => {
    const result = getStarRatingDisplay(testCase.input);
    assertEquals(result, testCase.expected, testCase.description);
  });
});

Deno.test("Star Rating Calculation Details", () => {
  // Mock analysis data
  const mockAnalysisData = {
    "NYSE:BAC": {
      msStars: 3,
      tipsStars: 7,
      avgStars: 3.1,
      date: "2025-08-01",
    },
    "NYSE:JPM": {
      msStars: 4,
      tipsStars: null,
      avgStars: 4.0,
      date: "2025-08-01",
    },
    "NYSE:AAPL": {
      msStars: null,
      tipsStars: 8,
      avgStars: 4.0,
      date: "2025-08-01",
    },
  };

  // Mock the getStarRatingCalculation method.
  // Returns only the observable contract: the upstream inputs and the
  // rendered moon-string. Internal decomposition state (hundredStars,
  // fullStars, remainderStars, partialStars, moonPhase) is deliberately
  // not exposed — those are HOW-details of the rounding maths and a
  // behaviour-preserving refactor should not break this test (issue #98).
  function getStarRatingCalculation(stockSymbol: string) {
    if (!(stockSymbol in mockAnalysisData)) {
      return null;
    }

    const analysis =
      mockAnalysisData[stockSymbol as keyof typeof mockAnalysisData];
    if (analysis.avgStars === null) {
      return null;
    }

    return {
      msStars: analysis.msStars,
      tipsStars: analysis.tipsStars,
      avgStars: analysis.avgStars,
      display: getStarRatingDisplay(analysis.avgStars),
    };
  }

  // Test BAC: 3 MS + 7 Tips = 3.1 average → three full moons + new-moon partial
  const bacCalculation = getStarRatingCalculation("NYSE:BAC");
  assertEquals(bacCalculation?.msStars, 3, "BAC MS stars should be 3");
  assertEquals(bacCalculation?.tipsStars, 7, "BAC Tips stars should be 7");
  assertEquals(bacCalculation?.avgStars, 3.1, "BAC average should be 3.1");
  assertEquals(
    bacCalculation?.display,
    "🌕🌕🌕🌑",
    "BAC should render three full moons and a new moon",
  );

  // Test JPM: 4 MS + null Tips = 4.0 average → four full moons
  const jpmCalculation = getStarRatingCalculation("NYSE:JPM");
  assertEquals(jpmCalculation?.msStars, 4, "JPM MS stars should be 4");
  assertEquals(
    jpmCalculation?.tipsStars,
    null,
    "JPM Tips stars should be null",
  );
  assertEquals(jpmCalculation?.avgStars, 4.0, "JPM average should be 4.0");
  assertEquals(
    jpmCalculation?.display,
    "🌕🌕🌕🌕",
    "JPM should render four full moons",
  );

  // Test AAPL: null MS + 8 Tips = 4.0 average → four full moons
  const aaplCalculation = getStarRatingCalculation("NYSE:AAPL");
  assertEquals(aaplCalculation?.msStars, null, "AAPL MS stars should be null");
  assertEquals(aaplCalculation?.tipsStars, 8, "AAPL Tips stars should be 8");
  assertEquals(aaplCalculation?.avgStars, 4.0, "AAPL average should be 4.0");
  assertEquals(
    aaplCalculation?.display,
    "🌕🌕🌕🌕",
    "AAPL should render four full moons",
  );

  // Test non-existent stock
  const nonExistentCalculation = getStarRatingCalculation("NYSE:INVALID");
  assertEquals(
    nonExistentCalculation,
    null,
    "Non-existent stock should return null",
  );
});

// --- Issue #548: freshness emoji beside the star rating in the table cell ---
//
// The aggregate-score table "Stars" cell renders the fair-value freshness
// indicator (issue #547) before the moon glyphs, e.g. "🌺 🌕🌕🌕🌑" (order
// flipped to freshness-then-stars for issue #623). When the stars are N/A both
// helpers return '' so the cell must be empty — no stray space and no lone
// emoji. A negative-age row shows '⚠️' beside the stars.

// Freshness indicator, mirrored from app.js getFreshnessIndicator (issue #547).
const FRESHNESS_SCALE: ReadonlyArray<readonly [number, string]> = [
  [0, "🌹"],
  [2, "🌺"],
  [4, "🥀"],
  [7, "🍁"],
  [10, "🍂"],
  [14, "🕸"],
];

function getFreshnessIndicator(
  avgStars: number | null,
  signedDaysFromScore: number,
): string {
  if (avgStars === null) {
    return "";
  }
  if (signedDaysFromScore < 0) {
    return "⚠️";
  }
  let emoji = FRESHNESS_SCALE[0][1];
  for (const [threshold, candidate] of FRESHNESS_SCALE) {
    if (signedDaysFromScore >= threshold) {
      emoji = candidate;
    } else {
      break;
    }
  }
  return emoji;
}

// Build the "Stars" table cell exactly as app.js does: the freshness emoji
// first, then the star glyphs separated by a single space, with no marker when
// there is no freshness emoji to show (issue #623 — freshness then stars).
function renderStarsCell(
  avgStars: number | null,
  signedDaysFromScore: number,
): string {
  const stars = getStarRatingDisplay(avgStars);
  const freshness = getFreshnessIndicator(avgStars, signedDaysFromScore);
  return `${freshness ? `${freshness} ` : ""}${stars}`;
}

Deno.test("Table Stars cell - freshness emoji renders beside the rating", () => {
  assertEquals(
    renderStarsCell(3.1, 3),
    "🌺 🌕🌕🌕🌑",
    "fresh row shows the freshness emoji then the moon glyphs",
  );
  assertEquals(
    renderStarsCell(4.0, 0),
    "🌹 🌕🌕🌕🌕",
    "same-day analysis shows 🌹 before four full moons",
  );
});

Deno.test("Table Stars cell - N/A stars produce no emoji and no stray space", () => {
  assertEquals(
    renderStarsCell(null, 5),
    "",
    "no analysis stars → empty cell, no lone freshness emoji",
  );
  assertEquals(
    renderStarsCell(null, -3),
    "",
    "null stars win even when the age is negative",
  );
});

Deno.test("Table Stars cell - negative age shows ⚠️ beside the rating", () => {
  assertEquals(
    renderStarsCell(4.0, -1),
    "⚠️ 🌕🌕🌕🌕",
    "analysis dated after the score date surfaces ⚠️ before the stars",
  );
});

// Issue #633: the former "app.js: table Stars cell wires freshness" test
// regex-matched docs/app.js SOURCE TEXT for the exact `<td>` template-literal
// spelling (`getFreshnessIndicator(stock.stock) ? … ${this.getStarRatingDisplay
// (stock.stock)}`). That pinned the byte-sequence of a template literal, not the
// rendered cell, so a behaviour-preserving reformat would fail it while a broken
// cell could pass. The freshness-then-stars rendering is covered behaviourally by
// the renderStarsCell tests above, which mirror the cell and assert the actual
// output string. The grep tail has therefore been removed.

// --- Minimum-star filter predicate (issue #655) ----------------------------
//
// meetsStarThreshold is the single source of truth for the optional portfolio
// star filter: given a stock's combined avgStars and the active whole-star
// threshold (0 = All/off, 1..5 = floor), decide whether the stock is included.

Deno.test("meetsStarThreshold - filter off (0) includes every stock", () => {
  const { meetsStarThreshold } = starFilterG.GRQProjection;
  // With the filter off the view is unchanged: even unrated stocks pass.
  assertEquals(meetsStarThreshold(5, 0), true, "5★ passes when off");
  assertEquals(meetsStarThreshold(1, 0), true, "1★ passes when off");
  assertEquals(meetsStarThreshold(null, 0), true, "no rating passes when off");
  assertEquals(
    meetsStarThreshold(undefined, 0),
    true,
    "undefined rating passes when off",
  );
});

Deno.test("meetsStarThreshold - rating at or above threshold is included", () => {
  const { meetsStarThreshold } = starFilterG.GRQProjection;
  assertEquals(meetsStarThreshold(3, 3), true, "exactly at threshold");
  assertEquals(meetsStarThreshold(3.5, 3), true, "above threshold");
  assertEquals(meetsStarThreshold(5, 1), true, "1★+ includes a top rating");
  assertEquals(meetsStarThreshold(1, 1), true, "1★+ includes any rating");
});

Deno.test("meetsStarThreshold - rating below threshold is excluded", () => {
  const { meetsStarThreshold } = starFilterG.GRQProjection;
  assertEquals(meetsStarThreshold(2.9, 3), false, "just below threshold");
  assertEquals(meetsStarThreshold(1, 4), false, "well below threshold");
});

Deno.test("meetsStarThreshold - no rating is excluded while the filter is active", () => {
  const { meetsStarThreshold } = starFilterG.GRQProjection;
  // "1★+ includes every stock that has any rating; stocks with no rating are
  // excluded while the filter is on" (issue #655).
  assertEquals(meetsStarThreshold(null, 1), false, "null avgStars excluded");
  assertEquals(
    meetsStarThreshold(undefined, 1),
    false,
    "undefined avgStars excluded",
  );
  assertEquals(meetsStarThreshold(NaN, 2), false, "NaN avgStars excluded");
});

// Helper function for assertions (Deno doesn't have assertEquals by default)
function assertEquals(actual: unknown, expected: unknown, message?: string) {
  if (actual !== expected) {
    throw new Error(
      `Assertion failed: ${message || "Values are not equal"}\n` +
        `Expected: ${JSON.stringify(expected)}\n` +
        `Actual: ${JSON.stringify(actual)}`,
    );
  }
}
