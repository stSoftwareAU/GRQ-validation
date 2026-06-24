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

// Wire the live dashboard: resolve the overlay/trigger elements, build the
// open/close context, and attach the event listeners that drive the lifecycle —
// tap-to-expand, ✕ to close, Esc to close, and the device back-gesture (a
// history entry is pushed on open so a back navigation pops the overlay rather
// than leaving the page). Returns a small controller, or null when the required
// elements are absent (e.g. a page without the chart).
function createChartPopout(options) {
    const opts = options || {};
    const doc = opts.document || globalThis.document;
    const getChart = typeof opts.getChart === "function"
        ? opts.getChart
        : () => null;
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
        return opened;
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
        return closePopout(ctx);
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
        if (ctx.isOpen) closePopout(ctx);
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
    resizeChart,
    openPopout,
    closePopout,
    togglePopout,
    createChartPopout,
};
