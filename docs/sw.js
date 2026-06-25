// Service Worker for the GRQ Validation Dashboard (issue #223).
//
// Mirrors the GRQ FX Validation Dashboard's service worker, adapted to this
// dashboard's file layout. Versioned caches are aligned with the app-version
// meta in docs/index.html (and docs/version.js). Bump APP_VERSION whenever the
// app version or the SRI-pinned CDN assets below change so the service worker
// re-fetches and re-validates everything.

const APP_VERSION = "1.1.7";
const CACHE_NAME = `grq-validation-v${APP_VERSION}`;
const STATIC_CACHE_NAME = `grq-validation-static-v${APP_VERSION}`;
const DYNAMIC_CACHE_NAME = `grq-validation-dynamic-v${APP_VERSION}`;

// App shell — static dashboard assets precached on install. Enumerated from
// the <head> of docs/index.html so the list stays in sync; bump APP_VERSION
// when the SRI pins below change. Entries that do not yet exist (e.g.
// manifest.json added by a sibling sub-issue) are simply skipped during
// precache rather than failing the whole install.
const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./projection.js",
  "./chart_window_settings.js",
  "./color_key.js",
  "./series_label_colour.js",
  // "Show working" popover field labels (issue #542).
  "./field_label.js",
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
  "./manifest.json",
  "./logo.png",
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
  // SRI-pinned CDN assets from docs/index.html (issue #79).
  // Bump APP_VERSION whenever these pins change so the integrity hashes are
  // re-validated.
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
 * Precache the app shell resiliently: cache each asset individually so a
 * single missing entry (e.g. a manifest.json a sibling sub-issue has not
 * landed yet) does not reject the whole install.
 */
async function precacheStaticAssets() {
  const cache = await caches.open(STATIC_CACHE_NAME);
  await Promise.all(
    STATIC_ASSETS.map(async (asset) => {
      try {
        await cache.add(asset);
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
        console.error("Service Worker: Failed to cache static assets", error);
        // Still skip waiting even if caching fails.
        return self.skipWaiting();
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
    // App shell: cache first with version-based invalidation. Aggressive
    // caching is safe because a version change invalidates every cache.
    event.respondWith(
      caches.match(request)
        .then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }

          return fetch(request)
            .then((response) => {
              if (
                response && response.status === 200 && response.type === "basic"
              ) {
                const responseToCache = response.clone();
                caches.open(STATIC_CACHE_NAME)
                  .then((cache) => {
                    cache.put(request, responseToCache);
                  });
              }
              return response;
            })
            .catch((error) => {
              // No cache and offline: fall back to the dashboard for
              // navigation requests.
              if (request.destination === "document") {
                return caches.match("./index.html");
              }
              throw error;
            });
        }),
    );
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
    // Everything else: cache first with version-based invalidation.
    event.respondWith(
      caches.match(request)
        .then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }

          return fetch(request)
            .then((response) => {
              if (
                response && response.status === 200 && response.type === "basic"
              ) {
                const responseToCache = response.clone();
                caches.open(STATIC_CACHE_NAME)
                  .then((cache) => {
                    cache.put(request, responseToCache);
                  });
              }
              return response;
            });
        }),
    );
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
