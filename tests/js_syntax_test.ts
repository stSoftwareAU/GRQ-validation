// Tests for genuine JavaScript syntax validation (issue #82).
//
// These assert behaviour of the real `checkJsSyntax` helper that replaced the
// brittle source-grep regexes in scripts/debug/test_page_load.ts.
import { assert, assertEquals } from "@std/assert";
import { checkJsSyntax } from "../helpers/js_syntax.ts";

Deno.test("checkJsSyntax - accepts valid JavaScript", () => {
  const result = checkJsSyntax("const a = 1; function f() { return a; }");
  assertEquals(result.valid, true);
  assertEquals(result.error, undefined);
});

Deno.test("checkJsSyntax - empty source is valid", () => {
  assertEquals(checkJsSyntax("").valid, true);
});

Deno.test("checkJsSyntax - rejects non-adjacent duplicate const", () => {
  // The old regex only caught two `const x` that were textually adjacent. Real
  // duplicates are separated by other statements — the engine rejects them
  // anyway, so this is the case the brittle regex silently passed.
  const source = [
    "const total = 1;",
    "let running = 0;",
    "running += total;",
    "const total = 2;",
  ].join("\n");
  const result = checkJsSyntax(source);
  assertEquals(result.valid, false);
  assert(result.error && result.error.length > 0, "expected an error message");
});

Deno.test("checkJsSyntax - rejects malformed syntax", () => {
  const result = checkJsSyntax("function broken() { return 1;");
  assertEquals(result.valid, false);
});

Deno.test("checkJsSyntax - production docs/app.js parses cleanly", async () => {
  const source = await Deno.readTextFile(
    new URL("../docs/app.js", import.meta.url),
  );
  const result = checkJsSyntax(source);
  assertEquals(result.valid, true, result.error);
});

Deno.test("checkJsSyntax - production docs/theme.js parses cleanly", async () => {
  const source = await Deno.readTextFile(
    new URL("../docs/theme.js", import.meta.url),
  );
  const result = checkJsSyntax(source);
  assertEquals(result.valid, true, result.error);
});

Deno.test("checkJsSyntax - production docs/color_key.js parses cleanly", async () => {
  const source = await Deno.readTextFile(
    new URL("../docs/color_key.js", import.meta.url),
  );
  const result = checkJsSyntax(source);
  assertEquals(result.valid, true, result.error);
});

Deno.test("checkJsSyntax - production docs/series_label_colour.js parses cleanly", async () => {
  const source = await Deno.readTextFile(
    new URL("../docs/series_label_colour.js", import.meta.url),
  );
  const result = checkJsSyntax(source);
  assertEquals(result.valid, true, result.error);
});

Deno.test("checkJsSyntax - production docs/format.js parses cleanly", async () => {
  const source = await Deno.readTextFile(
    new URL("../docs/format.js", import.meta.url),
  );
  const result = checkJsSyntax(source);
  assertEquals(result.valid, true, result.error);
});
