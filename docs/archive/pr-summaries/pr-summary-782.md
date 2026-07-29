# Reword GRQ src path citations in dashboard JS to concept level

## Summary

The dashboard JavaScript served to every visitor cited internal source-file
paths of the **private** upstream `GRQ` repository in code comments —
`docs/projection.js` (3 citations) and `docs/volume_recommend.js` (4 citations,
two with line numbers). Those references point the public at files nobody
outside the private repo can open, and they publish its internal file layout.

Each citation is reworded to concept level (e.g. "training labels the 90-day
return off the intraday LOW at the target date" in place of the
`GRQ/src/LearnUtil.ts` path). No behaviour changes — comments only. Closes #782.

## Evidence

Comment-only change to two shipped JS files; there is nothing visually different
to screenshot. Verified by the new regression tests, which read the shipped
script text (the text IS the artefact under test) and assert both halves of the
fix: the private citations are gone, and the concept-level explanations that
replaced them survive.

Before → after (all seven citations removed):

| File                       | Before                                        | After                                        |
| -------------------------- | --------------------------------------------- | -------------------------------------------- |
| `docs/projection.js:756`   | `GRQ/src/LearnUtil.ts uses market.lowPrice(…)` | "training labels the 90-day return off the intraday LOW at the target date" |
| `docs/projection.js:799`   | `(GRQ/src/CoreFeatures.ts -> GRQ/src/LearnUtil.ts)` | dropped; "the close on the score date" stands alone |
| `docs/projection.js:929`   | `GRQ/src/CoreFeatures.ts builds …; GRQ/src/LearnUtil.ts bakes …` | "training builds the trailing annual dividend total … then bakes a flat `yearOfDividends / 4` …" |
| `docs/volume_recommend.js:5,8` | `(GRQ/src/CoreFeatures.ts)`, `(GRQ/src/LearnUtilTypes.ts)` | "GRQ training's `volumeRecommend` feature", "matching the training-side budget" |
| `docs/volume_recommend.js:22` | `(GRQ/src/LearnUtilTypes.ts:69)`           | "the training-side budget constant, unchanged" |
| `docs/volume_recommend.js:99` | `(GRQ/src/LearnUtil.ts:155)`               | dropped; the ported score-cap expression stands alone |

`./quality.sh` passes cleanly.

## Test Plan

Added `tests/dashboard_private_path_test.ts` (fails against the unfixed
comments, passes after the reword):

- `dashboard JS cites no private GRQ/src source paths` — scans every
  `docs/*.js` for `GRQ/src/…` path citations.
- `dashboard JS names no private upstream source files` — bans the bare private
  source-file names (`LearnUtil.ts`, `LearnUtilTypes.ts`, `CoreFeatures.ts`,
  `ScoreApp.ts`).
- `dashboard JS cites no upstream source line numbers` — bans `<file>.ts:<line>`
  citations.
- `the dashboard JS still documents the ported training semantics` — asserts the
  concept-level explanations survived, so the fix cannot be satisfied by simply
  deleting the comments.

This mirrors the equivalent guard added for `scripts/` under issue #783.
