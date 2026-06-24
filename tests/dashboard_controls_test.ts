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

// Issue #530: "Score File" is an implementation detail outsiders do not
// understand. The user-facing label and placeholder must read "Prediction
// Date" instead, while the underlying control id stays unchanged.
Deno.test("dashboard - control is labelled 'Prediction Date', not 'Score File'", () => {
  assert(
    /<label for="scoreFileSelect"[^>]*>Prediction Date:<\/label>/.test(html),
    "the label must read 'Prediction Date:'",
  );
  assert(
    !html.includes(">Score File:</label>"),
    "the old 'Score File:' label must not remain",
  );
  assert(
    html.includes("Select a prediction date..."),
    "the placeholder option must read 'Select a prediction date...'",
  );
  assert(
    !html.includes("Select a score file..."),
    "the old 'Select a score file...' placeholder must not remain",
  );
});
