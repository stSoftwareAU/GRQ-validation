# PWA: service worker + registration (Issue #223)

## Summary

Adds the service worker and its registration script so the GRQ Validation
Dashboard can work offline as an installable PWA, mirroring
`stSoftwareAU/GRQ-FX-validation` adapted to this dashboard's file layout.
**Closes #223.**

- **`docs/sw.js`** — versioned caches (`grq-validation-v1.0.186`, plus
  `…-static-…` / `…-dynamic-…`) aligned with the `app-version` meta in
  `index.html` / `docs/version.js`; old `grq-validation-*` caches are cleaned
  up on `activate`. Mirrors FX's install/activate/fetch/message structure:
  - **App shell (precache)** — the static dashboard assets (`./`,
    `index.html`, `list.html`, `app.js`, `list.js`, `projection.js`,
    `escape.js`, `version.js`, `dashboard_boot.js`, `list_render.js`,
    `list_stats.js`, `styles.css`, `list.css`, `manifest.json`, `logo.png`,
    `sw-register.js`) plus the SRI-pinned CDN assets enumerated from the
    `<head>` (Bootstrap 5.3.0 CSS, Bootstrap 5.1.3 JS, Chart.js 4.5.1,
    `chartjs-adapter-date-fns` 3.0.0, `chartjs-plugin-annotation` 3.1.0).
    Precaching is resilient (each asset cached individually), so an entry a
    sibling sub-issue has not landed yet (e.g. `manifest.json`) is simply
    skipped rather than failing the whole install.
  - **Cache-on-demand (dynamic)** for per-day score data, matched by
    `URL.pathname` regexes: `/\/scores\/.*\.(csv|tsv)$/`, plus the on-demand
    data JSON (`market-indices.json`, `USDAUD.json`).
  - **Network-first** for the score index `/\/scores\/index\.json$/` — the
    file `docs/list.js` loads to build the date/score list — so the list never
    goes stale while online, falling back to cache when offline.
- **`docs/sw-register.js`** — an **external** (CSP-safe) registration script:
  registers `./sw.js?v=1.0.186`, forces an update check on load, polls
  `registration.update()` every 30s, forces a reload when a new SW activates,
  and handles SW→page messages. External because the CSP uses
  `script-src 'self'` with no `'unsafe-inline'`.

Wiring `sw-register.js` into `index.html` / `list.html` is intentionally **out
of scope** here — it lands with the paired `<head>`-wiring sub-issue. The
unrelated `Cargo.lock` churn that `quality.sh`'s `cargo update` produces was
reverted to keep this PR focused.

## Evidence

No web UI changes ship in this sub-issue (the service worker is not registered
until the `<head>`-wiring sub-issue loads `sw-register.js`), so there is
nothing new to screenshot. Correctness is verified by the new pathname-guard
tests and the full quality gate (`./quality.sh` passes, 346 Deno tests + Rust
suite green).

Caching-strategy decision flow implemented in `docs/sw.js`:

```mermaid
flowchart TD
    A[fetch GET request] --> B{scores/index.json?}
    B -- yes --> N[Network-first<br/>fall back to cache]
    B -- no --> C{scores/*.csv|tsv<br/>or data JSON?}
    C -- yes --> D[Cache-on-demand<br/>network-first, warn header offline]
    C -- no --> E{static shell asset?<br/>.js/.css/.html/.json}
    E -- yes --> F[Cache-first<br/>fall back to ./index.html for docs]
    E -- no --> G[Cache-first]
```

## Test Plan

- Added `tests/sw_pathname_guards_test.ts` (mirrors FX
  `tests/sw-pathname-guards.test.ts`), asserting that `docs/sw.js`:
  - includes the `URL.pathname` regex `/\/scores\/.*\.(csv|tsv)$/` for per-day
    score data;
  - includes the network-first regex `/\/scores\/index\.json$/`;
  - does **not** contain a `./scores/` string literal (which would never match
    `URL.pathname`);
  - excludes data JSON from the generic cache-first `.json` static matcher
    (`endsWith(".json") && !isNetworkFirst && !isDataFile`).
- Full suite: `./quality.sh` passes (Rust + 346 Deno tests, lint, fmt, type
  checks).
