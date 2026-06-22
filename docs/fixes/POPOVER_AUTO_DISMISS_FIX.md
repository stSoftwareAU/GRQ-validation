# Auto-dismiss value popovers on every re-render (issue #370)

## Symptom

On a ~375px mobile viewport, opening a value popover (e.g. tapping
**Portfolio Target**) and then **selecting a single stock** left the popover
stuck on screen with no way to close it. The same applied to other view
changes (switching score file, basic ↔ market view, back-to-aggregate).

## Root cause

Every `.clickable-value` popover is created with `trigger: "manual"` and
`container: "body"`, so the visible `.popover` tip is appended to `<body>`
rather than next to its trigger. A re-render replaces the table with
`tbody.innerHTML = ""`, destroying the trigger `<span>`. The orphaned tip
already living on `<body>` survives, and the old dispose loop iterated only the
*current* `.clickable-value` triggers — so it never disposed the now-orphaned
instance and the tip stayed visible forever.

## Fix

A shared, pure helper `clearAllPopovers(document, bootstrap.Popover)` in
`docs/popover_cleanup.js` (published as `globalThis.GRQPopovers`):

1. Hides **then** disposes every live popover instance attached to a trigger.
2. Sweeps any stray `.popover` tips off the document
   (`querySelectorAll('.popover').forEach((n) => n.remove())`) — the orphaned
   tip has no live trigger, so disposing by trigger alone cannot remove it.

It is invoked at the start of both `updateStockTable()` and
`updateBasicStockTable()` (before `tbody.innerHTML = ""`), and it replaces the
previous trigger-only dispose loop in `updateStockTable()`. Because every
view change / re-render routes through `updateDisplay()` → one of those two
table methods, all of them now start from a clean popover state.

```mermaid
flowchart TD
    A[View change / re-render] --> B[updateDisplay]
    B --> C[updateStockTable / updateBasicStockTable]
    C --> D[clearAllPopovers: hide + dispose + sweep tips]
    D --> E[tbody.innerHTML = ''  rebuild rows]
    E --> F[Recreate popover instances]
    F --> G[document.querySelectorAll('.popover').length === 0]
```

## Verification

Automated: `tests/popover_cleanup_test.ts` imports the real shipped helper and
asserts the orphaned-tip case is swept, live instances are hidden before
disposal, and `document.querySelectorAll('.popover').length === 0` after a
mixed open+orphan state.

Manual (at ~375px, Bootstrap `Mobile: true`, `Width: 375px`):

1. Open any value popover (Portfolio Target, Stars, Target, Gain/Loss, …).
2. Select a single stock → the popover is gone (no orphaned tip on `<body>`).
3. Repeat for switching score files, basic ↔ market view and
   back-to-aggregate → no popover survives any of these.
4. In devtools, `document.querySelectorAll('.popover').length === 0`.
