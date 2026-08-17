# Test fixtures

Frozen, deterministic market-data fixtures so regression tests never depend on
live data.

## KLAC split-distortion fixtures (issue #291, parent #272)

These reproduce the split-adjustment distortion behind KLAC's inflated "Capital"
figure. They are consumed by `tests/klac_split_distortion_test.ts` and by the
follow-up `projection.js` helper and backend-guard sub-issues of #272. The
agreed plausibility thresholds live under _Split-reconciliation thresholds_ in
the [root README](../../README.md); the point-in-time #291 investigation is
preserved in `docs/archive/pr-summaries/pr-summary-291.md`. (The parallel
`docs/fixes/` log was pruned in #759.)

All three share the same score/buy date (`2026-03-11`) and a raw buy midpoint of
`(1495.00 + 1454.00) / 2 = 1474.50`.

| Fixture                      | Cumulative split factor                       | Buy price | Current price | Price return |
| ---------------------------- | --------------------------------------------- | --------- | ------------- | ------------ |
| `klac_split_distorted.csv`   | 10 (single 10:1, **current still pre-split**) | 147.45    | 2068.00       | **+1302.5%** |
| `klac_split_reconciled.csv`  | 10 (single 10:1, applied both sides)          | 147.45    | 256.63        | **+74.0%**   |
| `control_clean_no_split.csv` | 1 (no split)                                  | 100.00    | 115.00        | +15.0%       |

- **`klac_split_distorted.csv`** — the buy price is divided by the 10:1 split,
  but the latest market row has NOT been split-adjusted (still ~$2068). The
  mismatch over-divides the buy price relative to the current price and inflates
  the return to the reported ~1302.5%.
- **`klac_split_reconciled.csv`** — the same 10:1 split, now reflected on BOTH
  the buy side and the latest price (~$256). The figure collapses to the correct
  ~+74%, matching the live data after its refresh self-healed.
- **`control_clean_no_split.csv`** — a clean control with no split, so the
  follow-up plausibility guard can prove it does not raise false positives.

The test also injects a duplicate of the 10:1 row in memory to demonstrate the
literal no-de-duplication defect (factor compounds 10 → 100).

## CISS reverse-split fixtures (issue #828)

Frozen extracts of the committed `NASDAQ:CISS` (C3is Inc) market data, consumed
by `tests/ciss_reverse_split_test.ts`. They lock in both sides of the
reverse-split guard after the reported ~-99% loss on the 2026-02-18 score page
was verified as genuine dilution, not a split artefact.

| Fixture                        | Source                             | Splits after the score date     | Cumulative factor | Reliable |
| ------------------------------ | ---------------------------------- | ------------------------------- | ----------------- | -------- |
| `ciss_reverse_split_feb18.csv` | `docs/scores/2026/February/18.csv` | 1-for-7 (2026-04-27)            | 0.1429            | yes      |
| `ciss_reverse_split_jan23.csv` | `docs/scores/2026/January/23.csv`  | 1-for-20 (2026-01-26) + 1-for-7 | 0.00714           | no       |

- **`ciss_reverse_split_feb18.csv`** — the single 1-for-7 event clears every
  threshold (magnitude 7 ≤ the 10:1 cap; observed price ratio 0.140 vs the 0.143
  coefficient; 0.1429 ≥ the 1/50 floor), so the factor is applied: buy midpoint
  1.58995 restates to 11.12965 against a post-split 0.07705, a genuine ~-99.3%
  loss, and CISS is counted normally.
- **`ciss_reverse_split_jan23.csv`** — the extra 1-for-20 event has magnitude 20
  (> the 10:1 cap) and drags the cumulative factor to 0.00714 (< the 1/50
  floor), so the series is flagged unreliable, no factor is applied, and CISS is
  excluded from the stats with strikethrough — the designed issue #293
  behaviour.

## Dividend-basis diagnostic root (issue #805)

`dividend_basis/` is a self-contained, committed stand-in for the two roots
`computeDividendBasisDiagnostic` reads, so the end-to-end test in
`tests/dividend_basis_diagnostic_test.ts` needs neither the private
dividend-history tree nor write permission:

- `dividend_basis/docs/scores/` — a score index with one matured date
  (`2026-01-01`, evaluated at an as-of of `2026-06-01`) plus one still-immature
  date, and that date's `1.tsv` / `1.csv` / `1-dividends.csv`.
- `dividend_basis/dividend-history/` — the `data/<LETTER>/<SYMBOL>.json`
  trailing-history layout the diagnostic expects, for the two tickers scored.

`NYSE:X` pays semi-annually with nothing in the forward window (flat credit
0.25, windowed 0 → **+0.25 pp**); `NYSE:Q` pays quarterly with one realised
in-window dividend (flat 0.25, windowed 0.25 → **0 pp**). Both buy at a midpoint
of 100, so the report's mean difference is **+0.125 pp** over 2 rows.
