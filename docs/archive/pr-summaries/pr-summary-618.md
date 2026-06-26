## Summary

Removed the redundant on-screen "opens in a new tab" hint that sat beneath the
"Confirm on Yahoo Finance" link at the bottom of the single-stock detail view.
The note duplicated the ↗ external-link cue and added visual clutter. The
accessibility affordance is preserved — the link's `aria-label` still announces
"opens in a new tab" to screen reader users. Closes #618.

Changes:
- `docs/app.js` — `getYahooFinanceLinkHtml()` no longer renders the
  `<span class="yahoo-finance-hint">opens in a new tab</span>`; the `aria-label`
  is unchanged.
- `docs/styles.css` — dropped the now-unused `.yahoo-finance-hint` rule and
  updated the surrounding comments.

## Evidence

The `GRQValidator` class in `docs/app.js` instantiates at module load and
touches the DOM, so it cannot be imported under Deno; like the other app.js
display tests it is guarded by reading the published assets. Below is the
rendered single-stock detail view (deep-linked via `?stock=NYSE:DD`), captured
with headless Chrome (Playwright MCP was unavailable in this environment).

Before — visible "opens in a new tab" text beneath the link:

![Before — opens in a new tab text shown](docs/evidence/issue-618-before.png)

After — the redundant text is gone, ↗ cue retained:

![After — opens in a new tab text removed](docs/evidence/issue-618-after.png)

## Test Plan

- Added `tests/yahoo_finance_hint_removed_test.ts`:
  - `app.js no longer renders the visible 'opens in a new tab' hint` — fails
    against the unfixed code, passes after removal.
  - `app.js keeps the accessible aria-label for the new-tab link` — guards the
    retained accessibility affordance.
  - `styles.css drops the now-unused yahoo-finance-hint rule` — guards the CSS
    cleanup.
- Existing `tests/yahoo_finance_link_test.ts` continues to pass (helper logic
  unchanged).
- Full Deno suite: 1209 passed, 0 failed.
