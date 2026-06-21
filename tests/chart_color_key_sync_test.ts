// Tests for the debounce helper that keeps the mobile colour key and chart
// legend in sync across viewport changes (issue #246, part of the legend
// milestone #236).
//
// On a window resize / orientation change the dashboard must re-evaluate the
// mobile/desktop breakpoint and show+populate the colour key when entering
// mobile or tear it down when entering desktop. Resize fires in rapid bursts,
// so the toggle is debounced to run at most once per settle. The browser
// resize handler in docs/app.js is a thin wrapper around this shipped helper,
// so these tests exercise the REAL debounce logic rather than a copy.
//
// Acceptance criteria covered (the "when" of the toggle):
//   - a burst of resize events collapses into a single trailing run;
//   - the latest arguments and `this` are forwarded to the callback;
//   - the callback does not fire until the wait has elapsed;
//   - settled bursts separated by more than the wait each run once;
//   - independent debounced wrappers keep separate timers.
import { assertEquals } from "@std/assert";
import { FakeTime } from "@std/testing/time";
import "../docs/color_key.js";

const g = globalThis as unknown as {
  GRQColorKey: {
    debounce: <T extends (...args: never[]) => unknown>(
      fn: T,
      wait: number,
    ) => (...args: Parameters<T>) => void;
  };
};
const GRQColorKey = g.GRQColorKey;

Deno.test("color_key.js publishes the debounce helper on globalThis", () => {
  assertEquals(typeof GRQColorKey.debounce, "function");
});

Deno.test("debounce - a burst of calls collapses into one trailing run", () => {
  const time = new FakeTime();
  try {
    let calls = 0;
    const debounced = GRQColorKey.debounce(() => calls++, 150);

    debounced();
    debounced();
    debounced();
    // Nothing has fired yet — the wait has not elapsed.
    assertEquals(calls, 0);

    time.tick(150);
    // The whole burst collapsed into a single trailing run.
    assertEquals(calls, 1);
  } finally {
    time.restore();
  }
});

Deno.test("debounce - does not fire until the full wait has elapsed", () => {
  const time = new FakeTime();
  try {
    let calls = 0;
    const debounced = GRQColorKey.debounce(() => calls++, 150);

    debounced();
    time.tick(149);
    assertEquals(calls, 0, "must not fire one tick early");

    time.tick(1);
    assertEquals(calls, 1, "fires exactly when the wait elapses");
  } finally {
    time.restore();
  }
});

Deno.test("debounce - each new call within the wait restarts the timer", () => {
  const time = new FakeTime();
  try {
    let calls = 0;
    const debounced = GRQColorKey.debounce(() => calls++, 150);

    debounced();
    time.tick(100);
    debounced(); // restarts the 150ms window
    time.tick(100); // 200ms since first call, but only 100ms since the last
    assertEquals(calls, 0, "a later call must push the trailing run out");

    time.tick(50); // now 150ms since the last call
    assertEquals(calls, 1);
  } finally {
    time.restore();
  }
});

Deno.test("debounce - forwards the most recent arguments to the callback", () => {
  const time = new FakeTime();
  try {
    const seen: string[] = [];
    const debounced = GRQColorKey.debounce(
      (label: string) => seen.push(label),
      150,
    );

    debounced("first");
    debounced("second");
    debounced("latest");
    time.tick(150);

    assertEquals(seen, ["latest"], "only the last burst arguments are used");
  } finally {
    time.restore();
  }
});

Deno.test("debounce - preserves the `this` binding of the caller", () => {
  const time = new FakeTime();
  try {
    const context = {
      tag: "ctx",
      seen: "",
      run: GRQColorKey.debounce(function (this: { tag: string; seen: string }) {
        this.seen = this.tag;
      }, 150),
    };

    context.run();
    time.tick(150);

    assertEquals(context.seen, "ctx");
  } finally {
    time.restore();
  }
});

Deno.test("debounce - settled bursts separated by more than the wait each run", () => {
  const time = new FakeTime();
  try {
    let calls = 0;
    const debounced = GRQColorKey.debounce(() => calls++, 150);

    debounced();
    time.tick(150);
    assertEquals(calls, 1);

    debounced();
    time.tick(150);
    assertEquals(calls, 2, "a fresh burst after the settle runs again");
  } finally {
    time.restore();
  }
});

Deno.test("debounce - independent wrappers keep separate timers", () => {
  const time = new FakeTime();
  try {
    let a = 0;
    let b = 0;
    const debouncedA = GRQColorKey.debounce(() => a++, 150);
    const debouncedB = GRQColorKey.debounce(() => b++, 300);

    debouncedA();
    debouncedB();
    time.tick(150);
    assertEquals([a, b], [1, 0], "A fires on its own shorter timer");

    time.tick(150);
    assertEquals([a, b], [1, 1], "B fires later without affecting A");
  } finally {
    time.restore();
  }
});
