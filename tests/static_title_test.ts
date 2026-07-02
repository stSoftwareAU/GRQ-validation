// Tests for static <title> elements on the published dashboard pages
// (issue #694).
//
// The HTML best-practices bucket requires a present, descriptive <title> in
// each <head>. Historically the title was injected solely at runtime by
// version.js, so any consumer that read the page before script execution
// (crawlers, view-source, no-JS contexts) saw no title. These tests pin a
// static <title> into each page and verify that version.js *augments* that
// static title with the version rather than being its sole source.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";

const PAGES = [
  { path: "docs/index.html", title: "GRQ Validation Dashboard" },
  { path: "docs/trend.html", title: "GRQ Validation Trend" },
];

/** Extract the <head>…</head> section of an HTML document. */
function headOf(html: string): string {
  const m = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i);
  assert(m, "document must have a <head>");
  return m[1];
}

/** Text content of the first <title> element, or null if absent. */
function titleText(html: string): string | null {
  const m = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].trim() : null;
}

for (const page of PAGES) {
  Deno.test(`${page.path} has a static, descriptive <title> in <head>`, async () => {
    const html = await Deno.readTextFile(page.path);
    const head = headOf(html);
    const title = titleText(head);
    assert(title !== null, `${page.path} <head> must contain a <title>`);
    assertEquals(
      title,
      page.title,
      `${page.path} <title> must be the descriptive static text`,
    );
    assert(
      (title as string).length > 0,
      `${page.path} <title> must be non-empty`,
    );
  });
}

/**
 * Minimal document stub so we can execute docs/version.js in Deno and observe
 * the document.title it produces, without a full DOM.
 */
function makeDoc(
  metas: Record<string, string>,
  staticTitle: string,
) {
  return {
    title: staticTitle,
    querySelector(sel: string) {
      const m = sel.match(/meta\[name="([^"]+)"\]/);
      if (m && metas[m[1]] !== undefined) {
        const name = m[1];
        return {
          getAttribute: (attr: string) =>
            attr === "content" ? metas[name] : null,
        };
      }
      return null;
    },
    addEventListener() {},
    getElementById() {
      return null;
    },
  };
}

function runVersionJs(
  code: string,
  doc: ReturnType<typeof makeDoc>,
) {
  const fakeGlobal: Record<string, unknown> = {};
  // version.js references `document` and `globalThis` as free variables; pass
  // both as parameters so the IIFE runs against our stubs in isolation.
  new Function("document", "globalThis", code)(doc, fakeGlobal);
  return fakeGlobal;
}

Deno.test("version.js augments a static <title> with the version", async () => {
  const code = await Deno.readTextFile("docs/version.js");
  const doc = makeDoc(
    { "app-version": "1.2.3", "app-title": "GRQ Validation Dashboard" },
    "GRQ Validation Dashboard",
  );
  const g = runVersionJs(code, doc);
  assertEquals(doc.title, "GRQ Validation Dashboard v1.2.3");
  assertEquals(g.VERSION, "1.2.3");
});

Deno.test("version.js does not blank a static <title> when version is empty", async () => {
  const code = await Deno.readTextFile("docs/version.js");
  const doc = makeDoc(
    { "app-title": "GRQ Validation Dashboard" },
    "GRQ Validation Trend",
  );
  runVersionJs(code, doc);
  // No app-version meta → keep the static title intact (no dangling " v").
  assertEquals(doc.title, "GRQ Validation Trend");
  assert(!doc.title.includes(" v"), "must not append an empty version suffix");
});

Deno.test("version.js falls back to app-title meta when no static title", async () => {
  const code = await Deno.readTextFile("docs/version.js");
  const doc = makeDoc(
    { "app-version": "9.9.9", "app-title": "GRQ Validation Trend" },
    "",
  );
  runVersionJs(code, doc);
  assertStringIncludes(doc.title, "GRQ Validation Trend");
  assertStringIncludes(doc.title, "v9.9.9");
});
