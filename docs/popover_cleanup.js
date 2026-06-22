// Shared popover-cleanup helper for the dashboard (issue #370).
//
// Every `.clickable-value` cell is a Bootstrap popover created with
// `trigger: "manual"` and `container: "body"`, so the visible `.popover` tip
// is appended to `<body>` rather than next to its trigger. When the dashboard
// re-renders a table it replaces the rows with `tbody.innerHTML = ""`, which
// destroys the trigger `<span>` but leaves any open tip orphaned on `<body>`
// — there is no live trigger left to dispose it, so the tip stays on screen
// forever (the "stuck after selecting a stock" bug on mobile).
//
// `clearAllPopovers` makes every re-render / view change start from a clean
// popover state: it hides and disposes every live popover instance, then
// sweeps any stray `.popover` tips left behind on the document. Disposing by
// trigger alone is insufficient because an orphaned tip has no live trigger,
// so the sweep is what actually removes it.
//
// Like the other docs/*.js modules this file is loaded as a classic <script>
// in docs/index.html and imported by the Deno tests. It uses no module syntax
// and is pure (the document and Bootstrap Popover API are injected), so it
// runs in both the browser and the test harness, and publishes its helper on
// `globalThis`.

// Iterate any array-like (NodeList in the browser, Array in tests) safely.
function forEachNode(nodes, fn) {
    if (!nodes) return;
    Array.prototype.forEach.call(nodes, fn);
}

// Hide + dispose every live popover instance and sweep orphaned tips.
//
// - `doc` is a document-like object exposing `querySelectorAll`.
// - `PopoverApi` is the Bootstrap Popover constructor (with `getInstance`).
//
// Returns `{ disposed, swept }` counts so the behaviour is observable in tests.
function clearAllPopovers(doc, PopoverApi) {
    if (!doc || typeof doc.querySelectorAll !== "function") {
        return { disposed: 0, swept: 0 };
    }

    const getInstance =
        PopoverApi && typeof PopoverApi.getInstance === "function"
            ? (el) => PopoverApi.getInstance(el)
            : () => null;

    // 1. Hide then dispose every popover still attached to a live trigger.
    let disposed = 0;
    forEachNode(
        doc.querySelectorAll('[data-bs-toggle="popover"]'),
        (el) => {
            const instance = getInstance(el);
            if (!instance) return;
            if (typeof instance.hide === "function") instance.hide();
            if (typeof instance.dispose === "function") instance.dispose();
            disposed++;
        },
    );

    // 2. Sweep any orphaned tips left on the document (the open-popover case
    //    whose trigger was just destroyed by an innerHTML replacement).
    let swept = 0;
    forEachNode(doc.querySelectorAll(".popover"), (node) => {
        if (typeof node.remove === "function") {
            node.remove();
            swept++;
        }
    });

    return { disposed, swept };
}

// Publish on globalThis so the browser dashboard (classic script) and the Deno
// test importer can both reach the helper.
globalThis.GRQPopovers = {
    clearAllPopovers,
};
