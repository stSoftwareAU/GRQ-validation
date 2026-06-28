// Service-worker app-shell consistency guards (issue #641).
//
// Australian English. Reproduces the "GRQProjection.calculatePortfolioTargetWorking
// is not a function" regression: the dashboard failed to load because the
// service worker served a fresh app.js next to a stale/missing projection.js —
// an internally-inconsistent app shell. These tests execute the REAL docs/sw.js
// install + fetch handlers against mocked Cache Storage / fetch and assert on
// behaviour (not source text):
//
//   1. Core precache is atomic — if a core asset fails to fetch mid-deploy the
//      install REJECTS and caches nothing, so a half-updated shell (new app.js,
//      old projection.js) can never activate.
//   2. Optional extras (icons, manifest, CDN) stay best-effort — a single
//      missing one must not block the core shell.
//   3. The fetch handler serves app-shell assets ONLY from the current
//      version's cache, so a leftover old-version cache can never serve a stale
//      projection.js alongside a fresh app.js.

import { assert, assertEquals, assertRejects } from "@std/assert";

const swSource = await Deno.readTextFile(
  new URL("../docs/sw.js", import.meta.url),
);
const APP_VERSION = swSource.match(/const APP_VERSION = "([^"]+)";/)?.[1] ?? "";
const STATIC_CACHE_NAME = `grq-validation-static-v${APP_VERSION}`;

const ORIGIN = "https://grq.test";

// A minimal Response stand-in: only the fields docs/sw.js inspects (`ok`,
// `status`, `type`). The body is tagged so a test can tell a network response
// apart from a stale cached one.
function makeResponse(body: string, status = 200) {
  return {
    body,
    status,
    ok: status >= 200 && status < 300,
    type: "basic",
    clone() {
      return makeResponse(body, status);
    },
  };
}

// A minimal Request stand-in capturing the cache mode, so the precache's
// `new Request(asset, { cache: "reload" })` works without resolving relative
// URLs (Deno's real Request rejects "./app.js").
class MockRequest {
  url: string;
  cache: string | undefined;
  destination: string | undefined;
  constructor(
    input: string | { url: string; destination?: string },
    init: { cache?: string } = {},
  ) {
    if (typeof input === "string") {
      this.url = input;
    } else {
      this.url = input.url;
      this.destination = input.destination;
    }
    this.cache = init.cache;
  }
}

// Mock fetch: 200 by default; URLs in `fail` resolve to a 404 (so fetchFresh
// rejects, mirroring the spec). The body is tagged "network:<url>" so a test
// can prove a response came from the network, not a stale cache.
function makeFetch(fail: Set<string>) {
  return (input: unknown) => {
    const url = typeof input === "string"
      ? input
      : (input as { url: string }).url;
    if (fail.has(url)) {
      return Promise.resolve(makeResponse(`network:${url}`, 404));
    }
    return Promise.resolve(makeResponse(`network:${url}`, 200));
  };
}

class MockCache {
  store = new Map<string, ReturnType<typeof makeResponse>>();

  private key(req: unknown): string {
    return typeof req === "string" ? req : (req as { url: string }).url;
  }

  put(req: unknown, res: ReturnType<typeof makeResponse>) {
    this.store.set(this.key(req), res);
    return Promise.resolve();
  }

  match(req: unknown) {
    return Promise.resolve(this.store.get(this.key(req)));
  }
}

class MockCaches {
  caches = new Map<string, MockCache>();

  open(name: string) {
    if (!this.caches.has(name)) {
      this.caches.set(name, new MockCache());
    }
    return Promise.resolve(this.caches.get(name)!);
  }

  keys() {
    return Promise.resolve([...this.caches.keys()]);
  }

  delete(name: string) {
    return Promise.resolve(this.caches.delete(name));
  }

  // The legacy, unscoped lookup: searches EVERY cache. Retained so a regressed
  // sw.js that still calls caches.match would visibly serve stale assets.
  async match(req: unknown) {
    for (const cache of this.caches.values()) {
      const hit = await cache.match(req);
      if (hit) return hit;
    }
    return undefined;
  }
}

