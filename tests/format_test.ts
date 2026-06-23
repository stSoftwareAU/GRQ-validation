// Tests for the shared dashboard number-formatting helpers (issue #276,
// part of #269 item B).
//
// Dashboard figures — market index levels, stock prices, performance
// percentages — must render with thousands separators and consistent decimal
// places while preserving the sign and any percent symbol. These verify the
// real shipped module, which is published on `globalThis` by importing it,
// mirroring tests/escape_test.ts.
import { assertEquals } from "@std/assert";
import "../docs/format.js";

const g = globalThis as unknown as {
  GRQFormat: {
    toFiniteNumber: (value: unknown) => number | null;
    formatNumber: (value: unknown, decimals?: number) => string;
    formatIndexLevel: (value: unknown, decimals?: number) => string;
    formatPercent: (value: unknown, decimals?: number) => string;
  };
};

const { toFiniteNumber, formatNumber, formatIndexLevel, formatPercent } =
  g.GRQFormat;

const formatTooltipValue = (g.GRQFormat as unknown as {
  formatTooltipValue: (label: unknown, value: unknown) => string;
}).formatTooltipValue;

Deno.test("format.js publishes helpers on globalThis.GRQFormat", () => {
  assertEquals(typeof toFiniteNumber, "function");
  assertEquals(typeof formatNumber, "function");
  assertEquals(typeof formatIndexLevel, "function");
  assertEquals(typeof formatPercent, "function");
});

Deno.test("formatNumber adds thousands separators (4742.83 → 4,742.83)", () => {
  assertEquals(formatNumber(4742.83), "4,742.83");
  assertEquals(formatNumber(1234567.5), "1,234,567.50");
});

Deno.test("formatNumber pads to consistent decimal places", () => {
  assertEquals(formatNumber(5), "5.00");
  assertEquals(formatNumber(1000), "1,000.00");
});

Deno.test("formatNumber honours a custom decimals argument", () => {
  assertEquals(formatNumber(16432, 0), "16,432");
  assertEquals(formatNumber(4742.83, 1), "4,742.8");
  assertEquals(formatNumber(1.5, 3), "1.500");
});

Deno.test("formatNumber preserves the sign of negative values", () => {
  assertEquals(formatNumber(-4742.83), "-4,742.83");
  assertEquals(formatNumber(-12), "-12.00");
});

Deno.test("formatNumber accepts numeric strings", () => {
  assertEquals(formatNumber("4742.83"), "4,742.83");
});

Deno.test("formatNumber returns N/A for non-finite input", () => {
  assertEquals(formatNumber(null), "N/A");
  assertEquals(formatNumber(undefined), "N/A");
  assertEquals(formatNumber(NaN), "N/A");
  assertEquals(formatNumber(Infinity), "N/A");
  assertEquals(formatNumber("abc"), "N/A");
  assertEquals(formatNumber(""), "N/A");
});

Deno.test("formatIndexLevel formats an index level with no decimals by default (issue #313)", () => {
  // Index levels (e.g. SP500) read as whole numbers with thousands separators:
  // 7500.42 → "7,500", not "7,500.42".
  assertEquals(formatIndexLevel(7500.42), "7,500");
  assertEquals(formatIndexLevel(4742.83), "4,743");
  assertEquals(formatIndexLevel(16057.44), "16,057");
  assertEquals(formatIndexLevel(null), "N/A");
});

Deno.test("formatIndexLevel still honours an explicit decimals argument", () => {
  assertEquals(formatIndexLevel(4742.83, 2), "4,742.83");
  assertEquals(formatIndexLevel(4742.83, 1), "4,742.8");
});

Deno.test("formatPercent adds an explicit + sign and trailing %", () => {
  assertEquals(formatPercent(12.5), "+12.50%");
  assertEquals(formatPercent(12.5, 1), "+12.5%");
  assertEquals(formatPercent(0), "+0.00%");
});

Deno.test("formatPercent keeps the minus sign on negatives", () => {
  assertEquals(formatPercent(-3.27), "-3.27%");
  assertEquals(formatPercent(-3.27, 1), "-3.3%");
});

Deno.test("formatPercent groups large percentages and rejects invalid input", () => {
  assertEquals(formatPercent(1234.5, 2), "+1,234.50%");
  assertEquals(formatPercent(null), "N/A");
  assertEquals(formatPercent(NaN), "N/A");
});

Deno.test("toFiniteNumber coerces numbers and numeric strings, else null", () => {
  assertEquals(toFiniteNumber(42), 42);
  assertEquals(toFiniteNumber("42.5"), 42.5);
  assertEquals(toFiniteNumber(null), null);
  assertEquals(toFiniteNumber("abc"), null);
  assertEquals(toFiniteNumber(Infinity), null);
});

// formatTooltipValue — chart tooltip unit selection (issue #425).
//
// The blue series was renamed from "Performance" to "Actual" (#425). "Actual"
// and "Target" are percentages; only genuine price series render as dollars.
// These verify the renamed series still formats as a percentage (no regression
// from the old "Performance" path) and that the Price guard now excludes
// "Actual".
Deno.test("formatTooltipValue renders the renamed Actual series as a percentage", () => {
  assertEquals(formatTooltipValue("Actual", 12.34), "Actual: 12.3%");
  assertEquals(
    formatTooltipValue("Actual (After 90 Days)", -3.27),
    "Actual (After 90 Days): -3.3%",
  );
});

Deno.test("formatTooltipValue renders the Target series as a percentage", () => {
  assertEquals(formatTooltipValue("Target", 25), "Target: 25.0%");
});

Deno.test("formatTooltipValue renders a genuine price series as dollars", () => {
  assertEquals(formatTooltipValue("Buy Price", 12.5), "Buy Price: $12.50");
});

Deno.test("formatTooltipValue price guard excludes the Actual series", () => {
  // A label carrying both "Actual" and "Price" stays a percentage — the renamed
  // blue series is never misread as a dollar value (old guard excluded
  // "Performance"; the new guard excludes "Actual").
  assertEquals(
    formatTooltipValue("Actual Price", 8),
    "Actual Price: 8.0%",
  );
});

Deno.test("formatTooltipValue treats other series as percentages", () => {
  assertEquals(
    formatTooltipValue("Projection (Trend Line)", 4.5),
    "Projection (Trend Line): 4.5%",
  );
});

Deno.test("formatTooltipValue is defensive against non-finite values", () => {
  assertEquals(formatTooltipValue("Actual", NaN), "Actual: ");
  assertEquals(formatTooltipValue("Actual", undefined), "Actual: ");
});
