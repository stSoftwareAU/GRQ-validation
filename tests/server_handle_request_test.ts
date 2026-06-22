/**
 * Behaviour tests for `handleRequest` in the static test server.
 *
 * Coverage gap for issue #267: the exported `handleRequest` carries logic
 * beyond the already-tested path containment (`getFilePath`) — MIME-type
 * mapping, 200/403/404/500 status selection, and cache-control headers — yet
 * had no test. These are WHAT-tests: they pass a `Request` and assert on the
 * observable `Response` (status, headers, body) without inspecting internals.
 */

import { assert, assertEquals } from "@std/assert";
import { handleRequest } from "../helpers/server.ts";

// Happy path — the root path resolves to docs/index.html and is served as HTML.
Deno.test("handleRequest - serves index.html with 200 and html content-type", async () => {
  const res = await handleRequest(new Request("http://x/"));
  await res.body?.cancel();
  assertEquals(res.status, 200);
  assert(
    res.headers.get("content-type")?.includes("text/html"),
    "expected text/html content-type",
  );
});

// MIME mapping — a known extension maps to its configured media type.
Deno.test("handleRequest - maps .json files to application/json", async () => {
  const res = await handleRequest(new Request("http://x/manifest.json"));
  await res.body?.cancel();
  assertEquals(res.status, 200);
  assert(
    res.headers.get("content-type")?.includes("application/json"),
    "expected application/json content-type",
  );
});

// Cache-control — served files must not be cached by clients.
Deno.test("handleRequest - sets no-cache headers on a served file", async () => {
  const res = await handleRequest(new Request("http://x/"));
  await res.body?.cancel();
  assertEquals(
    res.headers.get("cache-control"),
    "no-cache, no-store, must-revalidate",
  );
});

// Error path — a request for a non-existent file returns 404.
Deno.test("handleRequest - returns 404 for a missing file", async () => {
  const res = await handleRequest(new Request("http://x/does-not-exist.js"));
  await res.body?.cancel();
  assertEquals(res.status, 404);
});

// Error path — a directory (not a file) returns 404 rather than 200.
Deno.test("handleRequest - returns 404 for a directory path", async () => {
  const res = await handleRequest(new Request("http://x/scores/"));
  await res.body?.cancel();
  assertEquals(res.status, 404);
});

// Security path — a malformed percent-escape is rejected with 403 before any
// read. (Note: the WHATWG URL parser already collapses `%2e%2e/` dot-segments,
// so the 403 branch is reached via a malformed escape that `getFilePath`
// rejects, not via an encoded `../` sequence.)
Deno.test("handleRequest - returns 403 for a malformed percent-escape", async () => {
  const res = await handleRequest(new Request("http://x/%"));
  await res.body?.cancel();
  assertEquals(res.status, 403);
});
