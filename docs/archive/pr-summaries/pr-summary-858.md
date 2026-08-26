# Hide the stock table Stars column on narrow screens

## Summary

On a phone the dashboard stock table's Stars cell — a leading freshness icon
plus up to five moon glyphs — wrapped that run into a vertical stack, making
every row several lines tall. Closes #858.

The fix, scoped to the main stock table:

- **Never wrap.** `.stock-table .stars-column { white-space: nowrap; }` keeps
  the freshness icon and the moons on one line at every width.
- **Hidden below the mobile breakpoint.** Inside `@media (max-width: 767.98px)`
  — the cut-off the stylesheet and `isMobileDevice()` already use — the whole
  column is `display: none`, header **and** cells, rather than clipped or
  shrunk. No information is lost: the full rating, freshness icon included,
  still renders in the stock detail view, whose own wrapping was fixed in #383.
- **Keyed by class, not position.** The new `stars-column` marker is on the
  Stars `<th>` in `docs/index.html`, on the Stars `<th>` and `<td>` in the
  aggregate templates in `docs/app.js`, and on the totals-row placeholder. The
  column sits at a different index in each header layout and the basic
  no-market-data view has none, so a positional rule would hit the wrong cell.
- **Totals stay aligned.** The totals row is a third template. Its Stars
  placeholder carries the same class, so it disappears with the column — without
  it the totals row is one cell wider than the visible header and every
  portfolio total shifts a column left (visible in the first "after" capture I
  took, and now pinned by a test).

Glyph-dropping (the freshness icon yielding before the moons) was deliberately
**not** implemented: the column is hidden on phones and scrolls horizontally
inside `.table-responsive` at wider widths, so nothing ever needs dropping.

### Documented change to an existing test

`tests/stock_table_responsive_layout_test.ts` asserted that **no** stock-table
column may be hidden on a phone (issue #842). That assertion was narrowed, not
removed: Stars is now the one documented exception — the rationale is in the
test, in the commit, and in the README section it pins. The same test was
strengthened while there, and now catches two things it previously missed:
class-keyed hiding (it only looked at `:nth-child` selectors) and decimal
breakpoints (its media-query regex matched `768px` but not `767.98px`), so any
**other** hidden column still fails it.

## Evidence

Captured with the container's headless Chromium against a local static server
(`python3 -m http.server` over `docs/`), at a 390px-wide phone viewport. The
Playwright MCP browser tools are not present in this run — `ToolSearch` for
`browser_navigate` / `browser_take_screenshot` returned
`No matching deferred tools found` — so the same headless Chromium the MCP
server drives (`/opt/playwright-browsers/chromium-1224/chrome-linux/chrome`) was
invoked directly.

Before — the Stars cells wrap into three-line stacks and stretch every row:

![Stock table on a 390px viewport before the fix](docs/evidence/issue-858-stars-wrapping-before.png)

After — the Stars column is gone, rows are single-line, and the reclaimed width
brings the Gain/Loss column on screen without scrolling:

![Stock table on a 390px viewport after the fix](docs/evidence/issue-858-stars-hidden-after.png)

At desktop width nothing changes — the Stars column is present and its glyph run
sits on one line:

![Stock table at 1280px, Stars column intact](docs/evidence/issue-858-stars-desktop.png)

## Test Plan

New — `tests/stock_table_stars_column_test.ts` (parses the real committed
stylesheet and the real markup/templates):

- `the Stars cell never wraps its glyphs` — a `white-space: nowrap` rule reaches
  the Stars cell, and applies outside any media query.
- `the Stars column is hidden below the phone breakpoint` — both the `<th>` and
  the `<td>` are hidden, at `max-width: 767.98px`, and never unconditionally.
- `no rule hides the Stars column on a wide screen`.
- `the static Stars header carries the marker class and scope` — the marker did
  not cost the column its `scope="col"`.
- `the header and the cell hide together in the aggregate view` — the Stars
  `<td>` carries the class at the same column index as its `<th>`, so header and
  cells can never be hidden apart.
- `the totals row drops its Stars cell with the column` — exactly one totals
  cell is marked, at the Stars index, with the row still one cell per header.
- `selectorReaches: matches the cell it is written for` — the test's own
  selector matcher.

Modified — `tests/stock_table_responsive_layout_test.ts`: the hidden-column
assertion narrowed to exempt Stars and widened to catch class-keyed hiding and
decimal breakpoints (see above). No test was removed or disabled.

Verified failing first: running the new test file against the `origin/main`
copies of `docs/styles.css`, `docs/index.html` and `docs/app.js` gives **5
failed, 2 passed**; against this branch all 7 pass.

Full suite: `deno test --allow-read --allow-env tests/*.ts` → **1639 passed, 2
failed**. Both failures are the pre-existing data-presence gate on `main`
(`docs/scores/2026/July/27.csv` is missing — the same gate failure as #847),
unrelated to this UI change: no file under `docs/scores/` is touched here.
