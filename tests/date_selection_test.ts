// Behavioural tests for the date deep-link helpers (issue #436).
//
// These import the REAL shipped helpers from docs/date_selection.js — the same
// pure functions the dashboard uses to honour a `?date=<YYYY-MM-DD>` URL
// parameter and pre-select the matching score file. The module publishes its
// helpers on globalThis and touches no DOM, so it imports cleanly under Deno.
import { assert, assertEquals } from "@std/assert";
import "../docs/date_selection.js";

interface ScoreEntry {
  file: string;
  date: string;
}

const g = globalThis as unknown as {
  GRQDateSelection: {
    dateFromSearch: (search: unknown) => string | null;
    resolveDateSelection: (
      scores: unknown,
      requested: unknown,
    ) => string | null;
    dateForFile: (scores: unknown, file: unknown) => string | null;
    searchWithDate: (search: unknown, date: unknown) => string;
    linkWithDate: (base: unknown, date: unknown) => string;
  };
};
const GRQDateSelection = g.GRQDateSelection;

const SCORES: ScoreEntry[] = [
  { file: "2024/October/15.tsv", date: "2024-10-15" },
  { file: "2026/March/23.tsv", date: "2026-03-23" },
  { file: "2026/March/3.tsv", date: "2026-03-03" },
];

Deno.test("GRQDateSelection is published on globalThis", () => {
  assert(
    GRQDateSelection,
    "date_selection.js should publish globalThis.GRQDateSelection",
  );
});

Deno.test("dateFromSearch extracts the requested date", () => {
  assertEquals(
    GRQDateSelection.dateFromSearch("?date=2026-03-23"),
    "2026-03-23",
  );
  // Works alongside other params.
  assertEquals(
    GRQDateSelection.dateFromSearch("?stock=NYSE%3ADD&date=2026-03-23"),
    "2026-03-23",
  );
  assertEquals(
    GRQDateSelection.dateFromSearch("date=2024-10-15"),
    "2024-10-15",
  );
  // Surrounding whitespace is trimmed.
  assertEquals(
    GRQDateSelection.dateFromSearch("?date=%202026-03-23%20"),
    "2026-03-23",
  );
});

Deno.test("dateFromSearch returns null when absent or blank", () => {
  assertEquals(
    GRQDateSelection.dateFromSearch("?file=2026/March/23.tsv"),
    null,
  );
  assertEquals(GRQDateSelection.dateFromSearch("?date="), null);
  assertEquals(GRQDateSelection.dateFromSearch("?date=%20%20"), null);
  assertEquals(GRQDateSelection.dateFromSearch(""), null);
  assertEquals(GRQDateSelection.dateFromSearch(null), null);
  assertEquals(GRQDateSelection.dateFromSearch(undefined), null);
});

Deno.test("resolveDateSelection matches a score by exact date", () => {
  assertEquals(
    GRQDateSelection.resolveDateSelection(SCORES, "2026-03-23"),
    "2026/March/23.tsv",
  );
  assertEquals(
    GRQDateSelection.resolveDateSelection(SCORES, "2024-10-15"),
    "2024/October/15.tsv",
  );
});

Deno.test("resolveDateSelection accepts unpadded month/day", () => {
  // A user may type 2026-3-3 rather than the canonical 2026-03-03.
  assertEquals(
    GRQDateSelection.resolveDateSelection(SCORES, "2026-3-3"),
    "2026/March/3.tsv",
  );
  assertEquals(
    GRQDateSelection.resolveDateSelection(SCORES, "2026-3-23"),
    "2026/March/23.tsv",
  );
});

Deno.test("resolveDateSelection returns null for an unknown date", () => {
  assertEquals(
    GRQDateSelection.resolveDateSelection(SCORES, "2025-01-01"),
    null,
  );
});

Deno.test("resolveDateSelection returns null for malformed input", () => {
  assertEquals(
    GRQDateSelection.resolveDateSelection(SCORES, "not-a-date"),
    null,
  );
  assertEquals(
    GRQDateSelection.resolveDateSelection(SCORES, "2026-13-40"),
    null,
  );
  assertEquals(GRQDateSelection.resolveDateSelection(SCORES, ""), null);
  assertEquals(GRQDateSelection.resolveDateSelection(SCORES, null), null);
  assertEquals(GRQDateSelection.resolveDateSelection(null, "2026-03-23"), null);
});

