// Issue #783: the diagnostic scripts must not cite internal source-file paths
// of the PRIVATE upstream training/prediction repository. A public repo cannot
// point readers at files they are unable to see, so every such citation has to
// be reworded to concept level (describe the training-side behaviour instead).

import { assertEquals } from "@std/assert";

const SCRIPTS_DIR = new URL("../scripts/", import.meta.url);

/** Path citations into the private upstream repository's source tree. */
const PRIVATE_PATH_PATTERN = /GRQ\/src\/[A-Za-z0-9_./-]+/g;

/** "lives upstream in `GRQ`" style pointers at the private repo itself. */
const PRIVATE_REPO_POINTER_PATTERN = /\bin\s+`GRQ`/g;

async function scriptSources(): Promise<Array<[string, string]>> {
  const sources: Array<[string, string]> = [];
  for await (const entry of Deno.readDir(SCRIPTS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".ts")) continue;
    sources.push([
      `scripts/${entry.name}`,
      await Deno.readTextFile(new URL(entry.name, SCRIPTS_DIR)),
    ]);
  }
  return sources.sort(([a], [b]) => a.localeCompare(b));
}

function offenders(pattern: RegExp, sources: Array<[string, string]>) {
  const hits: string[] = [];
  for (const [name, text] of sources) {
    text.split("\n").forEach((line, i) => {
      const matches = line.match(pattern);
      if (matches) hits.push(`${name}:${i + 1}: ${matches.join(", ")}`);
    });
  }
  return hits;
}

Deno.test("diagnostic scripts cite no private GRQ/src source paths", async () => {
  const hits = offenders(PRIVATE_PATH_PATTERN, await scriptSources());
  assertEquals(
    hits,
    [],
    `Private source-path citations found:\n${hits.join("\n")}`,
  );
});

Deno.test("diagnostic scripts do not point at the private repo by name", async () => {
  // Collapse comment continuations so a pointer split across two `//` lines is
  // still caught (that is exactly how the issue #783 line 23 citation read).
  const hits: string[] = [];
  for (const [name, text] of await scriptSources()) {
    const flat = text.replace(/\n\s*(\/\/|\*)?[ \t]*/g, " ");
    const matches = flat.match(PRIVATE_REPO_POINTER_PATTERN);
    if (matches) hits.push(`${name}: ${matches.join(", ")}`);
  }
  assertEquals(hits, [], `Private repo pointers found:\n${hits.join("\n")}`);
});

Deno.test("the scripts still document the ported training semantics", async () => {
  const sources = new Map(await scriptSources());
  // Rewording must not silently delete the explanation: each diagnostic keeps
  // a concept-level description of the training behaviour it is comparing.
  const expectations: Array<[string, RegExp]> = [
    ["scripts/buy_price_denominator_diagnostic.ts", /CLOSE on the score date/],
    ["scripts/diagnose_buy_price_denominator.ts", /CLOSE on the score date/],
    ["scripts/diagnose_dividend_basis.ts", /yearOfDividends/],
    ["scripts/dividend_basis_diagnostic.ts", /yearOfDividends/],
    ["scripts/diagnose_price_basis.ts", /intraday LOW/],
    ["scripts/diagnose_score_target_decoding.ts", /reverseProfitRecommend/],
    ["scripts/score_target_decoding_diagnostic.ts", /reverseProfitRecommend/],
  ];
  for (const [name, pattern] of expectations) {
    const text = sources.get(name);
    assertEquals(typeof text, "string", `${name} should exist`);
    assertEquals(
      pattern.test(text ?? ""),
      true,
      `${name} should still describe the training-side behaviour (${pattern})`,
    );
  }
});
