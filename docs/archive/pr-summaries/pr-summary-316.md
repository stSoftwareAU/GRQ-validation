## Summary

Tighten the dashboard's section/card spacing on mobile (≤768px) so data gets
more room on phones. Part of milestone #307. **Mobile-only, frontend CSS only.**
Closes #316.

All edits live inside the existing `@media (max-width: 768px)` spacing block in
`docs/styles.css`:

- **`.mb-4` / `.mb-3`** dropped from Bootstrap's own defaults (1.5rem / 1rem,
  which tightened nothing) to **0.75rem / 0.5rem**, shrinking the gaps between
  the stacked controls, chart, market-comparison and table cards.
- **`.card-body.p-4`** now has a mobile rule (**1rem `!important`**). Previously
  the outer body kept Bootstrap's `p-4` 1.5rem padding because the `!important`
  utility overrode the plain `.card-body { padding: 1rem }` mobile rule; the
  more-specific `.card-body.p-4` selector wins and reduces the body padding.
- **`.row` / column gutters** tightened from 0.5rem to **0.375rem**.

Desktop/tablet (≥768px) rendering is unchanged — nothing outside the mobile
media block was touched, and card `border` / `box-shadow` / `border-radius` and
the header banner were left alone (handled in sibling sub-issues). No labels,
figures or table columns were removed.

## Evidence

Mobile render (390px wide) of the same score file, captured with headless
Chrome at an identical 2400px viewport height. The tighter gaps and reduced
body padding let more of the stock table fit on screen.

Before:

![Mobile dashboard before tightening](docs/evidence/issue-316-mobile-before.png)

After:

![Mobile dashboard after tightening](docs/evidence/issue-316-mobile-after.png)

## Test Plan

Added `tests/dashboard_section_spacing_mobile_test.ts` (6 tests, all passing),
which read `docs/styles.css` / `docs/index.html` and assert:

- mobile `.mb-4` margin-bottom < 1.5rem (with `!important`);
- mobile `.mb-3` margin-bottom < 1rem (with `!important`);
- mobile `.card-body.p-4` padding < 1.5rem (with `!important`);
- mobile `.row` gutter tighter than the prior −0.5rem;
- the `.card-body.p-4` override is confined to the mobile block (desktop
  unchanged);
- `index.html` keeps the outer `card-body p-4` markup and the controls, chart
  and market-comparison sections.

Full suite green: `deno test --allow-read tests/*.ts` → 567 passed, plus
`deno fmt` / `deno lint` / `deno check` clean.
