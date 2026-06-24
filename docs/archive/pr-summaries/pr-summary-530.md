## Summary

The dashboard control for picking a prediction was labelled **"Score File"**, an
internal implementation detail that outside viewers do not understand. This PR
renames the user-facing label (and the dropdown placeholder) to **"Prediction
Date"** while leaving the underlying `#scoreFileSelect` control id, deep-link
behaviour and data flow untouched. Closes #530.

Changes:

- `docs/index.html` — label `Score File:` → `Prediction Date:`, placeholder
  `Select a score file...` → `Select a prediction date...`.
- `docs/app.js` — the dynamically-rebuilt placeholder option matches the new
  `Select a prediction date...` wording.
- `docs/README.md` — usage step renamed to **Select Prediction Date**.

## Evidence

![Dashboard showing the "Prediction Date:" label](docs/evidence/issue-530-prediction-date-label.png)

The label above the dropdown now reads "Prediction Date:" instead of "Score
File:". The control id, options and chart are unchanged.

## Test Plan

- `tests/dashboard_controls_test.ts` — added regression test
  *"dashboard - control is labelled 'Prediction Date', not 'Score File'"*
  asserting the new label and placeholder are present and the old
  `Score File:` / `Select a score file...` strings are gone, while the
  `#scoreFileSelect` dropdown is preserved.
- `tests/header_chrome_compact_mobile_test.ts` — updated the existing banner
  assertion to expect the `Prediction Date:` label (business-logic change to
  the visible text; the `for="scoreFileSelect"` association is still verified).
- Full Deno suite: `deno test --allow-read tests/*.ts` → 973 passed, 0 failed.
