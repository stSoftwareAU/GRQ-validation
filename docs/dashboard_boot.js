// Dashboard page bootstrap (issue #189).
//
// Loads app.js with a cache-busting version query and maintains the responsive
// debug readout. Extracted from an inline <script> so docs/index.html can
// enforce a strict Content-Security-Policy without 'unsafe-inline'. Relies on
// globalThis.VERSION, set earlier by version.js.
(function () {
  "use strict";

  const VERSION = globalThis.VERSION || "";

  // Dynamically load app.js with the version parameter.
  const script = document.createElement("script");
  script.src = `app.js?v=${VERSION}`;
  document.head.appendChild(script);

  // Show responsive debug info using Bootstrap's breakpoints.
  function updateDebugInfo() {
    const width = window.innerWidth;
    let breakpoint;
    if (width >= 1400) breakpoint = "xxl";
    else if (width >= 1200) breakpoint = "xl";
    else if (width >= 992) breakpoint = "lg";
    else if (width >= 768) breakpoint = "md";
    else if (width >= 576) breakpoint = "sm";
    else breakpoint = "xs";

    const isMobile = breakpoint === "xs" || breakpoint === "sm";

    const debugInfo = document.getElementById("debug-info");
    if (debugInfo) {
      debugInfo.textContent =
        `Bootstrap: ${breakpoint} | Mobile: ${isMobile} | Width: ${window.innerWidth}px | UA: ${
          navigator.userAgent.substring(0, 60)
        }...`;
      console.log("Debug info updated:", debugInfo.textContent);
    } else {
      console.error("Debug info element not found!");
    }
  }

  updateDebugInfo();
  window.addEventListener("load", updateDebugInfo);
  window.addEventListener("resize", updateDebugInfo);
})();
