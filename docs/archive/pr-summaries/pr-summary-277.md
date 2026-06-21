# Centre dashboard section titles on one line and use the full width (Issue #277)

## Summary

Dashboard section/card titles (e.g. "Market Performance Comparison",
"Individual Stock Performance", and the dynamic stock-detail header) were
left-aligned and wasted the available horizontal width. This change adds a
`.card-header .card-title` rule in `docs/styles.css` that centres the title and
makes it span the full container width. A desktop-only `@media (min-width:
768px)` rule keeps each title on a single line (no awkward wrap), while
narrow/mobile widths retain the default wrapping so titles stay readable — no
responsive regression. No markup changes were needed; the existing
`h5.card-title` headings pick up the new rule. Closes #277.

## Evidence

Captured with headless Chromium against a local server rendering the exact
`card-header`/`card-title` markup from `docs/index.html` and the live
`docs/styles.css`.

Desktop (1280px) — titles centred on one line, full width:

![Desktop section titles centred on one line](docs/evidence/issue-277-desktop.png)

Narrow width (~500px) — titles centred, still single line and readable, no
horizontal overflow:

![Narrow-width section titles centred](docs/evidence/issue-277-narrow.png)

Computed-style probe at sub-768px confirmed `white-space: normal` (wrapping
enabled) so the desktop single-line rule does not leak into mobile.

## Test Plan

Added `tests/section_title_centring_test.ts` (following the existing
`chart_color_key_test.ts` CSS-rule pattern) which asserts on `docs/styles.css`:

- `.card-header .card-title` is centred (`text-align: center`).
- `.card-header .card-title` uses the full width (`width: 100%`).
- the `@media (min-width: 768px)` block sets `white-space: nowrap` (single line
  at desktop widths).
- the base rule does **not** force `nowrap`, so titles wrap on mobile.
- `docs/index.html` section headings still carry the `h5.card-title` hook.

All 5 new tests pass; the full Deno suite (458 tests) and `./quality.sh` pass.
