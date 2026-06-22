# Mobile: flatten dashboard card chrome

## Summary

On phones the dashboard section cards drew Bootstrap's default chrome — a 1px
border, 0.375rem rounded corners, and the outer wrapper's `shadow-sm` drop
shadow — which boxed the figures and tables in and wasted edge space. This
change adds mobile-only (`@media (max-width: 768px)`) CSS to `docs/styles.css`
so the section cards render flat (no border, square corners) and the outer drop
shadow is dropped, giving data more room. Card-header titles ("Market
Performance Comparison", "Individual Stock Performance") and all figures/table
data are untouched, and desktop/tablet (≥768px) rendering is unchanged.

Part of milestone #307. Frontend CSS only, mobile-only. Closes #317.

The new rules live in the existing "Mobile-friendly cards"
`@media (max-width: 768px)` block:

```css
.card {
  border: none;
  border-radius: 0;
}

.shadow-sm {
  box-shadow: none !important; /* overrides Bootstrap's .shadow-sm utility */
}
```

## Evidence

Mobile viewport (390px wide), before vs after. The section cards lose their
rounded corners, border and drop shadow so they read closer to edge-to-edge:

| Before | After |
| --- | --- |
| ![Mobile dashboard before flattening card chrome](docs/evidence/issue-317-mobile-before.png) | ![Mobile dashboard after flattening card chrome](docs/evidence/issue-317-mobile-after.png) |

## Test Plan

Added `tests/dashboard_card_chrome_mobile_test.ts` (TDD — written failing
first, following the same CSS-rule-body assertion approach as
`dashboard_section_spacing_mobile_test.ts`):

- `mobile .card border-radius is flattened to 0` — corners read flat.
- `mobile .card border is removed or softened` — `border: none`.
- `mobile .shadow-sm drop shadow is removed` — `box-shadow: none !important`.
- `card chrome overrides are confined to the mobile block` — no non-mobile
  `.shadow-sm` rule, so desktop/tablet is unchanged.
- `index.html: card-header titles and section markup remain intact` — titles
  and section ids preserved.

All Deno tests pass (`deno test --allow-read tests/*.ts`) and `./quality.sh`
passes cleanly.
