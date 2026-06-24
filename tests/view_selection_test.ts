// Behavioural tests for the view deep-link helpers (issue #479).
//
// These import the REAL shipped helpers from docs/view_selection.js — the same
// pure functions the dashboard uses to honour a `?view=portfolio|trend` URL
// parameter and route between the aggregate ("portfolio") view of
// docs/index.html and the separate Prediction Trend page docs/trend.html.
// The module publishes its helpers on globalThis and touches no DOM, so it
// imports cleanly under Deno.
import { assert, assertEquals } from "@std/assert";
import "../docs/view_selection.js";

const g = globalThis as unknown as {
  GRQViewSelection: {
    viewFromSearch: (search: unknown) => string | null;
    currentPageFromPath: (pathname: unknown) => string;
    viewRedirectTarget: (pathname: unknown, search: unknown) => string | null;
  };
};
const GRQViewSelection = g.GRQViewSelection;

Deno.test("GRQViewSelection is published on globalThis", () => {
  assert(
    GRQViewSelection,
    "view_selection.js should publish globalThis.GRQViewSelection",
  );
});

Deno.test("viewFromSearch extracts a valid view", () => {
  assertEquals(GRQViewSelection.viewFromSearch("?view=portfolio"), "portfolio");
  assertEquals(GRQViewSelection.viewFromSearch("?view=trend"), "trend");
  assertEquals(GRQViewSelection.viewFromSearch("view=trend"), "trend");
  // Works alongside other params.
  assertEquals(
    GRQViewSelection.viewFromSearch("?theme=dark&view=trend"),
    "trend",
  );
  // Case-insensitive and whitespace-tolerant.
  assertEquals(GRQViewSelection.viewFromSearch("?view=TREND"), "trend");
  assertEquals(
    GRQViewSelection.viewFromSearch("?view=%20portfolio%20"),
    "portfolio",
  );
});

Deno.test("viewFromSearch returns null when absent, blank or invalid", () => {
  assertEquals(GRQViewSelection.viewFromSearch(""), null);
  assertEquals(GRQViewSelection.viewFromSearch("?theme=dark"), null);
  assertEquals(GRQViewSelection.viewFromSearch("?view="), null);
  assertEquals(GRQViewSelection.viewFromSearch("?view=%20%20"), null);
  assertEquals(GRQViewSelection.viewFromSearch("?view=single"), null);
  assertEquals(GRQViewSelection.viewFromSearch(null), null);
  assertEquals(GRQViewSelection.viewFromSearch(undefined), null);
});

Deno.test("currentPageFromPath identifies the index vs trend page", () => {
  assertEquals(GRQViewSelection.currentPageFromPath("/index.html"), "index");
  assertEquals(GRQViewSelection.currentPageFromPath("/"), "index");
  assertEquals(GRQViewSelection.currentPageFromPath(""), "index");
  assertEquals(GRQViewSelection.currentPageFromPath("/GRQ/"), "index");
  assertEquals(GRQViewSelection.currentPageFromPath("/trend.html"), "trend");
  assertEquals(
    GRQViewSelection.currentPageFromPath("/sub/trend.html"),
    "trend",
  );
});

Deno.test("viewRedirectTarget routes index -> trend and trend -> portfolio", () => {
  // On index, ?view=trend routes to the Trend page.
  assertEquals(
    GRQViewSelection.viewRedirectTarget("/index.html", "?view=trend"),
    "trend.html",
  );
  // On trend, ?view=portfolio routes back to the aggregate page.
  assertEquals(
    GRQViewSelection.viewRedirectTarget("/trend.html", "?view=portfolio"),
    "index.html",
  );
});

Deno.test("viewRedirectTarget returns null when already on the requested view", () => {
  // Already on the portfolio (index) page.
  assertEquals(
    GRQViewSelection.viewRedirectTarget("/index.html", "?view=portfolio"),
    null,
  );
  // Already on the trend page.
  assertEquals(
    GRQViewSelection.viewRedirectTarget("/trend.html", "?view=trend"),
    null,
  );
});

Deno.test("viewRedirectTarget returns null for absent or invalid view", () => {
  assertEquals(GRQViewSelection.viewRedirectTarget("/index.html", ""), null);
  assertEquals(
    GRQViewSelection.viewRedirectTarget("/index.html", "?view=single"),
    null,
  );
  assertEquals(
    GRQViewSelection.viewRedirectTarget("/trend.html", "?theme=dark"),
    null,
  );
  // Defensive: non-string inputs never throw.
  assertEquals(GRQViewSelection.viewRedirectTarget(null, null), null);
});
