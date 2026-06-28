// Increment the dashboard app version across the published docs files so the
// service-worker cache key changes and clients re-fetch the new build
// (Issue #323).
//
// This replaces the unreliable local pre-commit hook (removed in #323) with a
// deterministic, CI-driven bump. The version lives in several places that must
// stay aligned (see tests/sw_precache_list_test.ts and
// tests/trend_view_wiring_test.ts):
//   - docs/sw.js          const APP_VERSION = "X.Y.Z";
//   - docs/sw-register.js  ./sw.js?v=X.Y.Z
//   - docs/index.html      <meta name="app-version" content="X.Y.Z">
//   - docs/index.html      sw-register.js?v=X.Y.Z
//   - docs/trend.html      <meta name="app-version" content="X.Y.Z">
//   - docs/trend.html      sw-register.js?v=X.Y.Z
//
// The bump is idempotent relative to a base version: when `baseVersion` is
// supplied (the version on the PR's base branch) and the working copy already
// differs from it, the version has already been bumped on this branch and the
// script makes no further change. That keeps a single PR from ratcheting the
// version on every CI run.

import { join } from "@std/path";

export interface BumpResult {
  /** True when the files were rewritten with a new version. */
  bumped: boolean;
  /** The version found before the bump. */
  from: string;
  /** The version after the bump (equals `from` when not bumped). */
  to: string;
}

/** The version-bearing docs files, keyed by role. */
export interface VersionFiles {
  sw: string;
  swRegister: string;
  index: string;
  trend: string;
}

const SW = "sw.js";
const SW_REGISTER = "sw-register.js";
const INDEX = "index.html";
const TREND = "trend.html";

/** Increment the patch component of a strict `major.minor.patch` version. */
export function bumpPatch(version: string): string {
  const parts = version.split(".");
  if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) {
    throw new Error(`Invalid semantic version: "${version}"`);
  }
  const [major, minor, patch] = parts.map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

/** Extract the APP_VERSION declared in docs/sw.js. */
export function readAppVersion(swText: string): string {
  const match = swText.match(/const APP_VERSION = "([^"]+)";/);
  if (!match) {
    throw new Error("Could not find APP_VERSION in sw.js");
  }
  return match[1];
}

/** Rewrite the APP_VERSION constant in sw.js. */
export function updateSw(text: string, newVersion: string): string {
  return text.replace(
    /(const APP_VERSION = ")[^"]+(";)/,
    `$1${newVersion}$2`,
  );
}

/** Rewrite the `./sw.js?v=` query in sw-register.js. */
export function updateSwRegister(text: string, newVersion: string): string {
  return text.replace(/(\.\/sw\.js\?v=)[0-9.]+/, `$1${newVersion}`);
}

/**
 * Rewrite the app-version meta and every local `<script src="…js?v=…">`
 * cache-buster in an HTML page. Used for both index.html and trend.html, which
 * share these patterns.
 *
 * The script-tag rewrite is global (issue #641): app.js is loaded with a
 * `?v=<VERSION>` cache-buster, so its dependencies (projection.js and the
 * other helper scripts) must carry the SAME version query or a returning user
 * can run a freshly-fetched app.js against a stale, cache-first dependency.
 * Bumping the version here keeps every such script — including sw-register.js —
 * in lockstep.
 */
export function updateIndex(text: string, newVersion: string): string {
  return text
    .replace(
      /(<meta name="app-version" content=")[^"]+(">)/,
      `$1${newVersion}$2`,
    )
    .replace(/(src="[^"]+\.js\?v=)[0-9.]+/g, `$1${newVersion}`);
}

/**
 * Pure core of the bump: given the current file contents, return the rewritten
 * contents and a result describing the change.
 *
 * When `baseVersion` is provided and the current version already differs from
 * it, the branch is treated as already bumped: the files are returned
 * unchanged and `bumped` is false. This keeps a single PR from ratcheting the
 * version on every CI run.
 */
export function bumpVersionContents(
  files: VersionFiles,
  baseVersion?: string,
): { result: BumpResult; files: VersionFiles } {
  const current = readAppVersion(files.sw);

  if (baseVersion !== undefined && current !== baseVersion) {
    return { result: { bumped: false, from: current, to: current }, files };
  }

  const newVersion = bumpPatch(current);
  return {
    result: { bumped: true, from: current, to: newVersion },
    files: {
      sw: updateSw(files.sw, newVersion),
      swRegister: updateSwRegister(files.swRegister, newVersion),
      index: updateIndex(files.index, newVersion),
      trend: updateIndex(files.trend, newVersion),
    },
  };
}

/**
 * Increment the patch version across the docs files in `docsDir`.
 *
 * Thin I/O wrapper around {@link bumpVersionContents}; only writes when a bump
 * actually occurs.
 *
 * File-local: only the CLI `main` flow below calls it. The pure, unit-tested
 * helper is {@link bumpVersionContents}.
 */
async function bumpVersionFiles(
  docsDir: string,
  baseVersion?: string,
): Promise<BumpResult> {
  const swPath = join(docsDir, SW);
  const swRegisterPath = join(docsDir, SW_REGISTER);
  const indexPath = join(docsDir, INDEX);
  const trendPath = join(docsDir, TREND);

  const before: VersionFiles = {
    sw: await Deno.readTextFile(swPath),
    swRegister: await Deno.readTextFile(swRegisterPath),
    index: await Deno.readTextFile(indexPath),
    trend: await Deno.readTextFile(trendPath),
  };

  const { result, files } = bumpVersionContents(before, baseVersion);

  if (result.bumped) {
    await Deno.writeTextFile(swPath, files.sw);
    await Deno.writeTextFile(swRegisterPath, files.swRegister);
    await Deno.writeTextFile(indexPath, files.index);
    await Deno.writeTextFile(trendPath, files.trend);
  }

  return result;
}

function parseArgs(args: string[]): {
  docsDir: string;
  baseVersion?: string;
} {
  let docsDir = "docs";
  let baseVersion: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--docs-dir") {
      docsDir = args[++i] ?? docsDir;
    } else if (arg.startsWith("--docs-dir=")) {
      docsDir = arg.slice("--docs-dir=".length);
    } else if (arg === "--base-version") {
      baseVersion = args[++i];
    } else if (arg.startsWith("--base-version=")) {
      baseVersion = arg.slice("--base-version=".length);
    }
  }
  // An empty --base-version (e.g. the base branch lacked the file) means
  // "no base to compare against": always bump.
  if (baseVersion === "") baseVersion = undefined;
  return { docsDir, baseVersion };
}

if (import.meta.main) {
  const { docsDir, baseVersion } = parseArgs(Deno.args);
  const result = await bumpVersionFiles(docsDir, baseVersion);
  if (result.bumped) {
    // stdout carries the new version for the CI step to capture; the
    // human-readable note goes to stderr.
    console.log(result.to);
    console.error(`Bumped app version ${result.from} -> ${result.to}`);
  } else {
    console.error(
      `App version already bumped on this branch (${result.from}); no change.`,
    );
  }
}
