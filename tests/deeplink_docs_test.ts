// Tests that README.md's "Deep-link URL parameters" section documents the
// parameters added under milestone #450 (issue #483), and that the documented
// parameter keys match the values actually shipped in docs/*.js.
//
// These assert *derivable relationships* between the README prose and the
// source of truth in the dashboard scripts (the valid `?view=` values, the
// `?indices=` overlay keys, the `?group=` granularities and the `?fullscreen=1`
// trigger value), so the docs cannot silently drift from shipped behaviour.

import { assert } from "@std/assert";

const README = "README.md";

async function readText(path: string): Promise<string> {
  return await Deno.readTextFile(path);
}

// Pull the deep-link section out of the README so assertions are scoped to it
// rather than matching coincidental text elsewhere in the file.
async function deepLinkSection(): Promise<string> {
  const text = await readText(README);
  const start = text.indexOf("#### Deep-link URL parameters");
  assert(start >= 0, "README must have a 'Deep-link URL parameters' section");
  const rest = text.slice(start + 1);
  const next = rest.indexOf("\n#### ");
  return next >= 0 ? rest.slice(0, next) : rest;
}

Deno.test("README documents the ?view= values shipped by view_selection.js", async () => {
  const section = await deepLinkSection();
  const src = await readText("docs/view_selection.js");
  const match = src.match(/VALID_VIEWS\s*=\s*\[([^\]]*)\]/);
  assert(match, "view_selection.js must define VALID_VIEWS");
  const views = [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert(views.length > 0, "expected at least one valid view");
  assert(section.includes("?view="), "README must document ?view=");
  for (const view of views) {
    assert(
      section.includes(view),
      `README deep-link section must document the ?view= value "${view}"`,
    );
  }
});

Deno.test("README documents the ?indices= overlay keys", async () => {
  const section = await deepLinkSection();
  for (const key of ["sp500", "nasdaq", "russell2000"]) {
    assert(
      section.includes(key),
      `README deep-link section must document the ?indices= key "${key}"`,
    );
  }
  assert(section.includes("?indices="), "README must document ?indices=");
});

Deno.test("README documents the ?group= granularities", async () => {
  const section = await deepLinkSection();
  assert(section.includes("?group="), "README must document ?group=");
  for (const g of ["day", "week", "month", "quarter"]) {
    assert(
      section.includes(g),
      `README deep-link section must document the ?group= value "${g}"`,
    );
  }
});

Deno.test("README documents ?fullscreen=1 as mobile-only / no-op on desktop", async () => {
  const section = await deepLinkSection();
  assert(section.includes("?fullscreen=1"), "README must document ?fullscreen=1");
  assert(
    /no-op on desktop/i.test(section),
    "README must note ?fullscreen=1 is a no-op on desktop",
  );
});

Deno.test("README includes the canonical combined and Trend worked examples", async () => {
  const section = await deepLinkSection();
  assert(
    section.includes("Worked examples"),
    "README must include a 'Worked examples' list",
  );
  assert(
    section.includes("?date=2026-01-01&window=180&fullscreen=1"),
    "README must include the canonical combined worked example",
  );
  assert(
    section.includes("?group=week&indices=sp500,nasdaq"),
    "README must include the Trend worked example",
  );
});

Deno.test("README lead-in count matches the number of documented parameters", async () => {
  const section = await deepLinkSection();
  // Count distinct `?param=` bullet definitions (lines that start a list item).
  const params = new Set(
    [...section.matchAll(/^- `\?(\w+)=/gm)].map((m) => m[1]),
  );
  assert(params.size > 0, "expected documented parameters");
  const words = [
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight",
    "nine", "ten",
  ];
  const expected = words[params.size] ?? String(params.size);
  assert(
    section.includes(`reads ${expected} optional query parameters`),
    `README lead-in must say it reads ${expected} optional query parameters ` +
      `(found ${params.size} documented: ${[...params].join(", ")})`,
  );
});
