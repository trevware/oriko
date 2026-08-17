import { describe, expect, it } from "vitest";
import { choosePlaying } from "../src/playback";

describe("choosePlaying", () => {
  it("plays nothing when nothing is sufficiently visible", () => {
    expect(choosePlaying([{ id: "a", centerDistance: 10, ratio: 0.2 }], 4)).toEqual([]);
  });

  it("plays candidates that are at least half visible", () => {
    expect(choosePlaying([{ id: "a", centerDistance: 10, ratio: 0.6 }], 4)).toEqual(["a"]);
  });

  it("treats exactly half visible as visible enough", () => {
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
