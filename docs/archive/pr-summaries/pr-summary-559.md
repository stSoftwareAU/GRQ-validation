# PR Summary — Issue #559

## Summary

Reduced the dashboard's left/right margins on tablet/desktop widths so the
data — score tables and the performance chart — gets more horizontal room.
Closes #559.

Mobile margins were already trimmed by earlier work (#316/#382), but at
tablet/desktop widths the layout still stacked Bootstrap's full insets:
`.container-fluid` (0.75rem each side) + the row/column gutters (0.75rem) +
`.card-body.p-4` (1.5rem). Together these wasted screen width either side of
the data. This change mirrors the existing mobile tightening at
`min-width: 769px` and widens the very-wide-monitor cap:

- New `@media (min-width: 769px)` block in `docs/styles.css`:
  - `.container-fluid` side padding trimmed `0.75rem → 0.5rem`.
  - `.row` gutter trimmed to `-0.375rem`, cancelled by `0.375rem` column
    padding so content stays aligned to the container edge and never overflows.
  - `.card-body.p-4` **horizontal** padding trimmed `1.5rem → 1rem`
    (vertical padding kept for comfortable top/bottom spacing).
- Wide-desktop `.container-fluid` `max-width` widened `1600px → 1800px` so
  genuinely wide monitors reclaim side margin for the data (still centred,
  still capped below the 2000px ceiling).

Only the horizontal margins changed; vertical section spacing is untouched at
desktop widths.

## Evidence

Captured at 1920×1200 via a headless browser against the local `docs/` build.

**Before** — wide left/right margins around the data:

![Before — wide desktop margins](docs/evidence/issue-559-before-margins.png)

**After** — data uses much more of the screen width:

![After — reduced desktop margins](docs/evidence/issue-559-desktop-margins.png)

```mermaid
flowchart LR
    A[screen edge] --> B[.container-fluid<br/>0.75→0.5rem]
    B --> C[.row / .col-12<br/>gutter trimmed]
    C --> D[.card-body.p-4<br/>1.5→1rem horizontal]
    D --> E[data: tables + chart]
```

## Test Plan

TDD — failing tests written first, then the CSS implemented to satisfy them.

- Added `tests/dashboard_desktop_margins_test.ts`:
  - desktop `.container-fluid` side padding trimmed below 0.75rem;
  - desktop `.col-12` wrapper padding cancels the trimmed row gutter (no
    overflow, and the gutter never exceeds the container padding);
  - desktop `.card-body.p-4` horizontal padding reduced below 1.5rem;
  - wide-desktop `max-width` widened beyond 1600px (and ≤ 2000px).
- Updated `tests/dashboard_section_spacing_mobile_test.ts`: the prior test
  asserted *no* non-mobile `.card-body.p-4` rule may exist (desktop unchanged).
  Issue #559 deliberately changes desktop, so the test now allows a desktop
  horizontal-padding trim while still pinning the `padding` shorthand
  (vertical spacing) as mobile-only and forbidding any `.mb-4` retune at
  desktop widths. **Business-logic change documented here as required.**
- Existing `tests/dashboard_horizontal_margins_test.ts` still passes
  (max-width 1800px stays within its ≥1440 / ≤2000 bounds).
- Full Deno suite: 1023 passed, 0 failed. Rust suite and clippy: clean.
