// Mobile chart pop-out overlay engine (issue #451, the core of the full-screen
// landscape pop-out milestone #446).
//
// On a phone the single performance chart is cramped. This module pops the live
// #performanceChart canvas out into a full-viewport overlay and restores it on
// close. There is exactly ONE Chart.js instance on the page, so rather than
// building a second chart we RE-PARENT the existing canvas into the overlay on
// open and back into its `.chart-container` on close, calling Chart.js
// resize()/update() after each move so the chart fits its new box. (True OS
// element-fullscreen is unsupported for non-video elements on iOS Safari, so a
// CSS overlay is the path.)
//
// Desktop is untouched: the expand trigger is CSS-hidden at >=768px, so the
// overlay can never be opened there.
//
// It mirrors docs/escape.js, docs/color_key.js and docs/popover_dismiss.js:
// loaded as a classic <script> in docs/index.html (no module syntax), and
// publishing its helpers on `globalThis.GRQChartPopout` so the browser
// dashboard and the Deno tests exercise the exact same code. The open/close
// core is dependency-injected — it only touches classList / hidden /
// appendChild / focus / setAttribute — so it runs headless under a fake DOM.

// Body class applied while the overlay is open. The sibling sub-issues (#452
// landscape, #453 chrome) build against this and the `#chartPopout` id, so it
// is a stable part of the contract — do not rename without updating them.
const BODY_OPEN_CLASS = "chart-popout-open";

// Element ids in docs/index.html the wiring resolves.
const OVERLAY_ID = "chartPopout";
const OVERLAY_BODY_ID = "chartPopoutBody";
const EXPAND_ID = "chartPopoutExpand";
const CLOSE_ID = "chartPopoutClose";
const CANVAS_ID = "performanceChart";

// True while the chart pop-out overlay owns the canvas, detected from the body
// contract class set on open (issue #453). The dashboard's viewport sync
// consults this to stay idle while the pop-out is open: the device class has
// NOT actually changed, so rebuilding the chart/summary or flipping the native
// legend then would be a spurious rebuild and would leave the dashboard's mobile
// colour key stale when the canvas returns on close. `doc` is injectable so the
// Deno tests drive it headless.
function isPopoutOpen(doc) {
    const d = doc || globalThis.document;
    return !!(
        d && d.body && d.body.classList &&
        typeof d.body.classList.contains === "function" &&
        d.body.classList.contains(BODY_OPEN_CLASS)
    );
}

// Resize-and-update the live chart, guarded so a missing/half-built chart (no
// data loaded yet) is a silent no-op rather than a throw. Chart.js needs both:
// resize() recomputes the canvas box for its new parent, update() repaints.
function resizeChart(getChart) {
    if (typeof getChart !== "function") return;
    let chart = null;
    try {
        chart = getChart();
    } catch (_e) {
        chart = null;
    }
    if (!chart) return;
    if (typeof chart.resize === "function") chart.resize();
    if (typeof chart.update === "function") chart.update();
}

// --- Landscape presentation (issue #452) -------------------------------------
//
// Inside the pop-out a wide chart is hard to read on a portrait phone. The
// robust baseline is a CSS rotation (see docs/styles.css) that needs no JS at
// all. The optional progressive enhancement asks the platform to rotate the
// device for us via the Screen Orientation API; iOS Safari exposes
// `screen.orientation` but NOT `.lock()`, so every helper degrades silently and
// the CSS fallback is always the safety net. These functions are pure with
// respect to their injected `screen` / `viewport`, so the Deno tests drive them
// headless.

// True when the device is held portrait (taller than wide). `viewport` is the
// window-like object carrying innerWidth/innerHeight.
function isPortraitViewport(viewport) {
    if (!viewport) return false;
    const w = Number(viewport.innerWidth);
    const h = Number(viewport.innerHeight);
    if (!isFinite(w) || !isFinite(h)) return false;
    return h > w;
}

// Capability gate for the optional orientation lock. iOS Safari fails this, so
// the CSS fallback carries those devices.
function supportsOrientationLock(screen) {
    return !!(screen && screen.orientation &&
        typeof screen.orientation.lock === "function");
}

