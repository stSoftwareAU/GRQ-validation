## Summary

Added shareable deep-link URLs to the GRQ Validation dashboard so a specific
score date and (optionally) a specific stock can be opened from a single URL.
The existing `?file=...` parameter is retained; a new `?date=YYYY-MM-DD`
parameter resolves against `scores/index.json`, and a new `?stock=SYMBOL`
parameter auto-selects an individual stock's detail view. A **🔗 Share Link**
button copies the canonical URL for the current view to the clipboard.

Closes #11.

## Evidence

This is a small client-side change to the static dashboard (`docs/`). Behaviour
is verified by targeted Deno tests covering the pure URL helpers — the same
parse/build/resolve functions are inlined into `docs/app.js` and used by the
controller.

```mermaid
sequenceDiagram
    participant U as User
    participant B as Browser
    participant App as GRQValidator
    participant Idx as scores/index.json

    U->>B: Open /?date=2025-02-14&stock=SCHW
    B->>App: loadIndex()
    App->>Idx: fetch scores
    App->>App: parseShareParams(location.search)
    App->>App: resolveScoreByParams({date, stock}, scores)
    App->>App: selectedFile = match.file; selectedStock = "SCHW"
    App->>App: loadScoreFile() then updateShareUrl()
    App-->>B: history.replaceState → ?file=…&stock=SCHW
    U->>B: Click 🔗 Share Link
    App->>B: navigator.clipboard.writeText(location.href)
```

Playwright MCP was not available in this run, so no screenshot is attached.
The UI change is a single Bootstrap button added next to the existing
"View All Score Files" link.

## Test Plan

- Added `tests/share_url_test.ts` with 14 cases covering:
  - `parseShareParams` — empty, `file`, `date`, `stock`, combined.
  - `buildShareSearch` — empty, file-only, file + stock, null/empty drop.
  - `resolveScoreByParams` — match by file, fallback to date, no match,
    empty inputs.
  - Round-trip parse → build → parse preserves state.
- All 14 new tests pass: `deno test --allow-read tests/share_url_test.ts`.
- `cargo check --all-targets --all-features` passes; no Rust changes.
- Pre-existing failures in `tests/schw_projection_test.ts` (R-squared
  regression numbers) are unrelated to this change and were verified to fail
  on the unmodified branch as well.
