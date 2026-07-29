// Guards issue #783: the diagnostic scripts must not cite internal source-file
// paths of the private upstream prediction/training repository.
//
// This public repository cannot point readers at files they are unable to see,
// so every header comment that documented the ported training semantics by
// naming `GRQ/src/…` (often with line numbers) is reworded to concept level.
// The tests read the shipped script text — the text IS the artefact under test
// — and assert both halves of the fix: the private citations are gone, and the
// concept-level explanation that replaced them survives.

import { assert } from "@std/assert";

const SCRIPTS_DIR = "scripts";

/** Internal file names of the private upstream repository. */
const PRIVATE_SOURCE_FILES = [
  "LearnUtil.ts",
  "LearnUtilTypes.ts",
  "CoreFeatures.ts",
  "ScoreApp.ts",
];

async function scriptFiles(): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(SCRIPTS_DIR)) {
    if (entry.isFile && entry.name.endsWith(".ts")) {
      names.push(`${SCRIPTS_DIR}/${entry.name}`);
    }
  }
  names.sort();
  assert(names.length > 0, "expected TypeScript files under scripts/");
  return names;
}

Deno.test("diagnostic scripts cite no private upstream source paths", async () => {
  for (const file of await scriptFiles()) {
    const text = await Deno.readTextFile(file);
    assert(
      !/GRQ\/src/.test(text),
      `${file} must not cite a private "GRQ/src/…" source path`,
    );
    for (const sourceFile of PRIVATE_SOURCE_FILES) {
      assert(
        !text.includes(sourceFile),
        `${file} must not name the private upstream source file "${sourceFile}"`,
      );
    }
  }
});

Deno.test("diagnostic scripts cite no line numbers of private upstream sources", async () => {
  // e.g. "LearnUtilTypes.ts:19-39" or "ScoreApp.ts:473" — a `.ts` file name
  // followed by a line number is only ever an upstream citation here; this
  // repo's own scripts are referenced by path alone.
  for (const file of await scriptFiles()) {
    const text = await Deno.readTextFile(file);
    const match = text.match(/[\w/.]+\.ts:\d+/);
    assert(
      match === null,
      `${file} must not cite a source line number (found "${match?.[0]}")`,
    );
  }
});

Deno.test("diagnostic scripts still explain the ported training semantics", async () => {
  // Each reworded header must keep describing the training-side behaviour it
  // used to document by path, so the concept-level rewrite loses no meaning.
  const expectations: Record<string, string[]> = {
    "scripts/buy_price_denominator_diagnostic.ts": ["training", "CLOSE"],
    "scripts/diagnose_buy_price_denominator.ts": ["training", "CLOSE"],
    "scripts/diagnose_dividend_basis.ts": ["training", "yearOfDividends"],
    "scripts/dividend_basis_diagnostic.ts": ["Training", "yearOfDividends"],
    "scripts/diagnose_price_basis.ts": ["trained", "LOW"],
    "scripts/diagnose_score_target_decoding.ts": [
      "training",
      "profitRecommend",
    ],
    "scripts/score_target_decoding_diagnostic.ts": [
      "training",
      "profitRecommend",
    ],
  };
  for (const [file, phrases] of Object.entries(expectations)) {
    const text = await Deno.readTextFile(file);
    for (const phrase of phrases) {
      assert(
        text.includes(phrase),
        `${file} must still describe the training behaviour (missing "${phrase}")`,
      );
    }
  }
});
