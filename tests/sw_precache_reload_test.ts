// Service worker precache freshness guard (issue #641).
//
// Regression: the dashboard failed to load with
//   "GRQProjection.calculatePortfolioTargetWorking is not a function"
// because the install-time precache used a plain `cache.add()`, which honours
// the browser HTTP cache. On a version bump GitHub Pages revalidated
// index.html/app.js but let the .js shell files be reused from the HTTP cache,
// so the new versioned cache was populated with a STALE projection.js (missing
// the new helper) while the fresh app.js called it.
//
// These tests execute the REAL precacheStaticAssets() body from docs/sw.js with
// mocked globals and assert that every shell asset is fetched with
// `cache: "reload"` (bypassing the HTTP cache) and that only good responses are
// stored.

import { assertEquals } from "@std/assert";

const swSource = await Deno.readTextFile(
  new URL("../docs/sw.js", import.meta.url),
);

// Extract the real precacheStaticAssets() body so the test exercises shipped
// code, not a re-implementation.
function precacheSource(): string {
  const match = swSource.match(
    /async function precacheStaticAssets\(\)\s*\{[\s\S]*?\n\}/,
  );
  if (!match) {
    throw new Error("Could not locate precacheStaticAssets() in docs/sw.js");
  }
  return match[0];
}

// A minimal Request stand-in capturing the cache mode, so the test runs without
// resolving relative URLs (Deno's real Request rejects "./app.js").
class MockRequest {
  url: string;
  cache: string | undefined;
  constructor(url: string, init: { cache?: string } = {}) {
    this.url = url;
    this.cache = init.cache;
  }
}

interface Harness {
  run: () => Promise<void>;
  fetched: MockRequest[];
  put: Array<{ key: unknown; response: unknown }>;
  warnings: unknown[][];
}

function makeHarness(
  assets: string[],
  fetchImpl: (req: MockRequest) => Promise<unknown>,
): Harness {
  const fetched: MockRequest[] = [];
  const put: Array<{ key: unknown; response: unknown }> = [];
  const warnings: unknown[][] = [];

  const cache = {
    put: (key: unknown, response: unknown) => {
      put.push({ key, response });
      return Promise.resolve();
    },
  };
  const caches = { open: (_name: string) => Promise.resolve(cache) };
  const fetch = (req: MockRequest) => {
    fetched.push(req);
    return fetchImpl(req);
  };
  const console = { warn: (...args: unknown[]) => warnings.push(args) };

  const factory = new Function(
    "caches",
    "fetch",
    "Request",
    "STATIC_CACHE_NAME",
    "STATIC_ASSETS",
    "console",
    `${precacheSource()}\nreturn precacheStaticAssets;`,
  );
  const precache = factory(
    caches,
    fetch,
    MockRequest,
    "static-cache",
    assets,
    console,
  ) as () => Promise<void>;

  return { run: () => precache(), fetched, put, warnings };
}

const okResponse = { ok: true, status: 200 };

Deno.test("precache fetches every asset with cache:reload (bypasses HTTP cache)", async () => {
  const assets = ["./index.html", "./app.js", "./projection.js"];
  const h = makeHarness(assets, () => Promise.resolve(okResponse));
  await h.run();

  assertEquals(h.fetched.length, assets.length);
  for (const req of h.fetched) {
    assertEquals(
      req.cache,
      "reload",
      `Expected ${req.url} to be fetched with cache:"reload", got ${req.cache}`,
    );
  }
  // Each good response is stored in the versioned cache.
  assertEquals(h.put.length, assets.length);
  assertEquals(
    h.put.map((p) => p.key).sort(),
    [...assets].sort(),
  );
});

Deno.test("precache stores the freshly fetched response, not a cache.add() handle", async () => {
  const h = makeHarness(["./projection.js"], () => Promise.resolve(okResponse));
  await h.run();
  assertEquals(h.put.length, 1);
  assertEquals(h.put[0].response, okResponse);
});

Deno.test("precache skips a non-ok response without throwing (no stale bytes cached)", async () => {
  const assets = ["./app.js", "./missing.js"];
  const h = makeHarness(
    assets,
    (req) =>
      req.url.includes("missing")
        ? Promise.resolve({ ok: false, status: 404 })
        : Promise.resolve(okResponse),
  );
  await h.run();

  // Only the good asset is cached; the 404 is skipped, not stored.
  assertEquals(h.put.length, 1);
  assertEquals(h.put[0].key, "./app.js");
  assertEquals(h.warnings.length, 1);
});

Deno.test("precache tolerates a fetch rejection and still caches the rest", async () => {
  const assets = ["./app.js", "./offline.js", "./projection.js"];
  const h = makeHarness(
    assets,
    (req) =>
      req.url.includes("offline")
        ? Promise.reject(new Error("network down"))
        : Promise.resolve(okResponse),
  );
  await h.run();

  assertEquals(h.put.length, 2);
  assertEquals(h.put.map((p) => p.key).sort(), ["./app.js", "./projection.js"]);
  assertEquals(h.warnings.length, 1);
});
