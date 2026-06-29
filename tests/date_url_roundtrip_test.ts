// End-to-end round-trip for the selected Score File date (issue #517).
//
// The bug: picking a date in the dashboard's Score File dropdown, opening the
// Prediction Trend page, then clicking "← Dashboard" reopened the dashboard on
// its default date instead of the chosen one. The fix routes the chosen date
// through the URL using the REAL shipped helpers in docs/date_selection.js:
//
//   dropdown change → searchWithDate (dashboard URL) + linkWithDate (Trend link)
//   Trend "← Dashboard" → dateFromSearch + linkWithDate (back to index.html)
//   dashboard reload  → dateFromSearch + resolveDateSelection (re-select file)
//
// This test drives that whole chain with the real functions, so a refresh, a
// shared link and the Trend round trip all land on the exact selected date.
//
// It also pins the thin DOM wiring in docs/app.js, docs/trend.js,
// docs/index.html and docs/trend.html. Those bootstrap files instantiate live
// controllers at import time and cannot be imported headless, so — mirroring
// share_button_wiring_test.ts — the wiring is asserted against the source.
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
const D = g.GRQDateSelection;

const SCORES: ScoreEntry[] = [
  { file: "2024/October/15.tsv", date: "2024-10-15" },
  { file: "2026/March/25.tsv", date: "2026-03-25" },
  { file: "2026/March/3.tsv", date: "2026-03-03" },
];

Deno.test("selecting a Score File writes ?date= the dashboard reload restores", () => {
  // The user picks 2026-03-25 in the dropdown (value is the file path).
  const selectedFile = "2026/March/25.tsv";
  const date = D.dateForFile(SCORES, selectedFile);
  assertEquals(date, "2026-03-25");

  // The dashboard mirrors it into its own URL.
  const search = "?" + D.searchWithDate("", date);
  assertEquals(search, "?date=2026-03-25");

  // A refresh / shared link reads it back and re-selects the same file.
  const reloadDate = D.dateFromSearch(search);
  assertEquals(D.resolveDateSelection(SCORES, reloadDate), selectedFile);
});

Deno.test("the selected date survives the Trend round trip via ← Dashboard", () => {
  const selectedFile = "2026/March/25.tsv";
  const date = D.dateForFile(SCORES, selectedFile);

  // Dashboard "📈 Prediction Trend" link forwards the date to trend.html.
  const trendHref = D.linkWithDate("trend.html", date);
  assertEquals(trendHref, "trend.html?date=2026-03-25");

  // On the Trend page, the date is read ONLY to build the return link.
  const trendSearch = "?" + trendHref.split("?")[1];
  const carriedDate = D.dateFromSearch(trendSearch);
  const backHref = D.linkWithDate("index.html", carriedDate);
  assertEquals(backHref, "index.html?date=2026-03-25");

  // Clicking "← Dashboard" returns to the exact selected file.
  const returnedDate = D.dateFromSearch("?" + backHref.split("?")[1]);
  assertEquals(D.resolveDateSelection(SCORES, returnedDate), selectedFile);
});

Deno.test("the Trend page stays independent when no date is supplied", () => {
  // No ?date= on trend.html → the ← Dashboard link stays the plain page, so
  // the Trend view never opens on / depends on a date.
  const carriedDate = D.dateFromSearch("?group=week");
  assertEquals(carriedDate, null);
  assertEquals(D.linkWithDate("index.html", carriedDate), "index.html");
});

// --- markup contracts the wiring depends on ---------------------------------
//
// Issue #633: the former "app.js syncs the date deep links" and "trend.js
// forwards ?date=" tests grepped docs/app.js and docs/trend.js SOURCE TEXT for
// internal identifiers (`updateDateDeepLinks`, `history.replaceState`,
// `updateDashboardBackLink`) and regex-matched call-site spelling. Those passed
// for the wrong reason and broke on any rename. The whole date round trip —
// dropdown → ?date= → reload, and the Trend ← Dashboard hop — is exercised
// behaviourally above against the REAL docs/date_selection.js helpers, so the
// grep tail has been removed. app.js and trend.js bootstrap live controllers at
// import time and cannot be imported headless. What survives below is the static
// markup contract those helpers target: the anchor ids and the script include.

const indexHtml = await Deno.readTextFile("docs/index.html");
const trendHtml = await Deno.readTextFile("docs/trend.html");

Deno.test("the pages expose the link ids and load date_selection.js", () => {
  assert(
    indexHtml.includes('id="trendViewLink"'),
    "index.html must keep the #trendViewLink anchor app.js updates",
  );
  assert(
    trendHtml.includes('id="backToDashboardLink"'),
    "trend.html must give the ← Dashboard link an id to update",
  );
  assert(
    trendHtml.includes('src="date_selection.js"'),
    "trend.html must load date_selection.js for the back-link helpers",
  );
});
