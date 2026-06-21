// Tests for the dashboard controls row on docs/index.html (issue #251).
//
// The redundant "View All Score Files" button (linking to list.html) was
// removed from the dashboard. These tests assert the button and its link are
// gone while the Score File dropdown remains intact.

import { assert } from "@std/assert";

const html = await Deno.readTextFile("docs/index.html");

Deno.test("dashboard - no list.html link remains", () => {
  assert(
    !html.includes("list.html"),
    "docs/index.html must not link to list.html",
  );
});

Deno.test("dashboard - no 'View All Score Files' button remains", () => {
  assert(
    !html.includes("View All Score Files"),
    "the 'View All Score Files' button must be removed",
  );
});

Deno.test("dashboard - Score File dropdown is preserved", () => {
  assert(
    html.includes('id="scoreFileSelect"'),
    "the #scoreFileSelect dropdown must remain",
  );
});
