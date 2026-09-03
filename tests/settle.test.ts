import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { settled } from "../src/core/settle";
import type { Timers } from "../src/core/settle";

/** Node's timers, which vi.useFakeTimers() replaces in place. */
const timers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

describe("settled", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("runs once, after the calls stop", () => {
    let runs = 0;
    const later = settled(() => runs++, 100, timers);
    later.call();
    vi.advanceTimersByTime(60);
    later.call();
    vi.advanceTimersByTime(60);
    later.call();
    expect(runs).toBe(0);
    vi.advanceTimersByTime(100);
    expect(runs).toBe(1);
  });

  it("runs again for a later burst", () => {
    let runs = 0;
    const later = settled(() => runs++, 100, timers);
    later.call();
    vi.advanceTimersByTime(100);
    later.call();
    vi.advanceTimersByTime(100);
    expect(runs).toBe(2);
  });

  it("can be cancelled before it runs", () => {
    let runs = 0;
    const later = settled(() => runs++, 100, timers);
    later.call();
    later.cancel();
    vi.advanceTimersByTime(200);
    expect(runs).toBe(0);
  });
});