// Pure decision: how should the popped-out chart be presented in landscape?
//   - "orientation-lock": the platform can rotate the device for us.
//   - "css-rotate": no lock (e.g. iOS) and the phone is held portrait, so the
//     CSS fallback rotates the chart to use the long edge.
//   - "native": already landscape, the chart fills the viewport as-is.
function chooseLandscapePresentation({ portrait, lockSupported } = {}) {
    if (!portrait) return "native";
    return lockSupported ? "orientation-lock" : "css-rotate";
}

// Attempt to lock to landscape, swallowing the inevitable rejection where the
// API exists but the platform refuses (so the CSS fallback still applies).
// Returns the branch taken so callers/tests can assert it.
function requestLandscapeLock(screen) {
    if (!supportsOrientationLock(screen)) return "unsupported";
    try {
        const result = screen.orientation.lock("landscape");
        if (result && typeof result.catch === "function") {
            result.catch(() => {});
        }
        return "requested";
    } catch (_e) {
        return "unsupported";
    }
}

// Release any landscape lock on close. Silent no-op when unsupported.
function releaseOrientationLock(screen) {
    if (
        !screen || !screen.orientation ||
        typeof screen.orientation.unlock !== "function"
    ) {
        return false;
    }
    try {
        screen.orientation.unlock();
        return true;
    } catch (_e) {
        return false;
    }
}

// Open the overlay. Pure with respect to its `ctx` — it mutates only the
// injected elements and ctx state, returning true when it actually opened
// (false if it was already open or the required elements are missing).
//
// `ctx` carries: { doc, overlay, overlayBody, chartContainer, canvas, trigger,
// closeButton, getChart, isOpen, previousFocus }.
function openPopout(ctx) {
    if (!ctx || ctx.isOpen) return false;
    const { doc, overlay, overlayBody, canvas, trigger, closeButton } = ctx;
    if (!overlay || !overlayBody || !canvas) return false;

    // Remember where focus was so we can restore it on close (accessibility).
    ctx.previousFocus = (doc && doc.activeElement) || trigger || null;

    // Re-parent the single live canvas into the overlay.
    overlayBody.appendChild(canvas);

    // Reveal the overlay and lock the background from scrolling underneath.
    overlay.hidden = false;
    if (typeof overlay.setAttribute === "function") {
        overlay.setAttribute("aria-hidden", "false");
    }
    if (doc && doc.body && doc.body.classList) {
        doc.body.classList.add(BODY_OPEN_CLASS);
    }

    ctx.isOpen = true;

    // Move focus into the overlay so keyboard/AT users land on the close
    // control rather than being stranded behind the now-inert background.
    if (closeButton && typeof closeButton.focus === "function") {
        closeButton.focus();
    }

    // Fit the chart to its new full-viewport box.
    resizeChart(ctx.getChart);
    return true;
}

// Close the overlay, reversing openPopout. Returns true when it actually closed.
function closePopout(ctx) {
    if (!ctx || !ctx.isOpen) return false;
    const { doc, overlay, chartContainer, canvas, trigger } = ctx;

    // Restore the canvas to its original dashboard container.
    if (chartContainer && canvas) {
        chartContainer.appendChild(canvas);
    }

    overlay.hidden = true;
    if (typeof overlay.setAttribute === "function") {
        overlay.setAttribute("aria-hidden", "true");
    }
    if (doc && doc.body && doc.body.classList) {
        doc.body.classList.remove(BODY_OPEN_CLASS);
    }

    ctx.isOpen = false;

    // Restore focus to wherever it was (the expand trigger), so the user is
    // returned to the control they invoked.
    const focusTarget = ctx.previousFocus || trigger || null;
    if (focusTarget && typeof focusTarget.focus === "function") {
        focusTarget.focus();
    }
    ctx.previousFocus = null;

    // Resize the chart back to the inline dashboard box.
    resizeChart(ctx.getChart);
    return true;
}

// Open if closed, close if open. Returns whatever the delegated call returns.
function togglePopout(ctx) {
    return ctx && ctx.isOpen ? closePopout(ctx) : openPopout(ctx);
}

