// Tests for the Dependabot configuration (Issue #75).
//
// Verify .github/dependabot.yml exists, parses as YAML, declares schema
// version 2, and covers the Cargo crate ecosystem (the previously
// unmanaged gap) with a weekly schedule and a release-age quarantine.
// Internal stSoftwareAU/* dependencies must bypass the quarantine so
// they update immediately, mirroring the deno.json minimumDependencyAge
// policy used for the Deno ecosystem.

import { assert, assertEquals } from "@std/assert";
import { parse as parseYaml } from "@std/yaml";

const CONFIG_PATH = ".github/dependabot.yml";

interface Cooldown {
  "default-days"?: number;
  include?: string[];
  exclude?: string[];
}

interface Update {
  "package-ecosystem"?: string;
  directory?: string;
  schedule?: { interval?: string };
  "open-pull-requests-limit"?: number;
  cooldown?: Cooldown;
}

async function loadConfig(): Promise<{ version?: number; updates?: Update[] }> {
  const text = await Deno.readTextFile(CONFIG_PATH);
  return parseYaml(text) as { version?: number; updates?: Update[] };
}

function ecosystem(updates: Update[], name: string): Update | undefined {
  return updates.find((u) => u["package-ecosystem"] === name);
}

Deno.test("dependabot config file exists", async () => {
  const stat = await Deno.stat(CONFIG_PATH);
  assert(stat.isFile, `${CONFIG_PATH} should be a file`);
});

Deno.test("dependabot config parses as YAML and declares version 2", async () => {
  const doc = await loadConfig();
  assertEquals(doc.version, 2, "Dependabot config must declare version: 2");
  assert(Array.isArray(doc.updates), "config must list updates");
  assert(doc.updates!.length > 0, "config must declare at least one ecosystem");
});

Deno.test("dependabot config covers the Cargo ecosystem on a weekly schedule", async () => {
  const doc = await loadConfig();
  const cargo = ecosystem(doc.updates!, "cargo");
  assert(cargo, "config must include a cargo package-ecosystem entry");
  assertEquals(cargo!.directory, "/", "cargo updates must scan the repo root");
  assertEquals(
    cargo!.schedule?.interval,
    "weekly",
    "cargo updates must run on a weekly schedule",
  );
  assert(
    typeof cargo!["open-pull-requests-limit"] === "number" &&
      cargo!["open-pull-requests-limit"]! > 0,
    "cargo updates must set a positive open-pull-requests-limit",
  );
});

Deno.test("dependabot Cargo updates are gated behind a release-age quarantine (Issue #75)", async () => {
  const doc = await loadConfig();
  const cargo = ecosystem(doc.updates!, "cargo");
  assert(cargo, "config must include a cargo package-ecosystem entry");
  const cooldown = cargo!.cooldown;
  assert(
    cooldown,
    "cargo updates must declare a cooldown to quarantine fresh releases",
  );
  // Supply-chain quarantine: external crates published less than 24h ago
  // (default-days >= 1) are held back rather than auto-bumped, blunting the
  // "dormant package republished by a hijacked account" attack shape.
  assert(
    typeof cooldown!["default-days"] === "number" &&
      cooldown!["default-days"]! >= 1,
    "cargo cooldown default-days must be at least 1 (24h quarantine)",
  );
});

Deno.test("dependabot config covers the GitHub Actions ecosystem with internal exclusion", async () => {
  const doc = await loadConfig();
  const actions = ecosystem(doc.updates!, "github-actions");
  assert(
    actions,
    "config must include a github-actions package-ecosystem entry",
  );
  assertEquals(
    actions!.schedule?.interval,
    "weekly",
    "github-actions updates must run on a weekly schedule",
  );
  const cooldown = actions!.cooldown;
  assert(cooldown, "github-actions updates must declare a cooldown");
  assert(
    Array.isArray(cooldown!.exclude),
    "github-actions cooldown must declare an exclude list",
  );
  // Internal stSoftwareAU actions bypass the quarantine and update
  // immediately, per the dependency-bump policy.
  assert(
    cooldown!.exclude!.some((p) => p.includes("stSoftwareAU")),
    "internal stSoftwareAU/* actions must be excluded from the quarantine",
  );
});
