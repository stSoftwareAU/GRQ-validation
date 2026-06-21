// Tests for the Cargo supply-chain quarantine hardening (Issue #124).
//
// The Deno ecosystem is already quarantined (deno.json minimumDependencyAge
// P1D + deno-outdated.yml --minimum-dependency-age=P1D), and Dependabot now
// gates Cargo bumps behind a 24h cooldown (Issue #75). The remaining gap is
// the CI pipeline itself:
//
//   1. ci.yml ran an unconditional `cargo update` on every PR, floating every
//      crate to the newest in-range version and executing its build.rs /
//      proc-macros with zero age gate.
//   2. The CI tool installs (cargo-tarpaulin, cargo-cyclonedx, cargo-audit)
//      were unpinned, compiling and running an arbitrary newest tool tree.
//
// These tests assert the pipeline builds the committed, reviewed Cargo.lock
// (`--locked`) and pins its tool installs to explicit versions.

import { assert } from "@std/assert";
import { parse as parseYaml } from "@std/yaml";

const CI_PATH = ".github/workflows/ci.yml";
const AUDIT_PATH = ".github/workflows/cargo-audit.yml";

type Step = { name?: string; run?: string; uses?: string };

async function jobSteps(path: string, job: string): Promise<Step[]> {
  const text = await Deno.readTextFile(path);
  const doc = parseYaml(text) as { jobs?: Record<string, { steps?: Step[] }> };
  return doc.jobs?.[job]?.steps ?? [];
}

function runText(steps: Step[]): string {
  return steps.map((s) => s.run ?? "").join("\n");
}

Deno.test("ci.yml test job no longer runs an unconditional cargo update (Issue #124)", async () => {
  const runs = runText(await jobSteps(CI_PATH, "test"));
  assert(
    !/\bcargo\s+update\b/.test(runs),
    "ci.yml test job must not float deps with `cargo update`; build the committed Cargo.lock",
  );
});

Deno.test("ci.yml build job does not run cargo update (Issue #124)", async () => {
  const runs = runText(await jobSteps(CI_PATH, "build"));
  assert(
    !/\bcargo\s+update\b/.test(runs),
    "ci.yml build job must not float deps with `cargo update`",
  );
});

Deno.test("ci.yml test job builds/tests with --locked to honour Cargo.lock (Issue #124)", async () => {
  const runs = runText(await jobSteps(CI_PATH, "test"));
  for (const cmd of ["cargo check", "cargo test"]) {
    const re = new RegExp(`${cmd.replace(/ /g, "\\s+")}[^\\n]*--locked`);
    assert(re.test(runs), `ci.yml test job: \`${cmd}\` must pass --locked`);
  }
});

Deno.test("ci.yml release build uses --locked (Issue #124)", async () => {
  const runs = runText(await jobSteps(CI_PATH, "build"));
  assert(
    /cargo\s+build\b[^\n]*--locked/.test(runs),
    "ci.yml build job: `cargo build --release` must pass --locked",
  );
});

// Find the `cargo install <tool>` line within the combined run text. Returns
// "" when no install line is present, so callers fail with a clear message.
function installLine(runs: string, tool: string): string {
  const re = new RegExp(`cargo\\s+install\\s+${tool}\\b`);
  return runs.split("\n").find((l) => re.test(l)) ?? "";
}

// Assert the observable supply-chain contract for a tool install: both flags
// present and the version pinned. Order-independent — swapping --locked and
// --version preserves behaviour and must keep the test green.
function assertPinnedInstall(runs: string, tool: string, source: string): void {
  const line = installLine(runs, tool);
  assert(line !== "", `${source} must install ${tool}`);
  assert(
    /\s--locked\b/.test(line),
    `${source}: ${tool} install must pass --locked`,
  );
  assert(
    /\s--version\s+\d+\.\d+/.test(line),
    `${source}: ${tool} install must pin --version`,
  );
}

Deno.test("ci.yml pins cargo tool installs to explicit versions with --locked (Issue #124)", async () => {
  const runs = runText(await jobSteps(CI_PATH, "test")) + "\n" +
    runText(await jobSteps(CI_PATH, "build"));
  for (const tool of ["cargo-tarpaulin", "cargo-cyclonedx"]) {
    assertPinnedInstall(runs, tool, "ci.yml");
  }
});

Deno.test("cargo-audit.yml pins cargo-audit install to an explicit version with --locked (Issue #124)", async () => {
  const runs = runText(await jobSteps(AUDIT_PATH, "audit"));
  assertPinnedInstall(runs, "cargo-audit", "cargo-audit.yml");
});
