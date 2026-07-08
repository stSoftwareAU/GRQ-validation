// Service Worker for the GRQ Validation Dashboard (issue #223).
//
// Mirrors the GRQ FX Validation Dashboard's service worker, adapted to this
// dashboard's file layout. Versioned caches are aligned with the app-version
// meta in docs/index.html (and docs/version.js). Bump APP_VERSION whenever the
// app version or the SRI-pinned CDN assets below change so the service worker
// re-fetches and re-validates everything.

const APP_VERSION = "1.1.59";
const CACHE_NAME = `grq-validation-v${APP_VERSION}`;
const STATIC_CACHE_NAME = `grq-validation-static-v${APP_VERSION}`;
const DYNAMIC_CACHE_NAME = `grq-validation-dynamic-v${APP_VERSION}`;

// Core app shell — the executable HTML/JS/CSS that MUST be cached as ONE atomic
// unit. The dashboard's scripts are interdependent at runtime: app.js calls
// helpers published by projection.js (and the other shared modules), so a
// half-updated shell — a fresh app.js cached next to a stale projection.js —
// throws "GRQProjection.<helper> is not a function" and the page fails to load
// (issue #641). These are precached all-or-nothing. Enumerated from the <head>
// of docs/index.html and docs/trend.html so the list stays in sync.
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./projection.js",
  // Shared low-volume/liquidity helper (issue #576/#577).
  "./volume_recommend.js",
  "./chart_window_settings.js",
  "./color_key.js",
  "./series_label_colour.js",
  // "Show working" popover field labels (issue #542).
  "./field_label.js",
  // Stars popover freshness text (issue #550).
  "./freshness_text.js",
  "./chart_theme.js",
  "./chart_title.js",
  "./format.js",
  "./market_index.js",
  "./escape.js",
  // View deep-link (?view=portfolio|trend) selection helpers (issue #479).
  "./view_selection.js",
  "./popover_cleanup.js",
  // Mobile chart pop-out overlay engine (issue #451).
  "./chart_popout.js",
  "./version.js",
  "./theme.js",
  "./dashboard_boot.js",
  "./styles.css",
  "./sw-register.js",
  // Trend view (issue #430) and the headless engines it reuses (#429/#431/#432).
  "./trend.html",
  "./trend.js",
  "./trend_predictions.js",
  "./trend_series.js",
  "./index_overlay.js",
  "./trend_settings.js",
  // Transient ?group= grouping deep-link for the Trend view (issue #481).
  "./trend_grouping_link.js",
  // Transient ?indices= benchmark-index deep-link for the Trend view (issue #480).
  "./trend_indices_deeplink.js",
];

// Optional extras — precached best-effort. A missing icon/manifest, or a
// momentarily unreachable CDN, must NOT block the core shell from installing
// (all-or-nothing only applies to CORE_ASSETS, which is what keeps app.js and
// projection.js in lock-step). Entries that do not yet exist (e.g. a
// manifest.json a sibling sub-issue has not landed) are simply skipped.
// SRI-pinned CDN assets are re-validated whenever APP_VERSION changes (issue #79).
const OPTIONAL_ASSETS = [
  "./manifest.json",
  "./logo.png",
  "https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css",
  "https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/js/bootstrap.bundle.min.js",
  "https://cdn.jsdelivr.net/npm/chart.js@4.5.1",
  "https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3.0.0/dist/chartjs-adapter-date-fns.bundle.min.js",
  "https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation@3.1.0",
];

// Per-day score data cached on demand. Matched against URL.pathname (not a
// string literal) so the regexes work regardless of the page's base path.
const DYNAMIC_PATTERNS = [
  /\/scores\/.*\.(csv|tsv)$/,
  /\/market-indices\.json$/,
  /\/USDAUD\.json$/,
];

// The score index uses a Network First strategy so the date/score list never
// goes stale while online (docs/list.js fetches scores/index.json).
const NETWORK_FIRST_PATTERNS = [
  /\/scores\/index\.json$/,
];

/**
 * Add diagnostic headers to a response.
 *
 * Note: Response headers are immutable; we must create a new Response.
 */
function withHeaders(response, extraHeaders) {
  const cloned = response.clone();
  const headers = new Headers(cloned.headers);
  for (const [key, value] of Object.entries(extraHeaders)) {
    headers.set(key, value);
  }

  return new Response(cloned.body, {
    status: cloned.status,
    statusText: cloned.statusText,
    headers,
  });
}

/**
 * Fetch a shell asset with the browser HTTP cache bypassed (cache: "reload") so
 * a version bump always pulls FRESH bytes. Issue #641: a plain cache.add()
 * reused a stale projection.js from the HTTP cache while GitHub Pages
 * revalidated index.html/app.js, so the new app.js called
 * GRQProjection.calculatePortfolioTargetWorking — a helper the stale
 * projection.js did not yet define — and the dashboard failed to load. Throws on
 * any non-ok response so callers can decide whether the asset is mandatory.
 */
