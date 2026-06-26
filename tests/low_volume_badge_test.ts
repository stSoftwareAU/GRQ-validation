// Low-volume callout recolour + conditional legend (issue #599).
//
// A "Low volume" name should never occur — it should have been trained out — so
// when one does appear it must be called out loudly. These tests pin the shared
// kernels in docs/projection.js that the dashboard delegates to:
//   - lowVolumeBadge() builds the red (Bootstrap bg-danger) badge markup shared
//     by the legend and both row badges, replacing the old amber
//     bg-warning/text-dark styling.
//   - shouldShowLowVolumeLegend() decides whether the static legend is shown:
//     only when at least one stock in the loaded report is flagged low-volume.
import { assertEquals, assertStringIncludes } from "@std/assert";
import "../docs/projection.js";

const g = globalThis as unknown as {
  GRQProjection: {
    lowVolumeBadge: (label: string, title?: string) => string;
    shouldShowLowVolumeLegend: (flags: boolean[]) => boolean;
  };
};
const GRQProjection = g.GRQProjection;

Deno.test("lowVolumeBadge - uses red bg-danger, not amber bg-warning", () => {
  const html = GRQProjection.lowVolumeBadge("Low volume", "why");
  assertStringIncludes(html, "bg-danger");
  // The amber styling must be gone so the callout reads as a warning/error.
  assertEquals(html.includes("bg-warning"), false);
  assertEquals(html.includes("text-dark"), false);
});

Deno.test("lowVolumeBadge - keeps the shared layout class and renders the label", () => {
  const html = GRQProjection.lowVolumeBadge("Low volume", "why");
  assertStringIncludes(html, "low-volume-badge");
  assertStringIncludes(html, ">Low volume<");
});

Deno.test("lowVolumeBadge - includes the supplied title tooltip", () => {
  const html = GRQProjection.lowVolumeBadge(
    "Low volume — not recommended",
    "capped",
  );
  assertStringIncludes(html, 'title="capped"');
  assertStringIncludes(html, ">Low volume — not recommended<");
});

Deno.test("lowVolumeBadge - omits the title attribute when none is supplied", () => {
  const html = GRQProjection.lowVolumeBadge("Low volume");
  assertEquals(html.includes("title="), false);
});

Deno.test("shouldShowLowVolumeLegend - false when no stock is flagged", () => {
  assertEquals(GRQProjection.shouldShowLowVolumeLegend([]), false);
  assertEquals(GRQProjection.shouldShowLowVolumeLegend([false, false]), false);
});

Deno.test("shouldShowLowVolumeLegend - true when at least one stock is flagged", () => {
  assertEquals(
    GRQProjection.shouldShowLowVolumeLegend([false, true, false]),
    true,
  );
  assertEquals(GRQProjection.shouldShowLowVolumeLegend([true]), true);
});

Deno.test("shouldShowLowVolumeLegend - tolerates a missing/undefined list", () => {
  assertEquals(
    GRQProjection.shouldShowLowVolumeLegend(
      undefined as unknown as boolean[],
    ),
    false,
  );
});