// --- ?fullscreen=1 boot parameter (issue #482) -------------------------------
//
// A transient `?fullscreen=1` URL parameter opens the mobile pop-out on page
// load. It mirrors `?theme=` (docs/theme.js): read ONCE on load (one-way),
// visit-only (never persisted to localStorage). It is mobile-only — desktop is
// a hard no-op because the expand control is CSS-hidden there and desktop has
// ample chart space. These helpers are pure (no DOM) so the Deno tests drive
// them headless.

// True only when the query string carries exactly `fullscreen=1`. Any other
// value ("0", "true", "2", absent) is false, and a malformed search degrades to
// false rather than throwing.
function fullscreenRequested(search) {
    try {
        return new URLSearchParams(search || "").get("fullscreen") === "1";
    } catch (_e) {
        return false;
    }
}

// Pure boot decision: should the pop-out auto-open on load? Every gate must
// pass — the URL asked for it (`?fullscreen=1`), we are on mobile, a pop-out
// controller exists with an open() method, and it is not already open. Desktop
// (isMobile false) always returns false, satisfying the "no-op on desktop"
// contract without ever touching the DOM.
function shouldOpenFullscreen({ search, isMobile, popout } = {}) {
    if (!fullscreenRequested(search)) return false;
    if (!isMobile) return false;
    if (!popout || typeof popout.open !== "function") return false;
    if (typeof popout.isOpen === "function" && popout.isOpen()) return false;
    return true;
}

// Open the mobile pop-out on load when the `?fullscreen=1` gates pass. Delegates
// the decision to shouldOpenFullscreen() and, when it passes, calls the
// controller's open(). Returns true only when it actually opened; degrades to a
// silent no-op when the controller is absent or any gate fails (e.g. desktop).
function openFullscreenOnLoad(opts) {
    if (!shouldOpenFullscreen(opts)) return false;
    return opts.popout.open() === true;
}

