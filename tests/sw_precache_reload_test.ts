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
// These tests execute the REAL fetchFresh() + precacheStaticAssets() bodies from
// docs/sw.js with mocked globals and assert that every shell asset is fetched
// with `cache: "reload"` (bypassing the HTTP cache).
//
// NOTE — business-logic change (issue #641): the precache is now TIERED. CORE
// assets (the interdependent HTML/JS/CSS shell) are all-or-nothing — a non-ok or
// rejected CORE fetch rejects the whole install so a half-updated shell never
// activates. OPTIONAL assets (icons, manifest, CDN) stay best-effort. Earlier
// revisions of this test treated every asset as best-effort; those cases now
// assert the OPTIONAL-tier semantics, and a new case covers the CORE-tier
// rejection.

import { assertEquals, assertRejects } from "@std/assert";

const swSource = await Deno.readTextFile(
  new URL("../docs/sw.js", import.meta.url),
);

// Extract the real fetchFresh() + precacheStaticAssets() bodies so the test
// exercises shipped code, not a re-implementation.
function precacheSource(): string {
  const fresh = swSource.match(/async function fetchFresh\([\s\S]*?\n\}/);
  const precache = swSource.match(
    /async function precacheStaticAssets\(\)\s*\{[\s\S]*?\n\}/,
  );
  if (!fresh || !precache) {
    throw new Error(
      "Could not locate fetchFresh()/precacheStaticAssets() in docs/sw.js",
    );
  }
  return `${fresh[0]}\n${precache[0]}`;
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
  coreAssets: string[],
  optionalAssets: string[],
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
    "CORE_ASSETS",
    "OPTIONAL_ASSETS",
    "console",
    `${precacheSource()}\nreturn precacheStaticAssets;`,
  );
  const precache = factory(
    caches,
    fetch,
    MockRequest,
    "static-cache",
    coreAssets,
    optionalAssets,
    console,
  ) as () => Promise<void>;

  return { run: () => precache(), fetched, put, warnings };
}

const okResponse = { ok: true, status: 200 };

Deno.test("precache fetches every asset with cache:reload (bypasses HTTP cache)", async () => {
  const core = ["./index.html", "./app.js", "./projection.js"];
  const optional = ["./logo.png"];
  const h = makeHarness(core, optional, () => Promise.resolve(okResponse));
  await h.run();

  assertEquals(h.fetched.length, core.length + optional.length);
  for (const req of h.fetched) {
    assertEquals(
      req.cache,
      "reload",
      `Expected ${req.url} to be fetched with cache:"reload", got ${req.cache}`,
    );
  }
  // Every good response is stored in the versioned cache.
  assertEquals(h.put.length, core.length + optional.length);
  assertEquals(
    h.put.map((p) => p.key).sort(),
    [...core, ...optional].sort(),
  );
});

Deno.test("precache stores the freshly fetched response, not a cache.add() handle", async () => {
  const h = makeHarness(
    ["./projection.js"],
    [],
    () => Promise.resolve(okResponse),
  );
  await h.run();
  assertEquals(h.put.length, 1);
  assertEquals(h.put[0].response, okResponse);
});

Deno.test("a non-ok OPTIONAL asset is skipped (warned), core shell still caches", async () => {
  const core = ["./app.js", "./projection.js"];
  const optional = ["./missing.png"];
  const h = makeHarness(
    core,
    optional,
    (req) =>
      req.url.includes("missing")
        ? Promise.resolve({ ok: false, status: 404 })
        : Promise.resolve(okResponse),
  );
  await h.run();

  // Only the core assets are cached; the 404 optional is skipped, not stored.
  assertEquals(h.put.map((p) => p.key).sort(), ["./app.js", "./projection.js"]);
  assertEquals(h.warnings.length, 1);
});

Deno.test("an OPTIONAL fetch rejection is tolerated and the core shell still caches", async () => {
  const core = ["./app.js", "./projection.js"];
  const optional = ["./offline.png"];
  const h = makeHarness(
    core,
    optional,
    (req) =>
      req.url.includes("offline")
        ? Promise.reject(new Error("network down"))
        : Promise.resolve(okResponse),
  );
  await h.run();

  assertEquals(h.put.map((p) => p.key).sort(), ["./app.js", "./projection.js"]);
  assertEquals(h.warnings.length, 1);
});

Deno.test("a non-ok CORE asset rejects the whole precache and caches NOTHING (issue #641)", async () => {
  // The atomic-core guarantee: a stale/missing projection.js mid-deploy must
  // never be cached alongside a fresh app.js.
  const core = ["./app.js", "./projection.js"];
  const h = makeHarness(
    core,
    [],
    (req) =>
      req.url.includes("projection")
        ? Promise.resolve({ ok: false, status: 404 })
        : Promise.resolve(okResponse),
  );

  await assertRejects(() => h.run());
  assertEquals(
    h.put.length,
    0,
    "no core asset may be cached on an atomic fail",
  );
});