// --- issue #517: round-tripping the selected Score File date through the URL --

Deno.test("dateForFile maps a selected score file back to its date", () => {
  assertEquals(
    GRQDateSelection.dateForFile(SCORES, "2026/March/23.tsv"),
    "2026-03-23",
  );
  assertEquals(
    GRQDateSelection.dateForFile(SCORES, "2024/October/15.tsv"),
    "2024-10-15",
  );
});

Deno.test("dateForFile returns null for unknown or blank files", () => {
  assertEquals(GRQDateSelection.dateForFile(SCORES, "2099/Jan/1.tsv"), null);
  assertEquals(GRQDateSelection.dateForFile(SCORES, ""), null);
  assertEquals(GRQDateSelection.dateForFile(SCORES, null), null);
  assertEquals(GRQDateSelection.dateForFile(null, "2026/March/23.tsv"), null);
});

Deno.test("searchWithDate sets ?date= and drops ?file=", () => {
  // A fresh dashboard (no query) gains the chosen date.
  assertEquals(
    GRQDateSelection.searchWithDate("", "2026-03-25"),
    "date=2026-03-25",
  );
  // An existing ?date= is replaced, not duplicated.
  assertEquals(
    GRQDateSelection.searchWithDate("?date=2024-01-01", "2026-03-25"),
    "date=2026-03-25",
  );
  // A stale ?file= is removed so ?date= wins on reload.
  assertEquals(
    GRQDateSelection.searchWithDate(
      "?file=2024%2FOctober%2F15.tsv",
      "2026-03-25",
    ),
    "date=2026-03-25",
  );
});

Deno.test("searchWithDate preserves unrelated params", () => {
  const result = GRQDateSelection.searchWithDate(
    "?stock=NASDAQ%3AMGRC&window=180",
    "2026-03-25",
  );
  const params = new URLSearchParams(result);
  assertEquals(params.get("date"), "2026-03-25");
  assertEquals(params.get("stock"), "NASDAQ:MGRC");
  assertEquals(params.get("window"), "180");
  assertEquals(params.get("file"), null);
});

Deno.test("searchWithDate leaves date untouched for an invalid date", () => {
  assertEquals(
    GRQDateSelection.searchWithDate("?window=90", "not-a-date"),
    "window=90",
  );
  assertEquals(GRQDateSelection.searchWithDate("", null), "");
});

Deno.test("linkWithDate appends the date to a plain page link", () => {
  assertEquals(
    GRQDateSelection.linkWithDate("trend.html", "2026-03-25"),
    "trend.html?date=2026-03-25",
  );
  assertEquals(
    GRQDateSelection.linkWithDate("index.html", "2026-03-25"),
    "index.html?date=2026-03-25",
  );
  // Unpadded month/day is canonicalised.
  assertEquals(
    GRQDateSelection.linkWithDate("index.html", "2026-3-5"),
    "index.html?date=2026-03-05",
  );
});

Deno.test("linkWithDate returns the base unchanged for a missing date", () => {
  // The Trend page must stay independent of the date: no date → plain link.
  assertEquals(GRQDateSelection.linkWithDate("index.html", null), "index.html");
  assertEquals(GRQDateSelection.linkWithDate("index.html", ""), "index.html");
  assertEquals(
    GRQDateSelection.linkWithDate("trend.html", "garbage"),
    "trend.html",
  );
});

Deno.test("linkWithDate replaces an existing date and keeps other params", () => {
  assertEquals(
    GRQDateSelection.linkWithDate("trend.html?date=2020-01-01", "2026-03-25"),
    "trend.html?date=2026-03-25",
  );
  const result = GRQDateSelection.linkWithDate(
    "index.html?window=180#chart",
    "2026-03-25",
  );
  assertEquals(result, "index.html?window=180&date=2026-03-25#chart");
});
