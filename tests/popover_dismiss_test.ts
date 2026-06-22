// Tests for the consolidated popover dismissal logic (issue #371, part of the
// mobile info-popover milestone #335).
//
// docs/popover_dismiss.js holds the single source of truth for "tap outside to
// close". The browser handler in docs/app.js is a thin wrapper around these
// helpers, so these tests exercise the REAL shipped decision logic:
//   - decidePopoverAction(): inside-popover taps are ignored; trigger taps
//     close-and-reopen; outside taps close only;
//   - closeAllPopovers(): hides EVERY live instance (not gated on
//     aria-describedby) and removes ORPHANED .popover nodes that have no live
//     trigger — the core bug from #371.
import { assert, assertEquals } from "@std/assert";
import { checkJsSyntax } from "../helpers/js_syntax.ts";
import "../docs/popover_dismiss.js";

interface Instance {
  hidden: boolean;
  hide(): void;
}

interface Tip {
  removed: boolean;
  remove(): void;
}

const g = globalThis as unknown as {
  GRQPopover: {
    POPOVER_TRIGGER_SELECTOR: string;
    POPOVER_TIP_SELECTOR: string;
    decidePopoverAction: (
      ctx: { insidePopover: boolean; hasTrigger: boolean },
    ) => string;
    closeAllPopovers: (
      doc: { querySelectorAll: (sel: string) => unknown[] },
      getInstance: (el: unknown) => Instance | null,
    ) => { hidden: number; removed: number };
  };
};
const GRQPopover = g.GRQPopover;

/** Build a document-like stub returning the given triggers and tips by selector. */
function fakeDoc(triggers: unknown[], tips: Tip[]) {
  return {
    querySelectorAll(sel: string): unknown[] {
      if (sel === GRQPopover.POPOVER_TIP_SELECTOR) return tips;
      if (sel === GRQPopover.POPOVER_TRIGGER_SELECTOR) return triggers;
      return [];
    },
  };
}

function makeInstance(): Instance {
  return {
    hidden: false,
    hide() {
      this.hidden = true;
    },
  };
}

function makeTip(): Tip {
  return {
    removed: false,
    remove() {
      this.removed = true;
    },
  };
}

Deno.test("popover_dismiss.js publishes its helpers on globalThis", () => {
  assertEquals(typeof GRQPopover.decidePopoverAction, "function");
  assertEquals(typeof GRQPopover.closeAllPopovers, "function");
  assertEquals(typeof GRQPopover.POPOVER_TRIGGER_SELECTOR, "string");
  assertEquals(typeof GRQPopover.POPOVER_TIP_SELECTOR, "string");
});

Deno.test("decidePopoverAction - tapping inside popover content is ignored (criterion 3)", () => {
  assertEquals(
    GRQPopover.decidePopoverAction({ insidePopover: true, hasTrigger: false }),
    "ignore",
  );
  // Inside-popover wins even if the target also matches a trigger selector.
  assertEquals(
    GRQPopover.decidePopoverAction({ insidePopover: true, hasTrigger: true }),
    "ignore",
  );
});

Deno.test("decidePopoverAction - tapping a trigger closes others then reopens it", () => {
  assertEquals(
    GRQPopover.decidePopoverAction({ insidePopover: false, hasTrigger: true }),
    "closeAndReopen",
  );
});

Deno.test("decidePopoverAction - tapping anywhere else closes all popovers", () => {
  assertEquals(
    GRQPopover.decidePopoverAction({ insidePopover: false, hasTrigger: false }),
    "closeOnly",
  );
});

Deno.test("closeAllPopovers - hides every live instance regardless of aria-describedby", () => {
  const a = {};
  const b = {};
  const instances = new Map<unknown, Instance>([
    [a, makeInstance()],
    [b, makeInstance()],
  ]);
  const doc = fakeDoc([a, b], []);

  const result = GRQPopover.closeAllPopovers(
    doc,
    (el) => instances.get(el) ?? null,
  );

  assertEquals(result.hidden, 2);
  assert(instances.get(a)!.hidden, "first instance was hidden");
  assert(instances.get(b)!.hidden, "second instance was hidden");
});

Deno.test("closeAllPopovers - removes orphaned tips that have no live trigger (core #371 bug)", () => {
  // No triggers at all — only a stray .popover left on <body> by a re-render.
  const orphan = makeTip();
  const doc = fakeDoc([], [orphan]);

  const result = GRQPopover.closeAllPopovers(doc, () => null);

  assertEquals(result.hidden, 0);
  assertEquals(result.removed, 1);
  assert(orphan.removed, "orphaned tip was removed from the DOM");
});

Deno.test("closeAllPopovers - hides live instances AND removes leftover orphans together", () => {
  const trigger = {};
  const live = makeInstance();
  const orphan = makeTip();
  const doc = fakeDoc([trigger], [orphan]);

  const result = GRQPopover.closeAllPopovers(
    doc,
    (el) => (el === trigger ? live : null),
  );

  assertEquals(result.hidden, 1);
  assertEquals(result.removed, 1);
  assert(live.hidden, "live instance was hidden");
  assert(orphan.removed, "leftover orphan was removed");
});

Deno.test("closeAllPopovers - no popovers present is a safe no-op", () => {
  const result = GRQPopover.closeAllPopovers(fakeDoc([], []), () => null);
  assertEquals(result, { hidden: 0, removed: 0 });
});

Deno.test("closeAllPopovers - tolerates a trigger with no instance", () => {
  const result = GRQPopover.closeAllPopovers(fakeDoc([{}], []), () => null);
  assertEquals(result, { hidden: 0, removed: 0 });
});

Deno.test("popover_dismiss.js parses cleanly as JavaScript", async () => {
  const source = await Deno.readTextFile(
    new URL("../docs/popover_dismiss.js", import.meta.url),
  );
  const result = checkJsSyntax(source);
  assertEquals(result.valid, true, result.error);
});
