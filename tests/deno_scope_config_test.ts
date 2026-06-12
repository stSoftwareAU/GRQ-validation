// Tests for the Deno quality scope configuration (Issue #88).
//
// `deno.json` previously scoped lint/fmt/test/type-check to the
// `tests/**/*` tree only, so the application code in `helpers/server.ts`
// (and any root `*.ts` scripts) was never linted, formatted, or
// type-checked. These tests assert the scope is broadened to cover the
// application code, and that both runners (`quality.sh` and the
// `deno-quality.yml` CI workflow) actually cover the real helpers files.
//
// The runner tests resolve each `deno check`/`lint`/`fmt` invocation's path
// arguments against the helpers files on disk, rather than grepping the
// command's source text — so behaviour-preserving edits do not break them
// (Issue #150).

import { assert } from "@std/assert";
import { parse as parseJsonc } from "@std/jsonc";
import { parse as parseYaml } from "@std/yaml";
import { globToRegExp } from "@std/path";

const DENO_JSON = "deno.json";
const QUALITY_SH = "quality.sh";
const WORKFLOW = ".github/workflows/deno-quality.yml";
const HELPERS_DIR = "helpers";

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

// --- Behavioural helpers for the runner tests below -------------------------
//
// The earlier tests assert the `deno.json` scope structurally. The tests
// below assert the *outcome* the runners promise: that the real `helpers/`
// TypeScript files on disk fall within the file set each `deno check`/`lint`/
// `fmt` invocation operates on. They resolve the command's path arguments as
// globs against the actual filesystem rather than matching the command's
// spelling, so behaviour-preserving edits (a `helpers/**/*.ts` glob, a line
// split with `\`, etc.) keep passing while a runner that stops covering
// helpers fails.

/** Recursively collect every `*.ts` file under `dir` as a posix path. */
async function helperTsFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) {
      found.push(...await helperTsFiles(path));
    } else if (entry.isFile && entry.name.endsWith(".ts")) {
      found.push(path);
    }
  }
  return found;
}

/** True if any glob in `globs` matches `file` (posix paths). */
function globsCover(globs: string[], file: string): boolean {
  return globs.some((glob) =>
    globToRegExp(glob, { globstar: true }).test(file)
  );
}

/**
 * Join `\`-continued lines, then pull out the path arguments of every
 * `deno <subcommand>` invocation in a shell script. Flags (`--check`, `-A`)
 * are skipped so only file/glob operands remain.
 */
function denoArgsFromShell(script: string, subcommand: string): string[] {
  const joined = script.replace(/\\\n\s*/g, " ");
  const args: string[] = [];
  const re = new RegExp(`\\bdeno\\s+${subcommand}\\b([^\\n;|&]*)`, "g");
  for (const match of joined.matchAll(re)) {
    for (const token of match[1].trim().split(/\s+/)) {
      if (token && !token.startsWith("-")) args.push(token);
    }
  }
  return args;
}

Deno.test("quality.sh checks, lints and formats the real helpers files", async () => {
  const script = await Deno.readTextFile(QUALITY_SH);
  const helpers = await helperTsFiles(HELPERS_DIR);
  assert(helpers.length > 0, "expected at least one helpers/*.ts file on disk");

  for (const subcommand of ["check", "lint", "fmt"]) {
    const globs = denoArgsFromShell(script, subcommand);
    assert(
      globs.length > 0,
      `quality.sh must invoke \`deno ${subcommand}\` with file arguments`,
    );
    for (const file of helpers) {
      assert(
        globsCover(globs, file),
        `quality.sh \`deno ${subcommand}\` must cover ${file}, got ${
          JSON.stringify(globs)
        }`,
      );
    }
  }
});

Deno.test("deno-quality.yml type-checks the real helpers files", async () => {
  const workflow = parseYaml(
    await Deno.readTextFile(WORKFLOW),
  ) as {
    jobs?: Record<string, { steps?: Array<{ run?: string }> }>;
  };
  const helpers = await helperTsFiles(HELPERS_DIR);
  assert(helpers.length > 0, "expected at least one helpers/*.ts file on disk");

  // Inspect the workflow as structured data: collect the `run` text of every
  // step, then find the `deno check` invocation and resolve its arguments.
  const runs = Object.values(workflow.jobs ?? {})
    .flatMap((job) => job.steps ?? [])
    .map((step) => step.run ?? "");
  const checkGlobs = runs.flatMap((run) => denoArgsFromShell(run, "check"));
  assert(
    checkGlobs.length > 0,
    "deno-quality.yml must have a `deno check` step with file arguments",
  );
  for (const file of helpers) {
    assert(
      globsCover(checkGlobs, file),
      `deno-quality.yml \`deno check\` must cover ${file}, got ${
        JSON.stringify(checkGlobs)
      }`,
    );
  }
});
