// Behavioural tests for the transient Trend-view grouping deep-link helpers
// (issue #481, part of milestone #450 — URL parameters for more dashboard
// state).
//
// These import the REAL shipped helpers from docs/trend_grouping_link.js — the
// same pure functions trend.js uses to honour a `?group=day|week|month|quarter`
// URL parameter for the current visit only. The helper reuses
// GRQTrendSettings.normaliseGrouping / GRANULARITIES as the single source of
// truth for what counts as a granularity, so the settings module is imported
// first. Both modules publish their helpers on globalThis and touch no DOM, so
// they import cleanly under Deno.
import { assert, assertEquals } from "@std/assert";
import "../docs/trend_settings.js";
import "../docs/trend_grouping_link.js";

const g = globalThis as unknown as {
  GRQTrendGroupingLink: {
    groupingFromSearch: (search: unknown) => string | null;
    effectiveGrouping: (search: unknown, savedGrouping: unknown) => string;
  };
};
const L = g.GRQTrendGroupingLink;

Deno.test("GRQTrendGroupingLink is published on globalThis", () => {
  assert(
    L,
    "trend_grouping_link.js should publish globalThis.GRQTrendGroupingLink",
  );
});

Deno.test("groupingFromSearch extracts each valid granularity", () => {
  assertEquals(L.groupingFromSearch("?group=day"), "day");
  assertEquals(L.groupingFromSearch("?group=week"), "week");
  assertEquals(L.groupingFromSearch("?group=month"), "month");
  assertEquals(L.groupingFromSearch("?group=quarter"), "quarter");
  // Leading "?" optional and works alongside other params.
  assertEquals(L.groupingFromSearch("group=week"), "week");
  assertEquals(L.groupingFromSearch("?theme=dark&group=quarter"), "quarter");
});

Deno.test("groupingFromSearch returns null when absent, blank or invalid", () => {
  assertEquals(L.groupingFromSearch(""), null);
  assertEquals(L.groupingFromSearch("?theme=dark"), null);
  assertEquals(L.groupingFromSearch("?group="), null);
  assertEquals(L.groupingFromSearch("?group=%20%20"), null);
  assertEquals(L.groupingFromSearch("?group=year"), null);
  assertEquals(L.groupingFromSearch("?group=fortnight"), null);
  assertEquals(L.groupingFromSearch(null), null);
  assertEquals(L.groupingFromSearch(undefined), null);
});

Deno.test("effectiveGrouping: a valid override wins over the saved grouping", () => {
  assertEquals(L.effectiveGrouping("?group=week", "month"), "week");
  assertEquals(L.effectiveGrouping("?group=day", "quarter"), "day");
  // The override even overrides a saved value equal to the default.
  assertEquals(L.effectiveGrouping("?group=quarter", "month"), "quarter");
});

Deno.test("effectiveGrouping: absent/invalid override keeps the saved grouping", () => {
  assertEquals(L.effectiveGrouping("", "week"), "week");
  assertEquals(L.effectiveGrouping("?theme=dark", "quarter"), "quarter");
  assertEquals(L.effectiveGrouping("?group=year", "day"), "day");
  assertEquals(L.effectiveGrouping("?group=", "week"), "week");
});

Deno.test("effectiveGrouping: a corrupt saved grouping falls back to the default", () => {
  // No override + an unknown saved value normalises to the month default.
  assertEquals(L.effectiveGrouping("", "fortnight"), "month");
  assertEquals(L.effectiveGrouping("", null), "month");
  assertEquals(L.effectiveGrouping("", undefined), "month");
});

Deno.test("trend.html and sw.js wire in the grouping deep-link helper", async () => {
  const trendHtml = await Deno.readTextFile("docs/trend.html");
  const sw = await Deno.readTextFile("docs/sw.js");
  assert(
    trendHtml.includes('src="trend_grouping_link.js"'),
    "trend.html must load trend_grouping_link.js",
  );
  assert(
    sw.includes('"./trend_grouping_link.js"'),
    "sw.js STATIC_ASSETS must precache trend_grouping_link.js",
  );
});
