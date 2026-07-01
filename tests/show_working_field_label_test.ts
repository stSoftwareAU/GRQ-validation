// Tests for the "show working" popover field label (issue #542).
//
// The popover header inside every "show the working" tooltip used to render the
// RAW internal field id, e.g. `Field: current-price`. That is wrong/misleading:
// the dashboard deliberately labels that figure "90-Day Actual" (issue #683,
// formerly "90-Day Price" per #539), never "Current Price", so it cannot be
// mistaken for a live quote. This change maps each internal field id to its
// human-readable display label so the working header reads `Field: 90-Day Actual`.
//
// The helper is a PURE classic script (docs/field_label.js) published on
// globalThis, mirroring docs/color_key.js / docs/series_label_colour.js, so the
// browser dashboard (via app.js) and these Deno tests exercise the SAME code.

import { assert, assertEquals } from "@std/assert";
import "../docs/field_label.js";

const g = globalThis as unknown as {
  GRQFieldLabel: {
    FIELD_LABELS: Record<string, string>;
    fieldLabel: (field: string) => string;
    workingHeader: (
      stockSymbol: string,
      field: string,
      scoreDateISO: string,
    ) => string;
  };
};
const GRQFieldLabel = g.GRQFieldLabel;

// --- the bug fix: current-price must read as "90-Day Actual" ----------------

Deno.test('fieldLabel - "current-price" maps to "90-Day Actual", not a live-quote label', () => {
  assertEquals(GRQFieldLabel.fieldLabel("current-price"), "90-Day Actual");
});

Deno.test('fieldLabel - never returns the misleading "Current Price" wording', () => {
  for (const label of Object.values(GRQFieldLabel.FIELD_LABELS)) {
    assert(
      !/current\s*price/i.test(label),
      `label "${label}" must not use the misleading "Current Price" wording`,
    );
  }
});

// --- the other known fields keep their established display labels -----------

Deno.test("fieldLabel - maps the documented field ids to their display labels", () => {
  const expected: Record<string, string> = {
    "buy-price": "Buy Price",
    "target": "90-Day Target",
    "target-percentage": "Target Percentage",
    "current-price": "90-Day Actual",
    "gain-loss": "Gain/Loss",
    "progress-vs-cost": "Return above Cost of Capital",
    "judgement": "Judgement",
    "status-projection": "Status/Projection",
    "intrinsic-basic": "Intrinsic Value (Basic)",
    "intrinsic-adjusted": "Intrinsic Value (Adjusted)",
    "avg-dividend": "Average Dividend (90-day)",
    "total-dividend": "Total Dividends (90-day)",
    "dividend-info": "Dividend Info",
    "stars": "Stars",
    "fair-value-range": "Fair Value Range",
    "portfolio-target": "Portfolio Target",
  };
  for (const [field, label] of Object.entries(expected)) {
    assertEquals(GRQFieldLabel.fieldLabel(field), label);
  }
});

// --- robustness: unknown / empty ids fall back gracefully -------------------

Deno.test("fieldLabel - unknown field id falls back to the raw id", () => {
  assertEquals(GRQFieldLabel.fieldLabel("no-such-field"), "no-such-field");
});

Deno.test("fieldLabel - empty/missing input returns an empty string", () => {
  assertEquals(GRQFieldLabel.fieldLabel(""), "");
  assertEquals(
    GRQFieldLabel.fieldLabel(undefined as unknown as string),
    "",
  );
});

// --- the working header uses the friendly label -----------------------------

Deno.test("workingHeader - renders the friendly field label, not the raw id", () => {
  const header = GRQFieldLabel.workingHeader(
    "NYSE:SCHW",
    "current-price",
    "2025-01-15",
  );
  assertEquals(
    header,
    "Stock: NYSE:SCHW | Field: 90-Day Actual | Score Date: 2025-01-15\n\n",
  );
  assert(
    !header.includes("current-price"),
    "working header must not leak the raw 'current-price' field id",
  );
});

Deno.test("workingHeader - keeps the stock symbol and score date verbatim", () => {
  const header = GRQFieldLabel.workingHeader(
    "ASX:CBA",
    "buy-price",
    "2024-12-31",
  );
  assertEquals(
    header,
    "Stock: ASX:CBA | Field: Buy Price | Score Date: 2024-12-31\n\n",
  );
});
