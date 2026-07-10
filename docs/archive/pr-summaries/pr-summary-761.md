## Summary

Defined the **GRQ** acronym on first use in `README.md`. The project's central
name was never expanded — the title "GRQ Validation" and recurring terms ("the
GRQ prediction model", "GRQ training's `volumeRecommend`") assumed the reader
already knew what GRQ meant. The opening paragraph now glosses it in plain
English: **GRQ** (short for *Get Rich Quick*) is the stSoftwareAU
stock-prediction platform whose predictions this repository validates. The
expansion matches the upstream `stSoftwareAU/GRQ` repository description. The
gloss appears only at the first occurrence so the rest of the document reads
cleanly. Closes #761.

## Evidence

Documentation-only change with no web interface to screenshot. Verified via a
Deno test that reads the README and asserts the acronym is expanded in the
opening section (before the first `##` heading), so a first-time reader meets
the definition immediately.

```
README.md defines the GRQ acronym on first use (Issue #761) ... ok
ok | 6 passed | 0 failed
```

Also confirmed `deno fmt`, `deno lint`, and `markdownlint-cli2` pass cleanly on
the changed files.

## Test Plan

- Added `tests/documentation_accuracy_test.ts::README.md defines the GRQ acronym
  on first use (Issue #761)` — reads `README.md`, splits off the opening section
  before the first `##` heading, and asserts it both expands the acronym
  ("Get Rich Quick") and uses the `GRQ` token alongside the gloss. Fails against
  the unfixed README, passes after the fix.
- Ran the full `documentation_accuracy_test.ts` suite: 6 passed, 0 failed.
