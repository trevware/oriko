import { describe, expect, it } from "vitest";
import {
  idsInRect,
  intersects,
  mergeSelection,
  rangeSelection,
  rectFromCorners,
  toggleSelection,
} from "../src/selection";
import type { Position } from "../src/layout";

const positions: Position[] = [
  { id: "a", x: 0, y: 0, w: 100, h: 100 },
  { id: "b", x: 150, y: 0, w: 100, h: 100 },
  { id: "c", x: 0, y: 150, w: 100, h: 100 },
];

describe("rectFromCorners", () => {
  it("normalises a drag down and right", () => {
    expect(rectFromCorners(10, 20, 40, 60)).toEqual({ x: 10, y: 20, w: 30, h: 40 });
  });

  it("normalises a drag up and left", () => {
    expect(rectFromCorners(40, 60, 10, 20)).toEqual({ x: 10, y: 20, w: 30, h: 40 });
  });

  it("handles a zero-size drag", () => {
    expect(rectFromCorners(5, 5, 5, 5)).toEqual({ x: 5, y: 5, w: 0, h: 0 });
  });
});

describe("intersects", () => {
  const box = { x: 0, y: 0, w: 100, h: 100 };

  it("detects overlap", () => {
    expect(intersects(box, { x: 50, y: 50, w: 100, h: 100 })).toBe(true);
  });

  it("counts a touching edge", () => {
    expect(intersects(box, { x: 100, y: 0, w: 10, h: 10 })).toBe(true);
  });

  it("rejects a gap", () => {
    expect(intersects(box, { x: 101, y: 0, w: 10, h: 10 })).toBe(false);
  });

  it("detects containment either way round", () => {
    expect(intersects(box, { x: 10, y: 10, w: 10, h: 10 })).toBe(true);
    expect(intersects({ x: 10, y: 10, w: 10, h: 10 }, box)).toBe(true);
  });
});

describe("idsInRect", () => {
  it("finds only the tiles the marquee touches", () => {
    expect(idsInRect(positions, { x: 0, y: 0, w: 110, h: 50 })).toEqual(["a"]);
  });

  it("finds several at once", () => {
    expect(idsInRect(positions, { x: 0, y: 0, w: 300, h: 300 })).toEqual(["a", "b", "c"]);
  });

  it("returns nothing for a marquee in empty space", () => {
    expect(idsInRect(positions, { x: 400, y: 400, w: 50, h: 50 })).toEqual([]);
  });

  it("keeps layout order", () => {
    expect(idsInRect(positions, { x: 0, y: 0, w: 300, h: 300 })).toEqual(["a", "b", "c"]);
  });
});

describe("mergeSelection", () => {
  it("replaces the selection by default", () => {
    expect([...mergeSelection(new Set(["a"]), ["b"], false)]).toEqual(["b"]);
  });

  it("adds to the selection with a modifier", () => {
    expect([...mergeSelection(new Set(["a"]), ["b"], true)].sort()).toEqual(["a", "b"]);
  });

  it("does not duplicate an already selected tile", () => {
    expect(mergeSelection(new Set(["a"]), ["a"], true).size).toBe(1);
  });

  it("clears when an empty marquee replaces", () => {
    expect(mergeSelection(new Set(["a", "b"]), [], false).size).toBe(0);
  });

  it("keeps the base when an empty marquee is additive", () => {
    expect(mergeSelection(new Set(["a"]), [], true).size).toBe(1);
  });

  it("does not mutate the base set", () => {
    const base = new Set(["a"]);
    mergeSelection(base, ["b"], true);
    expect(base.size).toBe(1);
  });
});

describe("toggleSelection", () => {
  it("adds an unselected id", () => {
    expect([...toggleSelection(new Set(["a"]), "b")].sort()).toEqual(["a", "b"]);
  });

  it("removes a selected id", () => {
    expect([...toggleSelection(new Set(["a", "b"]), "b")]).toEqual(["a"]);
  });

  it("does not mutate the base", () => {
    const base = new Set(["a"]);
    toggleSelection(base, "b");
    expect(base.size).toBe(1);
  });
});

describe("rangeSelection", () => {
  const order = ["a", "b", "c", "d", "e"];

  it("selects everything between anchor and target", () => {
    expect([...rangeSelection(order, "b", "d", new Set())]).toEqual(["b", "c", "d"]);
  });

  it("works when dragging the range backwards", () => {
    expect([...rangeSelection(order, "d", "b", new Set())].sort()).toEqual(["b", "c", "d"]);
  });

  it("keeps what was already selected", () => {
    const out = rangeSelection(order, "b", "c", new Set(["e"]));
    expect([...out].sort()).toEqual(["b", "c", "e"]);
  });

  it("selects just the target when there is no anchor", () => {
    expect([...rangeSelection(order, null, "c", new Set())]).toEqual(["c"]);
  });

  it("handles an anchor that is no longer in the grid", () => {
    expect([...rangeSelection(order, "zz", "c", new Set())]).toEqual(["c"]);
  });

  it("ignores a target that is not in the grid", () => {
    expect([...rangeSelection(order, "a", "zz", new Set(["a"]))]).toEqual(["a"]);
  });

  it("handles anchor and target being the same tile", () => {
    expect([...rangeSelection(order, "c", "c", new Set())]).toEqual(["c"]);
  });
});
