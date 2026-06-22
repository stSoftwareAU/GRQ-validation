// Tests for the shared popover-cleanup helper (issue #370).
//
// On a ~375px mobile viewport, opening a value popover and then re-rendering
// the dashboard (selecting a single stock, switching score file, basic ↔
// market view, or back-to-aggregate) used to leave the popover tip orphaned on
// `<body>` with no way to close it. `clearAllPopovers` must hide+dispose every
// live popover instance AND sweep any stray `.popover` tips, so that
// `document.querySelectorAll('.popover').length === 0` after a re-render.
//
// These import the REAL shipped helper from docs/popover_cleanup.js and assert
// on its observable behaviour against a minimal DOM mock — no browser needed.
import { assert, assertEquals } from "@std/assert";
import "../docs/popover_cleanup.js";

const g = globalThis as unknown as {
  GRQPopovers: {
    clearAllPopovers: (
      doc: unknown,
      popoverApi: unknown,
    ) => { disposed: number; swept: number };
  };
};
const { clearAllPopovers } = g.GRQPopovers;

// --- Minimal DOM mock -------------------------------------------------------

interface FakeInstance {
  hidden: boolean;
  disposed: boolean;
  hide: () => void;
  dispose: () => void;
}

class FakeNode {
  removed = false;
  constructor(public className: string) {}
  remove() {
    this.removed = true;
  }
}

class FakeTrigger {
  constructor(public instance: FakeInstance | null) {}
}

// A document-like object whose querySelectorAll dispatches on the two selectors
// the helper uses: the popover triggers and the `.popover` tips.
class FakeDoc {
  constructor(
    public triggers: FakeTrigger[],
    public tips: FakeNode[],
  ) {}
  querySelectorAll(selector: string): unknown[] {
    if (selector === '[data-bs-toggle="popover"]') return this.triggers;
    if (selector === ".popover") return this.tips.filter((n) => !n.removed);
    return [];
  }
}

// A fake Bootstrap Popover API: getInstance returns the instance stored on the
// trigger (mirroring bootstrap.Popover.getInstance(element)).
function makePopoverApi() {
  return {
    getInstance(el: unknown): FakeInstance | null {
      return (el as FakeTrigger).instance;
    },
  };
}

function makeInstance(): FakeInstance {
  const inst: FakeInstance = {
    hidden: false,
    disposed: false,
    hide() {
      inst.hidden = true;
    },
    dispose() {
      inst.disposed = true;
    },
  };
  return inst;
}

// --- Tests ------------------------------------------------------------------

Deno.test("clearAllPopovers publishes on globalThis", () => {
  assertEquals(typeof clearAllPopovers, "function");
});

Deno.test("clearAllPopovers hides then disposes every live popover", () => {
  const a = makeInstance();
  const b = makeInstance();
  const doc = new FakeDoc(
    [new FakeTrigger(a), new FakeTrigger(b)],
    [],
  );
  const result = clearAllPopovers(doc, makePopoverApi());

  assert(a.hidden, "first popover should be hidden before disposal");
  assert(a.disposed, "first popover should be disposed");
  assert(b.hidden, "second popover should be hidden before disposal");
  assert(b.disposed, "second popover should be disposed");
  assertEquals(result.disposed, 2);
});

Deno.test("clearAllPopovers sweeps an orphaned tip with no live trigger (the stuck-popover bug)", () => {
  // The reported symptom: the trigger was destroyed by innerHTML="" but the
  // open tip survives on <body>. There is NO live trigger, so disposing by
  // trigger alone cannot remove it — only the sweep can.
  const orphanTip = new FakeNode("popover");
  const doc = new FakeDoc([], [orphanTip]);

  const result = clearAllPopovers(doc, makePopoverApi());

  assert(orphanTip.removed, "orphaned tip must be removed from the document");
  assertEquals(result.swept, 1);
  // Acceptance criterion: no .popover survives.
  assertEquals(doc.querySelectorAll(".popover").length, 0);
});

Deno.test("clearAllPopovers leaves no .popover after a mixed open+orphan state", () => {
  // One open popover (live trigger + tip) plus a leftover orphaned tip.
  const open = makeInstance();
  const openTip = new FakeNode("popover");
  const orphanTip = new FakeNode("popover");
  const doc = new FakeDoc(
    [new FakeTrigger(open)],
    [openTip, orphanTip],
  );

  const result = clearAllPopovers(doc, makePopoverApi());

  assert(open.disposed, "the live popover should be disposed");
  assertEquals(result.disposed, 1);
  assertEquals(result.swept, 2);
  assertEquals(doc.querySelectorAll(".popover").length, 0);
});

Deno.test("clearAllPopovers ignores triggers with no popover instance", () => {
  const doc = new FakeDoc([new FakeTrigger(null)], []);
  const result = clearAllPopovers(doc, makePopoverApi());
  assertEquals(result.disposed, 0);
  assertEquals(result.swept, 0);
});

Deno.test("clearAllPopovers is a no-op for a missing/invalid document", () => {
  assertEquals(clearAllPopovers(null, makePopoverApi()), {
    disposed: 0,
    swept: 0,
  });
  assertEquals(clearAllPopovers({}, makePopoverApi()), {
    disposed: 0,
    swept: 0,
  });
});

Deno.test("clearAllPopovers tolerates a missing Popover API", () => {
  // If bootstrap is unavailable, the helper must still sweep stray tips.
  const orphanTip = new FakeNode("popover");
  const doc = new FakeDoc([new FakeTrigger(makeInstance())], [orphanTip]);
  const result = clearAllPopovers(doc, undefined);
  assertEquals(result.disposed, 0);
  assertEquals(result.swept, 1);
  assert(orphanTip.removed);
});
