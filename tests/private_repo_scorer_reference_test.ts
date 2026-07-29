// Issue #781: the docs and the daily-refresh wrapper must describe the external
// scorer job at concept level only. Naming the PRIVATE upstream repository slug
// (`stSoftwareAU/GRQ`) or its internal script paths (`worker/score.sh`) is dead
// weight to every public reader — who cannot open either — and it maps out the
// private repository's internal layout.

import { assertEquals, assertMatch } from "@std/assert";

const ROOT = new URL("../", import.meta.url);

/** Files that describe the external scorer job for a public audience. */
const AUDITED = [
  "README.md",
  "scripts/refresh_market_indices.ts",
];

/**
 * Private-repository references: the bare `stSoftwareAU/GRQ` slug (but not the
 * public `stSoftwareAU/GRQ-validation` / `-FX-validation` siblings), any
 * `GRQ/<path>` citation into its tree, and its internal shell script names.
 */
const PRIVATE_PATTERNS: Array<[string, RegExp]> = [
  ["private repo slug", /stSoftwareAU\/GRQ(?![-\w])/g],
  ["private repo path", /\bGRQ\/[A-Za-z0-9_.-]+/g],
  ["private script name", /\b(?:worker\/)?(?:score|model_checkin)\.sh\b/g],
];

async function auditedSources(): Promise<Array<[string, string]>> {
  const sources: Array<[string, string]> = [];
  for (const name of AUDITED) {
    sources.push([name, await Deno.readTextFile(new URL(name, ROOT))]);
  }
  return sources;
}

Deno.test("public docs and the refresh wrapper name no private scorer repo or script", async () => {
  const hits: string[] = [];
  for (const [name, text] of await auditedSources()) {
    text.split("\n").forEach((line, i) => {
      for (const [label, pattern] of PRIVATE_PATTERNS) {
        const matches = line.match(pattern);
        if (matches) {
          hits.push(`${name}:${i + 1}: ${label}: ${matches.join(", ")}`);
        }
      }
    });
  }
  assertEquals(
    hits,
    [],
    `Private scorer references found:\n${hits.join("\n")}`,
  );
});

Deno.test("the external scorer job is still documented at concept level", async () => {
  const sources = new Map(await auditedSources());

  const readme = sources.get("README.md") ?? "";
  // The behaviour being documented (an upstream job checks out this repo and
  // commits new predictions/actuals) must survive the rewording.
  assertMatch(readme, /external daily \*\*scorer\*\* job/);
  assertMatch(readme, /checks out this\s+repo and commits new/);
  // The sequence diagram keeps a scorer participant, just without the slug.
  assertMatch(readme, /participant Scorer as [^\n]*\n/);

  const wrapper = sources.get("scripts/refresh_market_indices.ts") ?? "";
  assertMatch(wrapper, /external "scorer" job/);
  assertMatch(wrapper, /checks\n\/\/ out this repo/);
});
