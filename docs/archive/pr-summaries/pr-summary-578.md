# [#578] Fold low volume into the valuation/scoring of predictions

## Summary

Beyond **excluding** low-volume names from aggregates (#577), low volume is now
folded into the **valuation** of each prediction, so an illiquid name can never
score as a strong recommendation — satisfying the "never recommend such names"
requirement from #563. This mirrors the upstream training, where the score is capped via
`Math.min(core.volumeRecommend, priceRecommend, 1)` (the upstream training code).

The dashboard's displayed prediction Score is now passed through a
volume-cap: `score = min(volumeRecommend, baseScore, 1)`. A flagged low-volume
name (`volumeRecommend === -1`) is forced to a never-recommend value regardless
of its price-based score; partial illiquidity proportionally down-weights; and
unknown volume (pre-volume-column CSVs) leaves the score unchanged
(`insufficient data ⇒ not flagged`), matching the exclusion path. The cap
reuses the #576 shared helper as the single source of truth — **no new
threshold**. **Closes #578.**

### What changed

- **`docs/volume_recommend.js`** — add `volumeCappedScore(baseScore, window)`,
  the ported upstream cap, published on `globalThis.GRQVolume`. Returns `baseScore`
  unchanged when it is non-finite or when volume is unknown
  (`volumeRecommend === null`); otherwise `Math.min(volumeRecommend, baseScore, 1)`.
- **`docs/app.js`** — add `volumeCappedScore(symbol, baseScore, scoreDate)` over
  the trailing 10-weekday window (reusing `buildTrailingVolumeWindow`), and
  render the **capped** score plus a **Low volume — not recommended** badge on
  the stock detail card. Falls back to the raw score when no market data is
  loaded.
- **`README.md`** — document the low-volume valuation cap.
- **`tests/volume_recommend_test.ts`** — new unit + fixture tests.

This is complementary to #577 (exclusion vs. valuation are distinct effects
against the same shared helper). As with #577, the effect is a **no-op on the
current committed data** (CSVs do not yet carry the volume column from #575); it
activates automatically once 8-column CSVs carry volume.

## Evidence

This is a frontend valuation/display change. Playwright MCP and a local browser
were unavailable in this environment, and the badge only renders once CSVs carry
volume (a no-op on live data today, as with #577). The shipped helper's exact
display behaviour is reproduced below by driving the real
`docs/volume_recommend.js` over synthetic market series (illiquid, liquid, and
unknown-volume), reproducing the `docs/app.js` detail-card Score cell branch:

```text
ILLIQUID:   raw score 0.970 -> displayed -1.000 [Low volume — not recommended]
LIQUID:     raw score 0.970 -> displayed 0.970
UNKNOWNVOL: raw score 0.970 -> displayed 0.970
```

An illiquid name with a strong `0.970` price-based score is suppressed to the
never-recommend value `-1.000` and badged; an equally-strong liquid name is
unchanged; and an unknown-volume name (pre-volume CSV) is left untouched.

### Valuation flow

```mermaid
flowchart LR
    A[Prediction score<br/>price-based] --> C{volumeRecommend<br/>trailing 10wd window}
    C -- "null (unknown)" --> D[score unchanged]
    C -- "-1 (low volume)" --> E[min(-1, score, 1) = -1<br/>never recommended]
    C -- "(0,1] partial" --> F[min(recommend, score, 1)<br/>down-weighted]
    D --> G[Displayed Score]
    E --> G
    F --> G
```

## Test Plan

All tests exercise the real shipped `docs/volume_recommend.js`:

- `tests/volume_recommend_test.ts`:
  - `volumeCappedScore is published on GRQVolume`
  - `volumeCappedScore: low-volume name suppresses a high price-based score`
  - `volumeCappedScore: liquid name keeps its price-based score unchanged`
  - `volumeCappedScore: partial illiquidity down-weights proportionally`
  - `volumeCappedScore: never exceeds 1, even for an out-of-range score`
  - `volumeCappedScore: unknown volume leaves the score unchanged (not flagged)`
  - `volumeCappedScore: empty / non-array window leaves the score unchanged`
  - `volumeCappedScore: non-finite base score is returned unchanged`
  - `volumeCappedScore: numeric-string base score is coerced and capped`
  - `fixture: illiquid name's high score is suppressed, liquid name unchanged`
    (the acceptance-criterion fixture: series → trailing window → capped score)

Full suite: `deno test --allow-read tests/*.ts` → **1152 passed, 0 failed**.
