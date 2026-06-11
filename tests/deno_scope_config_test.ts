// Tests for the Deno quality scope configuration (Issue #88).
//
// `deno.json` previously scoped lint/fmt/test/type-check to the
// `tests/**/*` tree only, so the application code in `helpers/server.ts`
// (and any root `*.ts` scripts) was never linted, formatted, or
// type-checked. These tests assert the scope is broadened to cover the
// application code, and that both runners (`quality.sh` and the
// `deno-quality.yml` CI workflow) type-check the helpers.

import { assert } from "@std/assert";
import { parse as parseJsonc } from "@std/jsonc";

const DENO_JSON = "deno.json";
const QUALITY_SH = "quality.sh";
const WORKFLOW = ".github/workflows/deno-quality.yml";

// The application-code globs the quality scope must include.
const HELPERS_GLOB = "helpers/**/*.ts";
const ROOT_GLOB = "*.ts";

async function loadDenoConfig(): Promise<Record<string, unknown>> {
  const text = await Deno.readTextFile(DENO_JSON);
  return parseJsonc(text) as Record<string, unknown>;
}

function includeList(
  config: Record<string, unknown>,
  section: "top" | "lint" | "fmt" | "test",
): string[] {
  if (section === "top") {
    return (config.include as string[]) ?? [];
  }
  const sub = config[section] as { include?: string[] } | undefined;
  return sub?.include ?? [];
}

Deno.test("deno.json top-level include covers helpers and root scripts", async () => {
  const config = await loadDenoConfig();
  const include = includeList(config, "top");
  assert(
    include.includes(HELPERS_GLOB),
    `top-level include must cover ${HELPERS_GLOB}, got ${
      JSON.stringify(include)
    }`,
  );
  assert(
    include.includes(ROOT_GLOB),
    `top-level include must cover ${ROOT_GLOB}, got ${JSON.stringify(include)}`,
  );
});

Deno.test("deno.json lint.include covers helpers and root scripts", async () => {
  const config = await loadDenoConfig();
  const include = includeList(config, "lint");
  assert(
    include.includes(HELPERS_GLOB),
    `lint.include must cover ${HELPERS_GLOB}, got ${JSON.stringify(include)}`,
  );
  assert(
    include.includes(ROOT_GLOB),
    `lint.include must cover ${ROOT_GLOB}, got ${JSON.stringify(include)}`,
  );
});

Deno.test("deno.json fmt.include covers helpers and root scripts", async () => {
  const config = await loadDenoConfig();
  const include = includeList(config, "fmt");
  assert(
    include.includes(HELPERS_GLOB),
    `fmt.include must cover ${HELPERS_GLOB}, got ${JSON.stringify(include)}`,
  );
  assert(
    include.includes(ROOT_GLOB),
    `fmt.include must cover ${ROOT_GLOB}, got ${JSON.stringify(include)}`,
  );
});

Deno.test("deno.json test.include still covers the tests tree", async () => {
  const config = await loadDenoConfig();
  const include = includeList(config, "test");
  assert(
    include.includes("tests/**/*"),
    `test.include must still cover tests/**/*, got ${JSON.stringify(include)}`,
  );
});

Deno.test("quality.sh type-checks and lints the helpers directory", async () => {
  const text = await Deno.readTextFile(QUALITY_SH);
  // The local runner must type-check and lint helpers/*.ts, not just tests.
  assert(
    /\bdeno\s+check\b[^\n]*\bhelpers\/[^\n]*\.ts\b/.test(text),
    "quality.sh must run `deno check` over helpers/*.ts",
  );
  assert(
    /\bdeno\s+lint\b[^\n]*\bhelpers\/[^\n]*\.ts\b/.test(text),
    "quality.sh must run `deno lint` over helpers/*.ts",
  );
  assert(
    /\bdeno\s+fmt\b[^\n]*\bhelpers\/[^\n]*\.ts\b/.test(text),
    "quality.sh must run `deno fmt` over helpers/*.ts",
  );
});

Deno.test("deno-quality.yml type-checks the helpers directory", async () => {
  const text = await Deno.readTextFile(WORKFLOW);
  // The CI `deno check` step must cover helpers/*.ts alongside tests/*.ts.
  assert(
    /\bdeno\s+check\b[^\n]*\bhelpers\/[^\n]*\.ts\b/.test(text),
    "deno-quality.yml must run `deno check` over helpers/*.ts",
  );
});
