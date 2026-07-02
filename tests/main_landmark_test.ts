// Tests for the <main> landmark on the dashboard pages (issue #693).
//
// The HTML bucket requires exactly one <main> landmark per page so that
// assistive-technology users get a programmatic main-content boundary and a
// "skip to main content" target. Previously the primary content region was
// wrapped only in generic <div>s. These assertions read the REAL committed
// HTML so they verify the rendered structure, not the method.

import { assert, assertStringIncludes } from "@std/assert";

const PAGES = ["docs/index.html", "docs/trend.html"];

/** Count non-overlapping occurrences of `needle` in `haystack`. */
function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

for (const page of PAGES) {
  Deno.test(`${page}: has exactly one <main> landmark`, async () => {
    const html = await Deno.readTextFile(page);
    const opens = count(html, "<main");
    const closes = count(html, "</main>");
    assert(
      opens === 1,
      `${page} must have exactly one <main> open tag; found ${opens}`,
    );
    assert(
      closes === 1,
      `${page} must have exactly one </main> close tag; found ${closes}`,
    );
  });

  Deno.test(`${page}: primary content region is the <main> landmark`, async () => {
    const html = await Deno.readTextFile(page);
    // The container-fluid wrapper is the primary content region; it must now be
    // the <main> landmark rather than a generic <div>.
    assertStringIncludes(
      html,
      '<main class="container-fluid">',
      `${page} must expose the primary content region as <main>`,
    );
  });

  Deno.test(`${page}: <main> opens inside <body> before it closes`, async () => {
    const html = await Deno.readTextFile(page);
    const bodyAt = html.indexOf("<body");
    const mainAt = html.indexOf("<main");
    const mainCloseAt = html.indexOf("</main>");
    assert(bodyAt !== -1, `${page} must have a <body>`);
    assert(
      bodyAt < mainAt && mainAt < mainCloseAt,
      `${page} <main> must open after <body> and close after it opens`,
    );
  });
}

Deno.test("index.html: footer sits outside the <main> landmark", async () => {
  const html = await Deno.readTextFile("docs/index.html");
  const mainCloseAt = html.indexOf("</main>");
  const footerAt = html.indexOf("<footer");
  assert(mainCloseAt !== -1, "index.html must close its <main>");
  assert(footerAt !== -1, "index.html must have a <footer>");
  assert(
    footerAt > mainCloseAt,
    "the page <footer> must be a sibling of <main>, not nested inside it",
  );
});
