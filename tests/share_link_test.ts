// Behavioural tests for the footer "Share" deep-link builder (issue #495,
// part of milestone #484).
//
// The Share control captures the current dashboard selections as an absolute,
// shareable URL. These tests exercise the REAL shipped pure helpers from
// docs/share_link.js:
//   - buildShareQuery(state) — serialises the current selections into a query
//     string, emitting each param only when it is set / differs from default;
//   - buildShareUrl(pageUrl, state) — strips any existing query/hash from the
//     page URL and appends the freshly-built query.
//
// The builder is READ-ONLY: it never touches localStorage. Pasting its output
// into a fresh tab must reproduce the same score file/date, stock, theme,
// 90/180 window, optional view/indices/group selection, and the transient
// fullscreen pop-out flag.
import { assertEquals, assertStringIncludes } from "@std/assert";
import "../docs/share_link.js";

const g = globalThis as unknown as {
  GRQShare: {
    buildShareQuery: (state: unknown) => string;
    buildShareUrl: (pageUrl: unknown, state: unknown) => string;
  };
};

const S = g.GRQShare;

// --- the pure helpers are published -----------------------------------------

Deno.test("GRQShare publishes the pure share-link helpers", () => {
  assertEquals(typeof S.buildShareQuery, "function");
  assertEquals(typeof S.buildShareUrl, "function");
});

// --- buildShareQuery: per-param serialisation -------------------------------

Deno.test("buildShareQuery emits ?file for the selected score file", () => {
  assertEquals(
    S.buildShareQuery({ file: "2026/March/23.tsv" }),
    "file=2026%2FMarch%2F23.tsv",
  );
});

Deno.test("buildShareQuery prefers file over date when both are present", () => {
  // ?file= wins over ?date= in the app, so the share link mirrors that and
  // never emits a redundant date alongside the exact file path.
  assertEquals(
    S.buildShareQuery({ file: "2026/March/23.tsv", date: "2026-03-23" }),
    "file=2026%2FMarch%2F23.tsv",
  );
});

Deno.test("buildShareQuery emits ?date when only a date is given", () => {
  assertEquals(S.buildShareQuery({ date: "2026-03-23" }), "date=2026-03-23");
});

Deno.test("buildShareQuery emits ?stock for the single-stock view", () => {
  assertEquals(
    S.buildShareQuery({ stock: "NASDAQ:MGRC" }),
    "stock=NASDAQ%3AMGRC",
  );
});

Deno.test("buildShareQuery emits ?theme only for a forced light/dark mode", () => {
  assertEquals(S.buildShareQuery({ theme: "dark" }), "theme=dark");
  assertEquals(S.buildShareQuery({ theme: "light" }), "theme=light");
  // "auto" is the default a fresh tab already falls back to — omit it so the
  // link stays clean and reproduces "follow the system" by absence.
  assertEquals(S.buildShareQuery({ theme: "auto" }), "");
  // Unknown values never leak into the URL.
  assertEquals(S.buildShareQuery({ theme: "neon" }), "");
});

Deno.test("buildShareQuery emits ?window for either allowed window", () => {
  // Emitted on every share so the recipient's device default (mobile 90 /
  // desktop 180) cannot change the window the sharer saw.
  assertEquals(S.buildShareQuery({ window: 90 }), "window=90");
  assertEquals(S.buildShareQuery({ window: 180 }), "window=180");
  assertEquals(S.buildShareQuery({ window: "90" }), "window=90");
  // A disallowed window is dropped rather than shared verbatim.
  assertEquals(S.buildShareQuery({ window: 45 }), "");
});

Deno.test("buildShareQuery emits view/indices/group only when provided", () => {
  assertEquals(S.buildShareQuery({ view: "table" }), "view=table");
  assertEquals(
    S.buildShareQuery({ indices: "sp500,nasdaq" }),
    "indices=sp500%2Cnasdaq",
  );
  assertEquals(S.buildShareQuery({ group: "tech" }), "group=tech");
  // Absent / blank view-state params are omitted (default by absence).
  assertEquals(S.buildShareQuery({ view: "", indices: "", group: "" }), "");
});

Deno.test("buildShareQuery emits ?fullscreen=1 only when in the pop-out", () => {
  assertEquals(S.buildShareQuery({ fullscreen: true }), "fullscreen=1");
  assertEquals(S.buildShareQuery({ fullscreen: false }), "");
});

Deno.test("buildShareQuery composes all selections in a stable order", () => {
  const query = S.buildShareQuery({
    file: "2026/March/23.tsv",
    stock: "NASDAQ:MGRC",
    theme: "dark",
    window: 180,
    fullscreen: true,
  });
  assertEquals(
    query,
    "file=2026%2FMarch%2F23.tsv&stock=NASDAQ%3AMGRC&theme=dark&window=180&fullscreen=1",
  );
});

Deno.test("buildShareQuery returns an empty string for empty/garbage state", () => {
  assertEquals(S.buildShareQuery({}), "");
  assertEquals(S.buildShareQuery(null), "");
  assertEquals(S.buildShareQuery(undefined), "");
});

// --- buildShareUrl: absolute URL assembly -----------------------------------

Deno.test("buildShareUrl appends the query to a bare page URL", () => {
  assertEquals(
    S.buildShareUrl("https://example.com/index.html", { window: 90 }),
    "https://example.com/index.html?window=90",
  );
});

Deno.test("buildShareUrl replaces any existing query and drops the hash", () => {
  // The current page may already carry deep-link params or a fragment; the
  // share link is rebuilt cleanly from the live selections only.
  assertEquals(
    S.buildShareUrl("https://example.com/index.html?file=old.tsv#frag", {
      file: "2026/March/23.tsv",
    }),
    "https://example.com/index.html?file=2026%2FMarch%2F23.tsv",
  );
});

Deno.test("buildShareUrl returns the bare URL when there is nothing to share", () => {
  assertEquals(
    S.buildShareUrl("https://example.com/index.html?file=old.tsv", {}),
    "https://example.com/index.html",
  );
});

Deno.test("buildShareUrl reproduces a full real-world selection", () => {
  const url = S.buildShareUrl(
    "https://stsoftwareau.github.io/GRQ-validation/",
    {
      file: "2026/March/23.tsv",
      stock: "NASDAQ:MGRC",
      theme: "dark",
      window: 180,
    },
  );
  assertStringIncludes(url, "file=2026%2FMarch%2F23.tsv");
  assertStringIncludes(url, "stock=NASDAQ%3AMGRC");
  assertStringIncludes(url, "theme=dark");
  assertStringIncludes(url, "window=180");
});
