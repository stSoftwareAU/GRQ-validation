/**
 * Tests for path-traversal containment in the static test server.
 *
 * Regression coverage for issue #62: a request path was percent-decoded after
 * URL parsing and joined onto the docs root with no `..` containment check, so
 * `GET /%2e%2e/%2e%2e/etc/passwd` could read files outside `docs/`.
 */

import { assertEquals } from "@std/assert";
import { resolve } from "@std/path";
import { getFilePath } from "../helpers/server.ts";

const DOCS_ROOT = resolve("docs");

// Happy path — ordinary requests resolve to a file inside the docs root.
Deno.test("getFilePath - root maps to index.html inside docs", () => {
  assertEquals(getFilePath("/"), resolve(DOCS_ROOT, "index.html"));
});

Deno.test("getFilePath - explicit index.html stays in docs", () => {
  assertEquals(getFilePath("/index.html"), resolve(DOCS_ROOT, "index.html"));
});

Deno.test("getFilePath - nested asset stays in docs", () => {
  assertEquals(
    getFilePath("/scores/data.json"),
    resolve(DOCS_ROOT, "scores/data.json"),
  );
});

Deno.test("getFilePath - docs/ prefix is stripped to a contained path", () => {
  assertEquals(
    getFilePath("/docs/styles.css"),
    resolve(DOCS_ROOT, "styles.css"),
  );
});

// Error path — percent-encoded traversal must be rejected (the issue trigger).
Deno.test("getFilePath - rejects encoded ../ traversal to /etc/passwd", () => {
  assertEquals(getFilePath("/%2e%2e/%2e%2e/%2e%2e/etc/passwd"), null);
});

Deno.test("getFilePath - rejects literal ../ traversal", () => {
  assertEquals(getFilePath("/../../etc/passwd"), null);
});

Deno.test("getFilePath - rejects traversal hidden behind docs/ prefix", () => {
  assertEquals(getFilePath("/docs/../../etc/passwd"), null);
});

Deno.test("getFilePath - rejects mixed encoded/literal traversal", () => {
  assertEquals(getFilePath("/%2e%2e/../etc/passwd"), null);
});

Deno.test("getFilePath - rejects malformed percent-encoding", () => {
  // A lone "%" makes decodeURIComponent throw; the request must be rejected.
  assertEquals(getFilePath("/%"), null);
});

// Edge case — a filename that merely contains dots is fine.
Deno.test("getFilePath - allows dotted filenames that are not traversal", () => {
  assertEquals(
    getFilePath("/my..file.txt"),
    resolve(DOCS_ROOT, "my..file.txt"),
  );
});
