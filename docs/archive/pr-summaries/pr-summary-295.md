# Frontend: rename the "Progress vs Cost of Capital" column and add a definition

## Summary

The one confusing **"Progress vs Cost of Capital"** column is renamed to the
clearer **"Return above Cost of Capital"** and given a short in-UI definition.
This is a **display/labelling change only** — no figures or formulae changed.
Closes #295.

What changed:

- **Renamed the column** consistently across every render site:
  - `docs/index.html` table header (`<th>`).
  - `docs/app.js` single-stock detail card label.
  - `docs/app.js` aggregate-table header (`innerHTML`).
  - both per-row popover `data-bs-title` attributes.
- **Added a short definition** in-UI:
  > Return above the 10% annualised cost-of-capital hurdle, pro-rated by days
  > elapsed. Positive = beating the hurdle.

  surfaced two ways — a header `title` tooltip on the column header, and
  prepended to the existing click-popover working (`data-field="progress-vs-cost"`).
- The label and definition live in two shared constants
  (`RETURN_ABOVE_COST_OF_CAPITAL_LABEL` / `RETURN_ABOVE_COST_OF_CAPITAL_DEFINITION`)
  in `docs/app.js` so the wording stays single-sourced (DRY).
- No stale references to the old header remain in code, tests or docs (the
  chart's separate "Cost of Capital" dataset line is intentionally untouched —
  out of scope per #272 Round 2 Q1).

The underlying figure is unchanged:
`performance − (costOfCapital / 365 × daysElapsed)`.

## Evidence

Aggregate dashboard view with the renamed column (older fully-populated score
file, captured via headless Chrome against a local server):

![Dashboard with renamed column](docs/evidence/issue-295-return-above-cost-of-capital.png)

Close-up of the "Individual Stock Performance" table header showing the new
**Return above Cost of Capital** column:

![Table header close-up](docs/evidence/issue-295-table-closeup.png)

## Test Plan

- Added `tests/return_above_cost_of_capital_label_test.ts` (TDD — written
  failing first, then made to pass). It asserts on the published dashboard
  assets:
  - the new label is present in `docs/index.html` and `docs/app.js`;
  - the in-UI definition + sign convention ("beating the hurdle") are present;
  - **no** stale references to the old `Progress vs Cost of Capital` header
    survive in either file.
- Full Deno suite green: `deno test --allow-read tests/*.ts` → **540 passed, 0 failed**.
- `deno fmt --check`, `deno lint`, `deno check` all clean.

## Note on `./quality.sh` (pre-existing, unrelated failure)

`./quality.sh` currently aborts in its **Rust** stage on a **pre-existing**
compile failure in `src/utils.rs` on the milestone branch (missing
`adjusted_buy_price`; an `if/else` tuple type mismatch). This is **not**
introduced by this PR — the diff here touches only `docs/` and a Deno test and
never goes near `src/`. The breakage came in with the #294 split-adjustment
backend merge on the milestone branch and blocks the Rust portion for **any**
PR targeting this branch. Filed as follow-up **stSoftwareAU/GRQ-validation#326**.
The Deno test suite — the relevant gate for this frontend-only change — passes
green.
