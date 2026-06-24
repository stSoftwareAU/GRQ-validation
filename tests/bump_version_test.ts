// Tests for scripts/bump_version.ts — the CI-driven app-version incrementer
// that replaced the unreliable local pre-commit hook (Issue #323).
//
// These exercise the real functions with representative file contents and
// assert on the rewritten output and the idempotency logic — no source-text
// greps, and no disk writes (so the suite runs under `deno test --allow-read`).

import { assertEquals, assertThrows } from "@std/assert";
import {
  bumpPatch,
  bumpVersionContents,
  readAppVersion,
  updateIndex,
  updateSw,
  updateSwRegister,
  type VersionFiles,
} from "../scripts/bump_version.ts";

function fixture(version: string): VersionFiles {
  return {
    sw: `// header\nconst APP_VERSION = "${version}";\nconst CACHE = "x";\n`,
    swRegister:
      `(function () {\n  navigator.serviceWorker.register("./sw.js?v=${version}");\n})();\n`,
    index:
      `<meta name="app-version" content="${version}">\n<script src="sw-register.js?v=${version}"></script>\n`,
    trend:
      `<meta name="app-version" content="${version}">\n<script src="sw-register.js?v=${version}"></script>\n`,
  };
}

Deno.test("bumpPatch increments the patch component", () => {
  assertEquals(bumpPatch("1.0.193"), "1.0.194");
  assertEquals(bumpPatch("0.1.10"), "0.1.11");
  assertEquals(bumpPatch("2.5.9"), "2.5.10");
});

Deno.test("bumpPatch rejects malformed versions", () => {
  assertThrows(() => bumpPatch("1.0"), Error, "Invalid semantic version");
  assertThrows(() => bumpPatch("1.0.x"), Error, "Invalid semantic version");
  assertThrows(() => bumpPatch(""), Error, "Invalid semantic version");
});

Deno.test("readAppVersion extracts APP_VERSION from sw.js", () => {
  assertEquals(readAppVersion('const APP_VERSION = "1.0.193";'), "1.0.193");
});

Deno.test("readAppVersion throws when APP_VERSION is absent", () => {
  assertThrows(
    () => readAppVersion("const NOPE = 1;"),
    Error,
    "Could not find APP_VERSION",
  );
});

Deno.test("per-file updaters rewrite only the version token", () => {
  assertEquals(
    updateSw('const APP_VERSION = "1.0.193";', "1.0.194"),
    'const APP_VERSION = "1.0.194";',
  );
  assertEquals(
    updateSwRegister('register("./sw.js?v=1.0.193")', "1.0.194"),
    'register("./sw.js?v=1.0.194")',
  );
  assertEquals(
    updateIndex(
      '<meta name="app-version" content="1.0.193">\n<script src="sw-register.js?v=1.0.193">',
      "1.0.194",
    ),
    '<meta name="app-version" content="1.0.194">\n<script src="sw-register.js?v=1.0.194">',
  );
});

Deno.test("bumpVersionContents increments and keeps all files aligned", () => {
  const { result, files } = bumpVersionContents(fixture("1.0.193"));
  assertEquals(result, { bumped: true, from: "1.0.193", to: "1.0.194" });
  assertEquals(readAppVersion(files.sw), "1.0.194");
  // Every version-bearing location moved to the new version in lockstep.
  assertEquals(files.swRegister.includes("./sw.js?v=1.0.194"), true);
  assertEquals(files.index.includes('content="1.0.194"'), true);
  assertEquals(files.index.includes("sw-register.js?v=1.0.194"), true);
  assertEquals(files.trend.includes('content="1.0.194"'), true);
  assertEquals(files.trend.includes("sw-register.js?v=1.0.194"), true);
  // No stale references to the old version remain.
  assertEquals(files.sw.includes("1.0.193"), false);
  assertEquals(files.swRegister.includes("1.0.193"), false);
  assertEquals(files.index.includes("1.0.193"), false);
  assertEquals(files.trend.includes("1.0.193"), false);
});

Deno.test("bumpVersionContents bumps when current equals the base version", () => {
  const before = fixture("1.0.193");
  const { result, files } = bumpVersionContents(before, "1.0.193");
  assertEquals(result.bumped, true);
  assertEquals(result.to, "1.0.194");
  assertEquals(readAppVersion(files.sw), "1.0.194");
});

Deno.test("bumpVersionContents is idempotent once already bumped", () => {
  // Current branch is at 1.0.194 while base (main) is still 1.0.193 — the
  // version was already bumped on this PR, so a re-run must be a no-op.
  const before = fixture("1.0.194");
  const { result, files } = bumpVersionContents(before, "1.0.193");
  assertEquals(result, { bumped: false, from: "1.0.194", to: "1.0.194" });
  assertEquals(files, before, "files must be returned unchanged");
});

Deno.test("bumpVersionContents always bumps when no base version is given", () => {
  const { result } = bumpVersionContents(fixture("3.2.1"));
  assertEquals(result, { bumped: true, from: "3.2.1", to: "3.2.2" });
});
