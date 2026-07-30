// Guards issue #806 (parent #780): no file in this public repository may name a
// PRIVATE sibling data checkout.
//
// The sibling fixes each shipped a narrow guard over one directory, but nothing
// covered `src/`, `tests/`, `scripts/`, `helpers/`, the shell scripts or the
// archived documentation — which is exactly where the private market-data and
// dividend-history checkout names lived. This test walks the whole tracked tree
// and fails with `file:line: match` for every hit, so a reintroduced literal is
// caught in the PR check rather than after merge.
//
// The scanner is itself under test: the positive-control cases below assert it
// finds a planted literal, so a broken walk cannot pass as "no matches".

import { assert, assertEquals } from "@std/assert";

/** Repository root, resolved relative to this test file. */
const REPO_ROOT = new URL("../", import.meta.url);

/** This file necessarily spells the literals it searches for. */
const SELF = "tests/private_data_root_reference_test.ts";

/**
 * Directories walked in full. Root-level files are scanned too, limited to the
 * types in {@linkcode ROOT_FILE_EXTENSIONS}.
 */
const SCAN_ROOTS = ["src", "tests", "scripts", "helpers", "docs"];

/** Never walked: VCS metadata, build output and vendored/generated trees. */
const EXCLUDED_DIRS = new Set([".git", ".coverage", "node_modules", "target"]);

/** Text file types worth scanning; images and other binaries are skipped. */
const TEXT_EXTENSIONS = new Set([
  ".css",
  ".csv",
  ".html",
  ".js",
  ".json",
  ".jsonc",
  ".md",
  ".rs",
  ".sh",
  ".toml",
  ".ts",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);

/** Root-level files are scanned only for these types (issue #806 scope). */
const ROOT_FILE_EXTENSIONS = new Set([".sh", ".json", ".md"]);

/**
 * The private data-root literals, as regex sources. The market-data tree
 * carries a quarter suffix that gets bumped (see the archived issue #183
 * write-up), so the prefix is matched rather than one quarter. The third
 * pattern catches any relative sibling checkout, so a renamed private tree is
 * caught too; `../GRQ-validation` and `../GRQ-FX-validation` are public and are
 * excluded from it.
 */
const PRIVATE_DATA_ROOT_PATTERNS = [
  "GRQ-shareprices[A-Za-z0-9]*",
  "GRQ-dividends[A-Za-z0-9]*",
  "\\.\\./GRQ-(?!validation\\b|FX-validation\\b)[A-Za-z0-9-]+",
];

/**
 * Files sanctioned to contain a literal, each with the reason it is exempt.
 * Every exception is visible here rather than being a silent hole, and the
 * "every allowlist entry is still live" case below fails once one goes stale.
 */
const ALLOWLIST: Array<{ path: string; reason: string }> = [
  // Empty by design. The three former entries retired with issue #805 (#810):
  // the two dividend diagnostics take a caller-supplied root and the #804
  // hermetic gate writes its pattern as an alternation, so none of them spells
  // a literal any more. This file's own source stays exempt via SELF.
];

const ALLOWLISTED_PATHS = new Set(ALLOWLIST.map((entry) => entry.path));

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
}

/** Repo-relative paths of every text file in the scanned tree, sorted. */
async function scannedFiles(): Promise<string[]> {
  const paths: string[] = [];

  for await (const entry of Deno.readDir(REPO_ROOT)) {
    if (entry.isFile && ROOT_FILE_EXTENSIONS.has(extensionOf(entry.name))) {
      paths.push(entry.name);
    }
  }

  const walk = async (relativeDir: string): Promise<void> => {
    for await (const entry of Deno.readDir(new URL(relativeDir, REPO_ROOT))) {
      const relative = `${relativeDir}${entry.name}`;
      if (entry.isDirectory) {
        if (!EXCLUDED_DIRS.has(entry.name)) await walk(`${relative}/`);
      } else if (entry.isFile && TEXT_EXTENSIONS.has(extensionOf(entry.name))) {
        paths.push(relative);
      }
    }
  };

  for (const root of SCAN_ROOTS) {
    if (!EXCLUDED_DIRS.has(root)) await walk(`${root}/`);
  }

  return paths.sort();
}

/** `file:line: match` for every private data-root literal in `text`. */
function offenders(path: string, text: string): string[] {
  const hits: string[] = [];
  for (const source of PRIVATE_DATA_ROOT_PATTERNS) {
    // Cheap whole-file probe first: only the rare hit pays for line splitting.
    if (!new RegExp(source).test(text)) continue;
    text.split("\n").forEach((line, index) => {
      const matches = line.match(new RegExp(source, "g"));
      if (matches) hits.push(`${path}:${index + 1}: ${matches.join(", ")}`);
    });
  }
  return hits.sort();
}

/** Scans `paths`, skipping this file and the allowlist unless told otherwise. */
async function scan(
  paths: string[],
  { honourExemptions = true } = {},
): Promise<string[]> {
  const hits: string[] = [];
  for (const path of paths) {
    if (honourExemptions && (path === SELF || ALLOWLISTED_PATHS.has(path))) {
      continue;
    }
    const text = await Deno.readTextFile(new URL(path, REPO_ROOT));
    hits.push(...offenders(path, text));
  }
  return hits;
}

Deno.test("no file names a private data-root checkout", async () => {
  const hits = await scan(await scannedFiles());
  assertEquals(
    hits,
    [],
    `Private data-root literals found — reword to concept level:\n${
      hits.join("\n")
    }`,
  );
});

Deno.test("every allowlist entry is still live", async () => {
  // A stale exemption is a silent hole: once the literal it covers is gone the
  // entry must be deleted, which is how the temporary #805 entries retire.
  for (const { path, reason } of ALLOWLIST) {
    const text = await Deno.readTextFile(new URL(path, REPO_ROOT));
    assert(
      offenders(path, text).length > 0,
      `${path} no longer contains a private data-root literal — remove its ` +
        `allowlist entry from ${SELF} (reason was: ${reason})`,
    );
  }
});

Deno.test("positive control: the matcher finds a planted literal", () => {
  // Assembled at runtime so the fixture text is not itself a scannable literal.
  const planted = [
    'const root = "../GRQ-' + 'shareprices2026Q2";',
    "// history lives in ../GRQ-" + "dividends",
  ].join("\n");
  assertEquals(offenders("fixture.ts", planted), [
    "fixture.ts:1: ../GRQ-shareprices2026Q2",
    "fixture.ts:1: GRQ-shareprices2026Q2",
    "fixture.ts:2: ../GRQ-dividends",
    "fixture.ts:2: GRQ-dividends",
  ]);
});

Deno.test("positive control: the walk reaches the tree it claims to scan", async () => {
  const paths = await scannedFiles();
  assert(paths.length > 0, "the directory walk returned no files");
  for (const expected of [SELF, "src/utils.rs", "quality.sh", "deno.json"]) {
    assert(paths.includes(expected), `the walk missed ${expected}`);
  }
});

Deno.test("positive control: scanning without exemptions finds the guard's own patterns", async () => {
  // End-to-end proof that walk + read + match all work: this file's pattern
  // definitions are real literals, so dropping the exemptions must surface them.
  const hits = await scan(await scannedFiles(), { honourExemptions: false });
  assert(
    hits.some((hit) => hit.startsWith(`${SELF}:`)),
    "the scanner found no literal in its own source — walk or matcher broken",
  );
});