async function fetchFresh(asset) {
  const response = await fetch(new Request(asset, { cache: "reload" }));
  if (!response || !response.ok) {
    throw new Error(
      `Unexpected response ${response && response.status} for ${asset}`,
    );
  }
  return response;
}

/**
 * Precache the app shell. The CORE shell is all-or-nothing: every core asset is
 * fetched fresh first and stored only if EVERY one succeeded, so the worker
 * never activates a half-updated, internally-inconsistent shell where a fresh
 * app.js sits beside a stale/missing projection.js (issue #641). OPTIONAL extras
 * stay best-effort — a single missing icon/manifest or a momentarily-down CDN
 * must not fail the install or evict the core shell.
 */
async function precacheStaticAssets() {
  const cache = await caches.open(STATIC_CACHE_NAME);

  // Fetch all core assets before storing any: a single failure rejects here and
  // nothing is cached, keeping the precache atomic.
  const coreResponses = await Promise.all(CORE_ASSETS.map(fetchFresh));
  await Promise.all(
    CORE_ASSETS.map((asset, index) => cache.put(asset, coreResponses[index])),
  );

  await Promise.all(
    OPTIONAL_ASSETS.map(async (asset) => {
      try {
        await cache.put(asset, await fetchFresh(asset));
      } catch (error) {
        console.warn("Service Worker: Skipping uncacheable asset", asset, error);
      }
    }),
  );
}

/**
 * Network-first for the score index so the date/score list stays current.
 *
 * If the network fails, fall back to the cached index with a warning header.
 */
/**
 * Cache-first against ONE specific versioned cache. Scoping the lookup to the
 * current cache (rather than caches.match across EVERY cache) means a leftover
 * old-version cache can never serve a stale asset that mismatches the rest of
 * the freshly-activated shell — the mechanism behind the "is not a function"
 * regression where a fresh app.js met an old projection.js (issue #641). On a
 * miss we fetch from the network and populate the current cache; document
 * requests fall back to the cached shell when offline.
 */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }

  try {
    const response = await fetch(request);
    if (response && response.status === 200 && response.type === "basic") {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    if (request.destination === "document") {
      const shell = await cache.match("./index.html");
      if (shell) {
        return shell;
      }
    }
    throw error;
  }
}

async function networkFirstScoreIndex(originalRequest) {
  const request = new Request(originalRequest, { cache: "no-store" });
  const cache = await caches.open(DYNAMIC_CACHE_NAME);

  try {
    const response = await fetch(request);
    if (response && response.status === 200 && response.type === "basic") {
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    console.warn(
      "Service Worker: Network failed for scores index, using cache",
      request.url,
      error,
    );
    const cached = await cache.match(request);
    if (cached) {
      return withHeaders(cached, {
        "X-Served-From-Cache": "true",
        "X-Validation-Warning": "STALE-INDEX",
        "X-Cache-Timestamp": new Date().toISOString(),
      });
    }
    throw error;
  }
}

// Install event - aggressively cache static assets
self.addEventListener("install", (event) => {
  console.log("Service Worker: Installing version", CACHE_NAME);

  event.waitUntil(
    precacheStaticAssets()
      .then(() => {
        console.log("Service Worker: Static assets cached successfully");
        // Force immediate activation to ensure new version takes over.
        return self.skipWaiting();
      })
      .catch((error) => {
        // Core precache failed (e.g. an asset 404'd mid-deploy). Do NOT
        // skipWaiting: re-throw so the install REJECTS, the browser discards
        // this worker and keeps the previous internally-consistent one, then
        // retries on the next update poll once the deploy has propagated
        // (issue #641). Activating a partial shell is what produced the
        // "GRQProjection.<helper> is not a function" regression.
        console.error("Service Worker: Failed to cache static assets", error);
        throw error;
      }),
  );
});

// Activate event - clean up old caches and force version update
self.addEventListener("activate", (event) => {
  console.log("Service Worker: Activating version", CACHE_NAME);

  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            // Delete ALL old GRQ Validation caches to force fresh downloads.
            if (
              cacheName.startsWith("grq-validation-") &&
              cacheName !== CACHE_NAME &&
              cacheName !== STATIC_CACHE_NAME &&
              cacheName !== DYNAMIC_CACHE_NAME
            ) {
              console.log("Service Worker: Deleting old cache", cacheName);
              return caches.delete(cacheName);
            }
          }),
        );
      })
      .then(() => {
        console.log("Service Worker: Old caches deleted, claiming clients");
        // Force claim all clients immediately.
        return self.clients.claim();
      })
      .then(() => {
        // Notify all clients about the update and force reload.
        return self.clients.matchAll();
      })
      .then((clients) => {
        clients.forEach((client) => {
          client.postMessage({
            type: "SW_UPDATED",
            version: CACHE_NAME,
            timestamp: Date.now(),
            forceReload: true,
          });
        });
      }),
  );
});

