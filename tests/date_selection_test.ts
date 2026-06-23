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
