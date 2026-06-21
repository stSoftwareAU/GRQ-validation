# Remove the "View All Score Files" button from the dashboard

## Summary

The dashboard (`docs/index.html`) showed a **📊 View All Score Files** button
that linked to the separate `list.html` page. It was redundant — the **Score
File** dropdown already selects any single file — and it rendered awkwardly on
mobile. This change removes the button column from the controls row, leaving
only the Score File dropdown (unchanged). No empty/leftover Bootstrap column
remains. Part of #241. Closes #251.

Out of scope (tracked in sibling sub-issues of #241): deleting `docs/list.html`
and its assets, and the service-worker precache cleanup.

## Evidence

Desktop and mobile renders confirm the button is gone and the Score File
dropdown still works (a file is selected and the chart loads on both widths).

![Dashboard desktop after removal](docs/evidence/issue-251-dashboard-desktop.png)

![Dashboard mobile after removal](docs/evidence/issue-251-dashboard-mobile.png)

Verification:

- `grep -n 'list.html' docs/index.html` returns nothing.
- No `View All Score Files` text remains in `docs/index.html`.
- `#scoreFileSelect` dropdown markup is unchanged.

## Test Plan

- Added `tests/dashboard_controls_test.ts` (TDD — written failing first):
  - `dashboard - no list.html link remains`
  - `dashboard - no 'View All Score Files' button remains`
  - `dashboard - Score File dropdown is preserved`
- All Deno tests pass: `deno test --allow-read tests/*.ts` → 456 passed.
- `deno fmt`, `deno lint`, and `deno check` all clean.
- The `pa11y` accessibility check runs in CI (not installed locally); this
  change removes a link/button and touches no meta / CSP / SRI / PWA markup,
  so the existing `docs/index.html` and accessibility checks remain valid.
