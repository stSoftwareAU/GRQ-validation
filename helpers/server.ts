#!/usr/bin/env -S deno run --allow-net --allow-read
/**
 * Test Server for GRQ Validation Dashboard
 *
 * Starts a local HTTP server that serves static files
 * from the `docs` folder for testing.
 *
 * Usage:
 *   deno run --allow-net --allow-read tests/start-test-server.js [port]
 * Default port is 8000 if not specified.
 */

import { isAbsolute, join, relative, resolve } from "@std/path";

const DEFAULT_PORT = 8000;
const DOCS_DIR = "docs";
// Resolve the docs root once so every request can be checked for containment.
const DOCS_ROOT = resolve(DOCS_DIR);
const port = parseInt(Deno.args[0] ?? "") || DEFAULT_PORT;
// Bind to loopback only — this is a local test server, not a public host.
const HOSTNAME = "127.0.0.1";
const DEBUG = true;

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".txt": "text/plain",
  ".xml": "application/xml",
  ".pdf": "application/pdf",
};

function getMimeType(filename: string) {
  const ext = filename.substring(filename.lastIndexOf(".")).toLowerCase();
  return MIME_TYPES[ext] ?? "application/octet-stream";
}

/**
 * Resolve a request path to an absolute file path inside {@link DOCS_ROOT}.
 *
 * Returns `null` when the request is malformed or would escape the docs root,
 * so the caller can respond with a 403 instead of serving an arbitrary file.
 */
export function getFilePath(url: string): string | null {
  // Decode exactly once. A malformed escape (e.g. a lone "%") throws — reject it.
  let path: string;
  try {
    path = decodeURIComponent(url.substring(1));
  } catch {
    if (DEBUG) console.log(`🚫 Rejected malformed URL: "${url}"`);
    return null;
  }

  if (DEBUG) {
    console.log(`🔍 Requested URL: "${url}"`);
    console.log(`📂 Decoded path: "${path}"`);
  }

  if (path === "" || path === "/") path = "index.html";
  else if (path === "docs" || path === "docs/") path = "index.html";
  else if (path === "index.html") path = "index.html";
  else if (path.startsWith("docs/")) {
    path = path.substring(5) || "index.html";
  }

  // Reject any decoded path that still contains a parent-directory segment.
  if (path.split(/[/\\]/).some((segment) => segment === "..")) {
    if (DEBUG) console.log(`🚫 Rejected traversal segment in: "${path}"`);
    return null;
  }

  const fullPath = resolve(join(DOCS_ROOT, path));

  // Defence in depth: confirm the resolved path stays within the docs root.
  const rel = relative(DOCS_ROOT, fullPath);
  if (
    rel === ".." || rel.startsWith(`..${"/"}`) || rel.startsWith("..\\") ||
    isAbsolute(rel)
  ) {
    if (DEBUG) console.log(`🚫 Rejected out-of-root path: "${fullPath}"`);
    return null;
  }

  if (DEBUG) console.log(`🎯 Final file path: "${fullPath}"`);

  return fullPath;
}

export async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const filePath = getFilePath(url.pathname);

  if (DEBUG) {
    console.log(
      `\n📥 ${new Date().toISOString()} - ${request.method} ${url.pathname}`,
    );
  }

  if (filePath === null) {
    if (DEBUG) console.log(`⛔ 403 - Forbidden: ${url.pathname}`);
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const fileInfo = await Deno.stat(filePath);

    if (fileInfo.isFile) {
      const fileContent = await Deno.readFile(filePath);
      const mimeType = getMimeType(filePath);

      if (DEBUG) console.log(`✅ 200 - Served: ${filePath} (${mimeType})`);

      return new Response(fileContent, {
        status: 200,
        headers: {
          "Content-Type": mimeType,
          "Cache-Control": "no-cache, no-store, must-revalidate",
          "Pragma": "no-cache",
          "Expires": "0",
        },
      });
    }

    if (DEBUG) console.log(`❌ 404 - Not a file: ${filePath}`);
    return new Response("Not Found", { status: 404 });
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      if (DEBUG) {
        console.log(`❌ 404 - File not found: ${filePath}`);
        console.log(`   Error: ${error.message}`);
      }
      return new Response("File Not Found", { status: 404 });
    }

    if (DEBUG) {
      console.log(`❌ 500 - Server error: ${filePath}`);
      console.log(`   Error: ${(error as Error).message}`);
    }
    return new Response("Internal Server Error", { status: 500 });
  }
}

if (import.meta.main) {
  console.log(`🚀 Starting test server on http://${HOSTNAME}:${port}`);
  console.log(`📁 Serving files from: ${DOCS_DIR}`);
  console.log(`🌐 Available URLs:`);
  console.log(`   • http://${HOSTNAME}:${port}/ (main dashboard)`);
  console.log(`   • http://${HOSTNAME}:${port}/docs/ (same as root)`);
  console.log(`   • http://${HOSTNAME}:${port}/index.html (explicit index)`);
  console.log(`   • http://${HOSTNAME}:${port}/scores/ (data files)`);
  console.log(`⏹️  Press Ctrl+C to stop the server`);
  console.log(`🔍 Debug logging is ${DEBUG ? "ENABLED" : "DISABLED"}`);
  console.log("");

  // new native API (no external import required)
  Deno.serve({ port, hostname: HOSTNAME }, handleRequest);
}
