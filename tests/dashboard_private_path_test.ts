// Guards issue #782: the dashboard JavaScript served to every visitor must not
// cite internal source-file paths of the PRIVATE upstream prediction/training
// repository. Those files ship to the public, so naming `GRQ/src/…` paths (and
// line numbers within them) points readers at code they cannot see.
//
// The comments must still explain the ported training semantics — the fix is a
// reword to concept level, not a deletion — so both halves are asserted here.

import { assert, assertEquals } from "@std/assert";

const DOCS_DIR = "docs";

/** Path citations into the private upstream repository's source tree. */
const PRIVATE_PATH_PATTERN = /GRQ\/src\/[A-Za-z0-9_./-]+/g;

/** Internal file names of the private upstream repository. */
const PRIVATE_SOURCE_FILES = [
  "LearnUtil.ts",
  "LearnUtilTypes.ts",
  "CoreFeatures.ts",
  "ScoreApp.ts",
];

async function dashboardSources(): Promise<Array<[string, string]>> {
  const sources: Array<[string, string]> = [];
  for await (const entry of Deno.readDir(DOCS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".js")) continue;
    sources.push([
      `${DOCS_DIR}/${entry.name}`,
      await Deno.readTextFile(`${DOCS_DIR}/${entry.name}`),
    ]);
  }
  assert(sources.length > 0, "expected JavaScript files under docs/");
  return sources.sort(([a], [b]) => a.localeCompare(b));
}

Deno.test("dashboard JS cites no private GRQ/src source paths", async () => {
  const hits: string[] = [];
  for (const [name, text] of await dashboardSources()) {
    text.split("\n").forEach((line, i) => {
      const matches = line.match(PRIVATE_PATH_PATTERN);
      if (matches) hits.push(`${name}:${i + 1}: ${matches.join(", ")}`);
    });
  }
  assertEquals(
    hits,
    [],
    `Private source-path citations found:\n${hits.join("\n")}`,
  );
});

Deno.test("dashboard JS names no private upstream source files", async () => {
  const hits: string[] = [];
  for (const [name, text] of await dashboardSources()) {
    text.split("\n").forEach((line, i) => {
      for (const sourceFile of PRIVATE_SOURCE_FILES) {
        if (line.includes(sourceFile)) {
          hits.push(`${name}:${i + 1}: ${sourceFile}`);
        }
      }
    });
  }
  assertEquals(
    hits,
    [],
    `Private source-file names found:\n${hits.join("\n")}`,
  );
});

Deno.test("dashboard JS cites no upstream source line numbers", async () => {
  // A `.ts` file name followed by a line number is only ever an upstream
  // citation here; this repo's own files are referenced by path alone.
  const hits: string[] = [];
  for (const [name, text] of await dashboardSources()) {
    text.split("\n").forEach((line, i) => {
      const match = line.match(/[\w/.-]+\.ts:\d+/);
      if (match) hits.push(`${name}:${i + 1}: ${match[0]}`);
    });
  }
  assertEquals(
    hits,
    [],
    `Source line-number citations found:\n${hits.join("\n")}`,
  );
});

/** Collapse `//` comment wrapping so a phrase split across lines still matches. */
function flatten(text: string): string {
  return text.replace(/\n\s*(\/\/|\*)?[ \t]*/g, " ");
}

Deno.test("the dashboard JS still documents the ported training semantics", async () => {
  const projection = flatten(
    await Deno.readTextFile(`${DOCS_DIR}/projection.js`),
  );
  const volume = flatten(
    await Deno.readTextFile(`${DOCS_DIR}/volume_recommend.js`),
  );

  // projection.js keeps the three concept-level explanations that replaced the
  // path citations: the trained low-price basis, the close denominator and the
  // flat quarterly dividend credit.
  assert(
    /price basis the GRQ model is TRAINED on/.test(projection),
    "projection.js must still explain the trained intraday-low price basis",
  );
  assert(
    /close on the score date/.test(projection),
    "projection.js must still explain the trained close denominator",
  );
  assert(
    /yearOfDividends \/ 4/.test(projection),
    "projection.js must still explain the flat quarterly dividend credit",
  );

  // volume_recommend.js keeps its ported-definition provenance and the single
  // liquidity threshold explanation.
  assert(
    /Ported from GRQ training's `volumeRecommend`/.test(volume),
    "volume_recommend.js must still record that volumeRecommend is ported",
  );
  assert(
    /single liquidity threshold, in DOLLARS/.test(volume),
    "volume_recommend.js must still explain BUDGET_DOLLARS",
  );
  assert(
    /Math\.min\(core\.volumeRecommend, priceRecommend, 1\)/.test(volume),
    "volume_recommend.js must still document the training-side score cap",
  );
});