// Fetch event - cache-first for the app shell, network-first for the score
// index, cache-on-demand for per-day score data.
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests.
  if (request.method !== "GET") {
    return;
  }

  // Skip external requests other than the SRI-pinned CDN.
  if (
    url.origin !== location.origin &&
    !url.hostname.includes("cdn.jsdelivr.net")
  ) {
    return;
  }

  // Per-day score data (CSV/TSV) and on-demand data JSON.
  const isDataFile = DYNAMIC_PATTERNS.some((pattern) =>
    pattern.test(url.pathname)
  );

  // The score index uses Network First.
  const isNetworkFirst = NETWORK_FIRST_PATTERNS.some((pattern) =>
    pattern.test(url.pathname)
  );

  // Static app-shell assets (JS, CSS, HTML, manifest.json, the root).
  const isStaticAsset = url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".css") ||
    url.pathname.endsWith(".html") ||
    url.pathname === "./" ||
    (url.pathname.endsWith(".json") && !isNetworkFirst && !isDataFile);

  if (isStaticAsset) {
    // App shell: cache first, scoped to the CURRENT version's cache only so a
    // leftover old-version cache can never serve a stale, mismatched asset
    // (issue #641). A version change still invalidates every cache.
    event.respondWith(cacheFirst(request, STATIC_CACHE_NAME));
  } else if (isNetworkFirst) {
    // Score index: network first so the date/score list stays current online.
    event.respondWith(
      networkFirstScoreIndex(request),
    );
  } else if (isDataFile) {
    // Per-day score data: network first, falling back to cache with a warning
    // header when offline so the validation banner can flag stale data.
    event.respondWith(
      fetch(new Request(request, { cache: "no-store" }))
        .then((response) => {
          if (
            response && response.status === 200 && response.type === "basic"
          ) {
            const responseToCache = response.clone();
            caches.open(DYNAMIC_CACHE_NAME)
              .then((cache) => {
                cache.put(request, responseToCache);
              });
          }
          return response;
        })
        .catch((_error) => {
          console.warn(
            "Service Worker: Network failed for score data - VALIDATION MAY BE STALE",
            request.url,
          );
          return caches.match(request)
            .then((cachedResponse) => {
              if (cachedResponse) {
                return withHeaders(cachedResponse, {
                  "X-Served-From-Cache": "true",
                  "X-Validation-Warning": "CACHED-DATA",
                  "X-Cache-Timestamp": new Date().toISOString(),
                });
              }
              throw new Error(
                "No network connection and no cached data available. Cannot validate scores.",
              );
            });
        }),
    );
  } else {
    // Everything else: cache first, scoped to the current version's cache so a
    // stale leftover cache can never win over the freshly-activated shell.
    event.respondWith(cacheFirst(request, STATIC_CACHE_NAME));
  }
});

// Background sync (if supported).
self.addEventListener("sync", (event) => {
  console.log("Service Worker: Background sync", event.tag);

  if (event.tag === "background-sync") {
    event.waitUntil(Promise.resolve());
  }
});

// Push notifications (reserved for future use).
self.addEventListener("push", (event) => {
  console.log("Service Worker: Push notification received");

  const options = {
    body: event.data ? event.data.text() : "New validation data available",
    icon: "./icons/icon-192x192.png",
    badge: "./icons/icon-72x72.png",
    vibrate: [100, 50, 100],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 1,
    },
    actions: [
      {
        action: "explore",
        title: "View Dashboard",
        icon: "./icons/icon-96x96.png",
      },
      {
        action: "close",
        title: "Close",
        icon: "./icons/icon-96x96.png",
      },
    ],
  };

  event.waitUntil(
    self.registration.showNotification("GRQ Validation Dashboard", options),
  );
});

// Notification clicks.
self.addEventListener("notificationclick", (event) => {
  console.log("Service Worker: Notification clicked");

  event.notification.close();

  if (event.action === "explore") {
    event.waitUntil(
      clients.openWindow("./"),
    );
  }
});

// Messages from the main thread.
self.addEventListener("message", (event) => {
  console.log("Service Worker: Message received", event.data);

  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }

  if (event.data && event.data.type === "GET_VERSION") {
    event.ports[0].postMessage({ version: CACHE_NAME });
  }

  if (event.data && event.data.type === "FORCE_UPDATE") {
    console.log("Service Worker: Force update requested");
    self.skipWaiting();
    self.clients.matchAll().then((clients) => {
      clients.forEach((client) => {
        client.postMessage({ type: "FORCE_RELOAD" });
      });
    });
  }
});
