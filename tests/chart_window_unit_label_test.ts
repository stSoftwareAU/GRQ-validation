// Tests for the compact chart-window toggle labels (issue #527).
//
// In portrait mode on an iPhone the two buttons "90 days" and "180 days" do not
// quite fit on one line. The fix shows the numbers alone on the buttons ("90" &
// "180") and the unit "days" ONCE, beside the group. Accessibility is preserved
// because each radio keeps its full "90 days" / "180 days" accessible name via
// aria-label, and the shared "days" unit is decorative (aria-hidden) so screen
// readers are not told "days" twice.
//
// These assertions read the shipped docs/index.html, the same structural
// approach used by chart_window_toggle_test.ts.
//
// Issue #632: the former "the 'days' unit is styled to sit inline" assertion
// was a source-text grep over docs/styles.css (it only checked that the string
// `.chart-window-unit` appeared in the stylesheet), so any behaviour-preserving
// restyle that renamed or reorganised the rule tripped it without changing the
// rendered layout. The visible/decorative-unit behaviour below is the enduring
// contract; the inline rendering is exercised by the pa11y visual gate.

import { assert } from "@std/assert";

const html = await Deno.readTextFile("docs/index.html");

/** Return the text content of the FIRST `<label ... for="id">TEXT</label>`. */
function labelText(source: string, id: string): string | null {
  const re = new RegExp(`<label\\b[^>]*for="${id}"[^>]*>([\\s\\S]*?)</label>`);
  const m = source.match(re);
  return m ? m[1].trim() : null;
}

Deno.test("index.html: the 90-day button shows the number alone (issue #527)", () => {
  const text = labelText(html, "chartWindow90");
  assert(text !== null, "the 90-day label must exist");
  assertEqualLabel(text!, "90");
});

Deno.test("index.html: the 180-day button shows the number alone (issue #527)", () => {
  const text = labelText(html, "chartWindow180");
  assert(text !== null, "the 180-day label must exist");
  assertEqualLabel(text!, "180");
});

/** Assert a label's visible text is exactly `want` with no "days" suffix. */
function assertEqualLabel(got: string, want: string): void {
  assert(
    got === want,
    `button label must read "${want}" with no unit, got "${got}"`,
  );
  assert(
    !/days/i.test(got),
    `button label must not repeat the "days" unit, got "${got}"`,
  );
}

Deno.test("index.html: the 'days' unit is shown exactly once beside the group (issue #527)", () => {
  // A single visible unit element carries the word "days".
  assert(
    html.includes("chart-window-unit"),
    "a .chart-window-unit element must carry the shared 'days' label",
  );
  const unitMatches = html.match(/class="chart-window-unit"/g) ?? [];
  assert(
    unitMatches.length === 1,
    `the 'days' unit must appear exactly once, found ${unitMatches.length}`,
  );
  const unit = html.match(
    /<span\b[^>]*class="chart-window-unit"[^>]*>([\s\S]*?)<\/span>/,
  );
  assert(unit !== null, 'the unit must be a <span class="chart-window-unit">');
  assert(
    unit![1].trim() === "days",
    `the unit text must read "days", got "${unit![1].trim()}"`,
  );
});

Deno.test("index.html: each radio keeps its full accessible name (issue #527)", () => {
  // Numbers-only visible labels would announce just "90" / "180"; aria-label
  // restores the full "90 days" / "180 days" name for screen readers.
  const ninety = html.slice(
    html.indexOf('id="chartWindow90"'),
    html.indexOf('id="chartWindow90"') + 260,
  );
  assert(
    ninety.includes('aria-label="90 days"'),
    'the 90-day radio must keep aria-label="90 days"',
  );
  const oneEighty = html.slice(
    html.indexOf('id="chartWindow180"'),
    html.indexOf('id="chartWindow180"') + 260,
  );
  assert(
    oneEighty.includes('aria-label="180 days"'),
    'the 180-day radio must keep aria-label="180 days"',
  );
});

Deno.test("index.html: the shared 'days' unit is decorative for screen readers (issue #527)", () => {
  const unit = html.match(
    /<span\b[^>]*class="chart-window-unit"[^>]*>/,
  );
  assert(unit !== null, "the unit element must exist");
  assert(
    /aria-hidden="true"/.test(unit![0]),
    "the shared 'days' unit must be aria-hidden so it is not announced twice",
  );
});
