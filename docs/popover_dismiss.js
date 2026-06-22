// Consolidated dismissal logic for the dashboard's value popovers (issue #371,
// part of the mobile info-popover milestone #335).
//
// Previously docs/app.js carried TWO competing global `document` click handlers
// with overlapping logic. Both closed popovers by iterating the live triggers
// (.clickable-value / [data-bs-toggle="popover"]) and calling hide() only when
// the trigger still had `aria-describedby`. An ORPHANED tip — a `.popover` node
// left on <body> after a re-render disposed its trigger — has no live trigger,
// so neither handler could reach it and "tap outside to close" silently failed.
//
// This module holds the single source of truth for that behaviour:
//   - decidePopoverAction() decides what an outside/inside tap should do; and
//   - closeAllPopovers() hides every live instance AND removes any leftover
//     `.popover` nodes, so orphaned tips are dismissed too.
//
// It mirrors docs/escape.js, docs/projection.js and docs/color_key.js: loaded
// as a classic <script> in docs/index.html (no module syntax), publishing its
// helpers on `globalThis` so both the browser dashboard (via `GRQValidator`)
// and the Deno tests exercise the exact same code.

// CSS selector for every popover trigger. Both clauses describe the same value
// cells, but we keep the explicit pair so a future trigger that drops the
// `.clickable-value` class is still matched on its `data-bs-toggle`.
const POPOVER_TRIGGER_SELECTOR = '.clickable-value, [data-bs-toggle="popover"]';

// CSS selector for a rendered Bootstrap popover tip in the DOM.
const POPOVER_TIP_SELECTOR = ".popover";

// Decide what a click should do, given whether it landed inside an open
// popover's content and whether it landed on a popover trigger.
//   - inside popover content -> "ignore" (must NOT close; criterion 3)
//   - on a trigger           -> "closeAndReopen" (close others, show this one)
//   - anywhere else outside   -> "closeOnly" (close every popover)
function decidePopoverAction({ insidePopover, hasTrigger }) {
    if (insidePopover) {
        return "ignore";
    }
    if (hasTrigger) {
        return "closeAndReopen";
    }
    return "closeOnly";
}

// Close every value popover, reliably.
//
// First hides every live Bootstrap instance found on a trigger — NOT gated on
// `aria-describedby`, so a stale instance is still told to hide. Then removes
// any `.popover` node still attached to the document: these are orphaned tips
// whose trigger was disposed by a re-render, which `hide()` can never reach.
//
// Dependency-injected for testability:
//   doc         - a document-like object exposing querySelectorAll(selector);
//   getInstance - (element) => Bootstrap popover instance | null.
// Returns { hidden, removed } counts so callers (and tests) can assert on the
// work done.
function closeAllPopovers(doc, getInstance) {
    let hidden = 0;
    let removed = 0;

    const triggers = doc.querySelectorAll(POPOVER_TRIGGER_SELECTOR);
    triggers.forEach((element) => {
        const instance = getInstance(element);
        if (instance && typeof instance.hide === "function") {
            instance.hide();
            hidden += 1;
        }
    });

    // Anything still in the DOM after hiding live instances is an orphan.
    const tips = doc.querySelectorAll(POPOVER_TIP_SELECTOR);
    tips.forEach((node) => {
        if (node && typeof node.remove === "function") {
            node.remove();
            removed += 1;
        }
    });

    return { hidden, removed };
}

globalThis.GRQPopover = {
    POPOVER_TRIGGER_SELECTOR,
    POPOVER_TIP_SELECTOR,
    decidePopoverAction,
    closeAllPopovers,
};