function loadServiceWorker(fail: Set<string> = new Set()) {
  const fetchImpl = makeFetch(fail);
  const caches = new MockCaches();
  const listeners: Record<string, (event: unknown) => void> = {};
  let skipWaitingCalls = 0;
  const self = {
    addEventListener: (type: string, handler: (event: unknown) => void) => {
      listeners[type] = handler;
    },
    skipWaiting: () => {
      skipWaitingCalls++;
      return Promise.resolve();
    },
    clients: {
      claim: () => Promise.resolve(),
      matchAll: () => Promise.resolve([]),
    },
  };
  const location = { origin: ORIGIN };

  const factory = new Function(
    "self",
    "caches",
    "fetch",
    "location",
    "Request",
    `"use strict";\n${swSource}`,
  );
  factory(self, caches, fetchImpl, location, MockRequest);

  return {
    caches,
    listeners,
    skipWaitingCalls: () => skipWaitingCalls,
  };
}

function runInstall(
  sw: ReturnType<typeof loadServiceWorker>,
): Promise<unknown> {
  let waited: Promise<unknown> = Promise.resolve();
  sw.listeners.install({
    waitUntil: (p: Promise<unknown>) => {
      waited = p;
    },
  });
  return waited;
}

function runFetch(
  sw: ReturnType<typeof loadServiceWorker>,
  request: { method: string; url: string; destination?: string },
): Promise<ReturnType<typeof makeResponse>> {
  let responded: Promise<ReturnType<typeof makeResponse>> = Promise.resolve(
    makeResponse("", 0),
  );
  sw.listeners.fetch({
    request,
    respondWith: (p: Promise<ReturnType<typeof makeResponse>>) => {
      responded = p;
    },
  });
  return responded;
}

Deno.test("install precaches the core shell (app.js + projection.js together)", async () => {
  const sw = loadServiceWorker();
  await runInstall(sw);

  const cache = await sw.caches.open(STATIC_CACHE_NAME);
  assert(await cache.match("./app.js"), "app.js should be precached");
  assert(
    await cache.match("./projection.js"),
    "projection.js should be precached",
  );
  assertEquals(sw.skipWaitingCalls(), 1, "a successful install skips waiting");
});

Deno.test("a failed core asset rejects the install and caches NOTHING (issue #641)", async () => {
  // projection.js momentarily 404s during a CDN deploy. The shell must NOT be
  // half-cached: app.js must not be stored without projection.js, and the
  // worker must not activate (no skipWaiting).
  const sw = loadServiceWorker(new Set(["./projection.js"]));

  await assertRejects(
    () => runInstall(sw) as Promise<unknown>,
    Error,
    undefined,
    "install must reject when a core asset fails to precache",
  );

  const cache = await sw.caches.open(STATIC_CACHE_NAME);
  assertEquals(
    await cache.match("./app.js"),
    undefined,
    "no core asset may be cached when the atomic precache fails",
  );
  assertEquals(
    sw.skipWaitingCalls(),
    0,
    "a partial shell must never skipWaiting / activate",
  );
});

Deno.test("a failed OPTIONAL asset still installs the core shell", async () => {
  // A missing icon / manifest / momentarily-down CDN must not block the shell.
  const sw = loadServiceWorker(
    new Set([
      "./manifest.json",
      "https://cdn.jsdelivr.net/npm/chart.js@4.5.1",
    ]),
  );

  await runInstall(sw); // resolves

  const cache = await sw.caches.open(STATIC_CACHE_NAME);
  assert(await cache.match("./app.js"), "core app.js still cached");
  assert(
    await cache.match("./projection.js"),
    "core projection.js still cached",
  );
  assertEquals(sw.skipWaitingCalls(), 1);
});

Deno.test("fetch serves shell assets only from the current cache, never a stale one (issue #641)", async () => {
  const sw = loadServiceWorker();

  // A leftover old-version cache still holds a STALE projection.js, and the
  // current cache holds a fresh app.js but is (for this test) missing
  // projection.js. The unscoped caches.match() bug would serve the stale copy.
  const oldCache = await sw.caches.open("grq-validation-static-v0.0.1");
  await oldCache.put(
    `${ORIGIN}/projection.js`,
    makeResponse("stale-projection", 200),
  );
  const currentCache = await sw.caches.open(STATIC_CACHE_NAME);
  await currentCache.put(`${ORIGIN}/app.js`, makeResponse("fresh-app", 200));

  const response = await runFetch(sw, {
    method: "GET",
    url: `${ORIGIN}/projection.js`,
    destination: "script",
  });

  assert(
    response.body.startsWith("network:"),
    `expected a fresh network projection.js, got "${response.body}"`,
  );
  assert(
    !response.body.includes("stale"),
    "the stale old-cache projection.js must never be served",
  );
});
