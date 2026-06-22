# Mobile: shrink the dashboard header banner

## Summary

On phones the gradient header banner (`div.card-header.header-gradient … py-4`)
consumed a large slice of the first screen before any data appeared — Bootstrap's
`py-4` gives 1.5rem top/bottom padding, with a full-size `h1.display-4` title
(~3.5rem) and a `p.lead` subtitle (~1.25rem).

This change adds **mobile-only, frontend CSS** to the existing
`@media (max-width: 768px)` block in `docs/styles.css` to de-emphasise the
banner's vertical footprint:

- `.card-header.header-gradient` padding reduced to `0.75rem` top/bottom
  (`!important` to override Bootstrap's `py-4` utility).
- `.header-gradient .display-4` title font-size reduced to `1.75rem`.
- `.header-gradient .lead` subtitle font-size reduced to `0.95rem`.

The title text "GRQ Validation Dashboard", the subtitle, the theme-toggle button
and the gradient are all retained — only the size shrinks. No markup changed; the
banner still carries its `header-gradient`/`py-4` classes. Desktop/tablet
(≥768px) rendering is untouched: every override lives inside the mobile media
block and the base `.header-gradient` rule sets no sizing.

Closes #315.

## Evidence

Mobile render at 390×844 (Chromium headless). The banner is compact — title,
subtitle and theme toggle remain present and legible. (The "Failed to load"
notice is expected: `fetch` is blocked under the `file://` origin used for the
screenshot, unrelated to this change.)

![Shrunk mobile header banner](docs/evidence/issue-315-banner-mobile.png)

## Test Plan

Added `tests/header_banner_mobile_test.ts` (pure-CSS assertions, same approach as
`section_title_centring_test.ts`):

- mobile banner padding is below the `py-4` 1.5rem default and uses `!important`;
- mobile `.display-4` title font-size is smaller than the desktop default;
- mobile `.lead` subtitle font-size is smaller than the desktop default;
- desktop/tablet sizing is left untouched (no base `font-size`, no banner
  override in the `(min-width: 768px)` block);
- `index.html` still contains the title, subtitle and theme-toggle markup.

All 561 Deno tests pass; `deno fmt`, `deno lint` and `deno check` are clean.