// Wire the live dashboard: resolve the overlay/trigger elements, build the
// open/close context, and attach the event listeners that drive the lifecycle —
// tap-to-expand, ✕ to close, Esc to close, and the device back-gesture (a
// history entry is pushed on open so a back navigation pops the overlay rather
// than leaving the page). Returns a small controller, or null when the required
// elements are absent (e.g. a page without the chart).
function createChartPopout(options) {
    const opts = options || {};
    const doc = opts.document || globalThis.document;
    // The Screen Orientation API surface and the window-like viewport drive the
    // optional landscape lock (issue #452); both are injectable for tests.
    const screen = opts.screen || globalThis.screen;
    const viewport = opts.viewport || globalThis;
    const getChart = typeof opts.getChart === "function"
        ? opts.getChart
        : () => null;
    // Reconciliation hook run once the canvas is back in the dashboard on close
    // (issue #453). The app passes its viewport sync here so the mobile colour
    // key + native legend are restored to match the real current device class —
    // reusing renderColorKey()/syncChartForViewport() rather than duplicating
    // that logic. Optional: a page without it just closes with no reconcile.
    const onClose = typeof opts.onClose === "function" ? opts.onClose : null;
    if (!doc || typeof doc.getElementById !== "function") return null;

    const overlay = doc.getElementById(OVERLAY_ID);
    const overlayBody = doc.getElementById(OVERLAY_BODY_ID);
    const trigger = doc.getElementById(EXPAND_ID);
    const closeButton = doc.getElementById(CLOSE_ID);
    const canvas = doc.getElementById(CANVAS_ID);
    if (!overlay || !overlayBody || !trigger || !closeButton || !canvas) {
        return null;
    }

    const ctx = {
        doc,
        overlay,
        overlayBody,
        // The canvas's original parent (.chart-container) is where it returns.
        chartContainer: canvas.parentNode || canvas.parentElement || null,
        canvas,
        trigger,
        closeButton,
        getChart,
        isOpen: false,
        previousFocus: null,
    };

    // Track whether we pushed a history entry, so the manual close paths
    // (✕ / Esc) consume it via history.back() — which fires popstate and closes
    // once — instead of leaving a dangling entry. The back-gesture path closes
    // directly from popstate.
    let pushedHistory = false;
    const history = globalThis.history;

    function open() {
        const opened = openPopout(ctx);
        if (opened && history && typeof history.pushState === "function") {
            try {
                history.pushState({ grqChartPopout: true }, "");
                pushedHistory = true;
            } catch (_e) {
                pushedHistory = false;
            }
        }
        // Optional landscape enhancement: only attempt the lock when the device
        // is portrait AND the platform supports it; the CSS fallback covers the
        // rest (issue #452). The lock itself silently no-ops where refused.
        if (opened) {
            const presentation = chooseLandscapePresentation({
                portrait: isPortraitViewport(viewport),
                lockSupported: supportsOrientationLock(screen),
            });
            if (presentation === "orientation-lock") {
                requestLandscapeLock(screen);
            }
        }
        return opened;
    }

    // Close the overlay and release any orientation lock taken on open.
    function finishClose() {
        const closed = closePopout(ctx);
        if (closed) {
            releaseOrientationLock(screen);
            // Reconcile the dashboard now the canvas is restored: the colour key
            // and native legend are re-synced to the real current viewport so
            // they match their pre-pop-out state (issue #453). Guarded so a hook
            // that throws never leaves the overlay half-closed.
            if (onClose) {
                try {
                    onClose();
                } catch (_e) {
                    // Reconciliation is best-effort; the close itself succeeded.
                }
            }
        }
        return closed;
    }

    // Close requested by ✕ or Esc: unwind the pushed history entry so the back
    // stack stays clean; the resulting popstate performs the actual close.
    function requestClose() {
        if (!ctx.isOpen) return false;
        if (pushedHistory && history && typeof history.back === "function") {
            pushedHistory = false;
            history.back();
            return true;
        }
        return finishClose();
    }

    function onKeydown(event) {
        const key = event && (event.key || event.keyCode);
        if (ctx.isOpen && (key === "Escape" || key === "Esc" || key === 27)) {
            if (event && typeof event.preventDefault === "function") {
                event.preventDefault();
            }
            requestClose();
        }
    }

    function onPopState() {
        // The device/browser back-gesture (or our own history.back()) lands
        // here — close the overlay if it is open.
        pushedHistory = false;
        if (ctx.isOpen) finishClose();
    }

    // Keep the chart filling the (rotated) landscape area when the device is
    // rotated while the pop-out is open. resize() recomputes the canvas box for
    // its new dimensions; without it a rotated canvas is clipped/letterboxed
    // (issue #452). Only acts while open so the inline dashboard path is
    // untouched (the app's own debounced sync owns that).
    function onViewportChange() {
        if (ctx.isOpen) resizeChart(ctx.getChart);
    }

    if (typeof trigger.addEventListener === "function") {
        trigger.addEventListener("click", open);
    }
    if (typeof closeButton.addEventListener === "function") {
        closeButton.addEventListener("click", requestClose);
    }
    if (typeof doc.addEventListener === "function") {
        doc.addEventListener("keydown", onKeydown);
    }
    if (typeof globalThis.addEventListener === "function") {
        globalThis.addEventListener("popstate", onPopState);
        // Re-fit the chart on rotation/resize while open (issue #452).
        globalThis.addEventListener("resize", onViewportChange);
        globalThis.addEventListener("orientationchange", onViewportChange);
    }

    return {
        open,
        close: requestClose,
        toggle: () => (ctx.isOpen ? requestClose() : open()),
        isOpen: () => ctx.isOpen,
    };
}

// Publish on globalThis so the browser dashboard (classic script) and the Deno
// test importer reach the same code, mirroring docs/color_key.js.
globalThis.GRQChartPopout = {
    BODY_OPEN_CLASS,
    isPopoutOpen,
    resizeChart,
    openPopout,
    closePopout,
    togglePopout,
    createChartPopout,
    // Landscape presentation helpers (issue #452).
    isPortraitViewport,
    supportsOrientationLock,
    chooseLandscapePresentation,
    requestLandscapeLock,
    releaseOrientationLock,
    // ?fullscreen=1 boot parameter (issue #482).
    fullscreenRequested,
    shouldOpenFullscreen,
    openFullscreenOnLoad,
};
