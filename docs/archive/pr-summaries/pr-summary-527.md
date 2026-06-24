# Compact 90/180-day chart window labels (issue #527)

## Summary

In portrait mode on an iPhone the chart-window toggle buttons "90 days" and
"180 days" did not quite fit on one line. The buttons now show the number alone
("90" & "180") and the unit "days" is shown **once**, inline beside the group,
so the whole control fits comfortably on a single line. Accessibility is
preserved: each radio keeps its full "90 days" / "180 days" accessible name via
`aria-label`, and the shared "days" unit is decorative (`aria-hidden="true"`) so
screen readers are not told "days" twice.

Closes #527.

### Changes

- `docs/index.html` — button labels reduced to `90` / `180`; added a single
  `<span class="chart-window-unit" aria-hidden="true">days</span>` beside the
  button group; each radio gains `aria-label="90 days"` / `aria-label="180 days"`.
- `docs/styles.css` — added `.chart-window-unit` (nowrap, vertically centred via
  the existing `.chart-window-control` flexbox) so the unit stays inline.

## Evidence

iPhone-portrait render — the toggle reads `90 | 180 days` on one line beside the
Prediction Trend button:

![Chart window toggle in iPhone portrait](docs/evidence/issue-527-portrait-controls.png)

Full portrait dashboard showing the control fits on a single line:

![Dashboard in iPhone portrait](docs/evidence/issue-527-portrait-full.png)

## Test Plan

- Added `tests/chart_window_unit_label_test.ts`:
  - button labels read `90` / `180` with no `days` suffix;
  - the `days` unit appears exactly once and reads "days";
  - each radio keeps its full `aria-label` accessible name;
  - the shared unit is `aria-hidden`;
  - `styles.css` styles `.chart-window-unit`.
- Existing `tests/chart_window_toggle_test.ts` and
  `tests/chart_controls_heading_row_test.ts` continue to pass (values, ids,
  default selection, accessible group name, control placement unchanged).
- Full Deno suite: `deno test --allow-read tests/*.ts` → all pass.
