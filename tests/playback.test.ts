import { describe, expect, it } from "vitest";
import { choosePlaying, visibleRatio } from "../src/playback";

describe("choosePlaying", () => {
  it("plays nothing when nothing is sufficiently visible", () => {
    expect(choosePlaying([{ id: "a", centerDistance: 10, ratio: 0.2 }], 4)).toEqual([]);
  });

  it("plays a candidate that is comfortably visible", () => {
    expect(choosePlaying([{ id: "a", centerDistance: 10, ratio: 0.6 }], 4)).toEqual(["a"]);
  });

  it("plays a half-visible candidate", () => {
    expect(choosePlaying([{ id: "a", centerDistance: 10, ratio: 0.5 }], 4)).toEqual(["a"]);
  });

  it("caps the number playing", () => {
    const candidates = Array.from({ length: 10 }, (_, i) => ({
      id: `i${i}`,
      centerDistance: i,
      ratio: 0.9,
    }));
    expect(choosePlaying(candidates, 4)).toHaveLength(4);
  });

  it("prefers the candidates nearest the viewport center", () => {
    const chosen = choosePlaying(
      [
        { id: "far", centerDistance: 900, ratio: 0.9 },
        { id: "near", centerDistance: 20, ratio: 0.9 },
        { id: "mid", centerDistance: 300, ratio: 0.9 },
      ],
      2
    );
    expect(chosen).toEqual(["near", "mid"]);
  });

  it("returns an empty list for no candidates", () => {
    expect(choosePlaying([], 4)).toEqual([]);
  });

  it("plays nothing when the cap is zero", () => {
    expect(choosePlaying([{ id: "a", centerDistance: 1, ratio: 1 }], 0)).toEqual([]);
  });

  it("does not mutate its input order", () => {
    const input = [
      { id: "far", centerDistance: 900, ratio: 0.9 },
      { id: "near", centerDistance: 20, ratio: 0.9 },
    ];
    choosePlaying(input, 2);
    expect(input[0].id).toBe("far");
  });
});

describe("visibleRatio", () => {
  const root = { top: 0, bottom: 1000, left: 0, right: 800 };

  it("is 1 for an element wholly inside the root", () => {
    expect(visibleRatio({ top: 100, bottom: 300, left: 50, right: 250 }, root)).toBe(1);
  });

  it("is 0 for an element entirely above the root", () => {
    expect(visibleRatio({ top: -400, bottom: -100, left: 50, right: 250 }, root)).toBe(0);
  });

  it("is 0 for an element entirely below the root", () => {
    expect(visibleRatio({ top: 1200, bottom: 1400, left: 50, right: 250 }, root)).toBe(0);
  });

  it("reports the fraction showing when straddling the top edge", () => {
    // 200 tall, 50 of it below y=0.
    expect(visibleRatio({ top: -150, bottom: 50, left: 0, right: 100 }, root)).toBeCloseTo(0.25);
  });

  it("reports the fraction showing when straddling the bottom edge", () => {
    // 200 tall, 150 of it above y=1000.
    expect(visibleRatio({ top: 850, bottom: 1050, left: 0, right: 100 }, root)).toBeCloseTo(0.75);
  });

  it("accounts for horizontal clipping as well as vertical", () => {
    // Half off the right edge and half off the bottom: a quarter showing.
    expect(visibleRatio({ top: 900, bottom: 1100, left: 700, right: 900 }, root)).toBeCloseTo(0.25);
  });

  it("is 0 for a zero-area element rather than NaN", () => {
    expect(visibleRatio({ top: 100, bottom: 100, left: 50, right: 50 }, root)).toBe(0);
  });

  it("touching the edge exactly counts as nothing showing", () => {
    expect(visibleRatio({ top: 1000, bottom: 1200, left: 0, right: 100 }, root)).toBe(0);
  });
});

describe("choosePlaying at the widened threshold", () => {
  it("plays a tile only a quarter visible", () => {
    expect(choosePlaying([{ id: "a", centerDistance: 10, ratio: 0.25 }], 4)).toEqual(["a"]);
  });

  it("still ignores a tile barely peeking in", () => {
    expect(choosePlaying([{ id: "a", centerDistance: 10, ratio: 0.1 }], 4)).toEqual([]);
  });
});

describe("choosePlaying without a cap", () => {
  it("plays everything visible when max is unbounded", () => {
    const candidates = Array.from({ length: 30 }, (_, i) => ({
      id: `i${i}`,
      centerDistance: i,
      ratio: 0.9,
    }));
    expect(choosePlaying(candidates, Number.POSITIVE_INFINITY)).toHaveLength(30);
  });

  it("still leaves out what is not visible enough", () => {
    const chosen = choosePlaying(
      [
        { id: "seen", centerDistance: 5, ratio: 0.9 },
        { id: "edge", centerDistance: 5, ratio: 0.05 },
      ],
      Number.POSITIVE_INFINITY
    );
    expect(chosen).toEqual(["seen"]);
  });
});
