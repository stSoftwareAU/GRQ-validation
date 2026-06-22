# Test fixtures

Frozen, deterministic market-data fixtures so regression tests never depend on
live data.

## KLAC split-distortion fixtures (issue #291, parent #272)

These reproduce the split-adjustment distortion behind KLAC's inflated "Capital"
figure. They are consumed by `tests/klac_split_distortion_test.ts` and by the
follow-up `projection.js` helper and backend-guard sub-issues of #272. The full
analysis and the agreed plausibility thresholds live in
[`docs/fixes/klac-split-distortion-investigation.md`](../../docs/fixes/klac-split-distortion-investigation.md).

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
