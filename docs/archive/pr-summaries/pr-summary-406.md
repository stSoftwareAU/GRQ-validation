# Align dashboard totals row to its column headers (10 → 9 cells)

## Summary

The aggregate market view renders **9** column headers but the footer "totals"
row in `updateStockTable` emitted **10** `<td>` cells. The extra leading cell
pushed every portfolio total one column to the right — Portfolio Target landed
under *Current Price* and Average Gain/Loss under *Return above Cost of
Capital*, with a 10th orphan cell having no matching header.

The fix removes the surplus leading `-` cell so the totals row is exactly **9**
cells aligned 1:1 with the 9 headers. Portfolio Target now sits under
**90-Day Target** and Average Gain/Loss under **Gain/Loss (%)**. The existing
Portfolio Target tap-to-view popover (`data-field="portfolio-target"`) is
untouched — only its column position changed. The *Return above Cost of
Capital* totals cell remains `-`; the sibling sub-issue fills it.

Frontend-only change in `docs/app.js` (Deno repo, no Node tooling introduced).

Closes #406.

### Column alignment

| # | Header | Totals cell |
|---|--------|-------------|
| 1 | Stock | `Days Elapsed: N` |
| 2 | Buy Price | `-` |
| 3 | Stars | `-` |
| 4 | 90-Day Target | **Portfolio Target %** |
| 5 | Current Price | `-` |
| 6 | Gain/Loss (%) | **Average Gain/Loss %** |
| 7 | Return above Cost of Capital | `-` |
| 8 | Status/Projection | `-` |
| 9 | Dividends | `-` |

## Evidence

Totals row rendered in the live aggregate view — `Days Elapsed: 86 | - | - |
16.7% | - | 4.0% | - | - | -`. The Portfolio Target (16.7%) aligns under the
90-Day Target price column and the Average Gain/Loss (4.0%) under the
Gain/Loss % column; no orphan trailing cell.

![Totals row aligned to its column headers](docs/evidence/issue-406-totals-row-alignment.png)

## Test Plan

New behavioural test `tests/totals_row_alignment_test.ts` parses the actual
shipped templates from `docs/app.js` (the aggregate-view `thead` and the
`totalsRow`), splits them into top-level cells, and asserts:

- `aggregate totals row has exactly as many cells as headers` — 9 `<th>` == 9
  `<td>`, no orphan cell.
- `Portfolio Target total sits under the 90-Day Target header` — the
  `portfolio-target` cell index equals the 90-Day Target header index.
- `Average Gain/Loss total sits under the Gain/Loss header` — the
  `portfolioPerformance90Day` cell index equals the Gain/Loss header index.
- `Portfolio Target tap-to-view popover is preserved` — the popover trigger
  attributes survive the re-alignment.

The first three tests fail against the unfixed 10-cell row and pass after the
fix (verified by stashing the `docs/app.js` change). Full Deno suite: 633
passed, 0 failed.
