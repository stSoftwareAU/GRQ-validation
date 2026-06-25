// Stars click-popover freshness section (issue #550).
//
// The Stars "show the working" popover now appends the exact analysis date and
// the whole-day age of that analysis RELATIVE TO THE VIEWED SCORE DATE — the
// inline emoji (issue #547) is the at-a-glance signal, this is the precise
// number. e.g. `Analysed: 20 Jun 2026` / `5 days before score date`.
//
// The age helpers live in docs/freshness_text.js, a PURE classic script
// published on globalThis (mirroring docs/field_label.js), so the browser
// dashboard (via app.js) and these Deno tests exercise the SAME code.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import "../docs/freshness_text.js";

const g = globalThis as unknown as {
  GRQFreshness: {
    formatAnalysisDate: (date: Date) => string;
    analysisAgeLine: (signedDaysFromScore: number) => string;
    freshnessSection: (date: Date, signedDaysFromScore: number) => string;
  };
};
const GRQFreshness = g.GRQFreshness;

// --- date formatting: `20 Jun 2026` (day / short-month / year) --------------

Deno.test("formatAnalysisDate - day, short month and year", () => {
  assertEquals(
    GRQFreshness.formatAnalysisDate(new Date(2026, 5, 20)),
    "20 Jun 2026",
  );
  assertEquals(
    GRQFreshness.formatAnalysisDate(new Date(2025, 0, 1)),
    "1 Jan 2025",
  );
  assertEquals(
    GRQFreshness.formatAnalysisDate(new Date(2024, 11, 31)),
    "31 Dec 2024",
  );
});

Deno.test("formatAnalysisDate - invalid/missing date returns ''", () => {
  assertEquals(GRQFreshness.formatAnalysisDate(new Date("nonsense")), "");
  assertEquals(
    GRQFreshness.formatAnalysisDate(undefined as unknown as Date),
    "",
  );
});

// --- the age line: singular / plural / same-day / negative ------------------

Deno.test("analysisAgeLine - plural days before score date", () => {
  assertEquals(
    GRQFreshness.analysisAgeLine(5),
    "5 days before score date",
  );
});

Deno.test("analysisAgeLine - singular day", () => {
  assertEquals(
    GRQFreshness.analysisAgeLine(1),
    "1 day before score date",
  );
});

Deno.test("analysisAgeLine - zero is the same-day case", () => {
  assertEquals(
    GRQFreshness.analysisAgeLine(0),
    "same day as score date",
  );
});

Deno.test("analysisAgeLine - negative age explains the ⚠️ pipeline error", () => {
  const line = GRQFreshness.analysisAgeLine(-1);
  assertStringIncludes(line, "⚠️");
  assertStringIncludes(line, "AFTER the score date");
  // Must NOT pretend it is an ordinary age line.
  assert(!line.includes("before score date"));
});

// --- the full appended section ----------------------------------------------

Deno.test("freshnessSection - date + plural age relative to score date", () => {
  const section = GRQFreshness.freshnessSection(new Date(2026, 5, 20), 5);
  assertStringIncludes(section, "20 Jun 2026");
  assertStringIncludes(section, "5 days before score date");
});

Deno.test("freshnessSection - same-day case", () => {
  const section = GRQFreshness.freshnessSection(new Date(2026, 5, 25), 0);
  assertStringIncludes(section, "25 Jun 2026");
  assertStringIncludes(section, "same day as score date");
});

Deno.test("freshnessSection - negative age shows the ⚠️ explanation", () => {
  const section = GRQFreshness.freshnessSection(new Date(2026, 5, 30), -3);
  assertStringIncludes(section, "30 Jun 2026");
  assertStringIncludes(section, "⚠️");
  assertStringIncludes(section, "AFTER the score date");
  assert(!section.includes("before score date"));
});
