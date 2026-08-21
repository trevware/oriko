import { describe, expect, it } from "vitest";
import {
  columnsForWidth,
  computeLayout,
  fitRect,
  flightMidpoint,
  flipOffsets,
  flipTransform,
  cursorAfterNarrowing,
  groupedMenu,
  dragSteps,
  moveInGrid,
  offsetToward,
  pressureAt,
  shouldMountAll,
  stepCursor,
  visibleRange,
} from "../src/layout";
import type { LayoutItem } from "../src/layout";

const square = (id: string): LayoutItem => ({ id, width: 100, height: 100 });

describe("columnsForWidth", () => {
  it("fits as many target-width columns as it can", () => {
    expect(columnsForWidth(1000, 300, 16)).toBe(3);
  });

  it("never returns fewer than one column", () => {
    expect(columnsForWidth(100, 300, 16)).toBe(1);
  });

  it("handles a zero-width container without dividing by zero", () => {
    expect(columnsForWidth(0, 300, 16)).toBe(1);
  });
});

describe("computeLayout", () => {
  it("divides the container evenly, accounting for gaps", () => {
    const { positions } = computeLayout([square("a"), square("b")], 1016, 2, 16);
    expect(positions[0].w).toBe(500);
    expect(positions[0].x).toBe(0);
    expect(positions[1].x).toBe(516);
  });

  it("scales height to preserve aspect ratio", () => {
    const { positions } = computeLayout([{ id: "a", width: 1000, height: 500 }], 500, 1, 0);
    expect(positions[0].w).toBe(500);
    expect(positions[0].h).toBe(250);
  });

  it("places each item in the shortest column", () => {
    const items: LayoutItem[] = [
      { id: "tall", width: 100, height: 400 },
      { id: "short", width: 100, height: 100 },
      { id: "next", width: 100, height: 100 },
    ];
    const { positions } = computeLayout(items, 200, 2, 0);
    const next = positions.find((p) => p.id === "next")!;
    expect(next.x).toBe(100);
    expect(next.y).toBe(100);
  });

  it("reports total height as the tallest column", () => {
    const items: LayoutItem[] = [
      { id: "a", width: 100, height: 300 },
      { id: "b", width: 100, height: 100 },
    ];
    const { totalHeight } = computeLayout(items, 200, 2, 0);
    expect(totalHeight).toBe(300);
  });

  it("is deterministic: same input, same positions", () => {
    const items = [square("a"), square("b"), square("c")];
    const first = computeLayout(items, 500, 3, 8);
    const second = computeLayout(items, 500, 3, 8);
    expect(first).toEqual(second);
  });

  it("never overlaps two items in the same column", () => {
    const items = Array.from({ length: 30 }, (_, i) => ({
      id: `i${i}`,
      width: 100,
      height: 50 + (i % 7) * 30,
    }));
    const { positions } = computeLayout(items, 400, 4, 10);
    for (const a of positions) {
      for (const b of positions) {
        if (a.id === b.id || a.x !== b.x) continue;
        const overlaps = a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlaps).toBe(false);
      }
    }
  });

  it("keeps every item inside the container width", () => {
    const items = Array.from({ length: 20 }, (_, i) => square(`i${i}`));
    const { positions } = computeLayout(items, 1000, 4, 12);
    for (const p of positions) expect(p.x + p.w).toBeLessThanOrEqual(1000);
  });

  it("handles an empty list", () => {
    expect(computeLayout([], 500, 3, 8)).toEqual({ positions: [], totalHeight: 0 });
  });

  it("falls back to a square for zero-dimension items", () => {
    const { positions } = computeLayout([{ id: "a", width: 0, height: 0 }], 300, 1, 0);
    expect(positions[0].h).toBe(300);
  });

  it("stays fast at five hundred items", () => {
    const items = Array.from({ length: 500 }, (_, i) => ({
      id: `i${i}`,
      width: 400,
      height: 200 + (i % 5) * 80,
    }));
    const start = performance.now();
    computeLayout(items, 1400, 4, 14);
    expect(performance.now() - start).toBeLessThan(20);
  });
});

describe("visibleRange", () => {
  const positions = Array.from({ length: 100 }, (_, i) => ({
    id: `i${i}`,
    x: 0,
    y: i * 100,
    w: 100,
    h: 100,
  }));

  it("returns only what intersects the viewport plus overscan", () => {
    // Overscan band is [800, 1700]. The tile at y=700 ends exactly at 800,
    // so it touches the band and must render; y=600 ends at 700 and must not.
    const visible = visibleRange(positions, 1000, 500, 200);
    expect(visible[0].y).toBe(700);
    expect(visible[visible.length - 1].y).toBe(1700);
    expect(visible.map((p) => p.y)).not.toContain(600);
  });

  it("clamps at the top", () => {
    const visible = visibleRange(positions, 0, 300, 200);
    expect(visible[0].id).toBe("i0");
  });

  it("clamps at the bottom", () => {
    const visible = visibleRange(positions, 9500, 500, 200);
    expect(visible[visible.length - 1].id).toBe("i99");
  });

  it("returns nothing for an empty layout", () => {
    expect(visibleRange([], 0, 500, 200)).toEqual([]);
  });

  it("renders a small fraction of a large layout", () => {
    const visible = visibleRange(positions, 5000, 800, 600);
    expect(visible.length).toBeLessThan(25);
  });
});

describe("shouldMountAll", () => {
  it("keeps a wall smaller than the budget whole", () => {
    expect(shouldMountAll(42, 150)).toBe(true);
  });

  it("includes a wall sitting exactly on the budget", () => {
    expect(shouldMountAll(150, 150)).toBe(true);
  });

  it("hands anything past the budget back to the window", () => {
    expect(shouldMountAll(151, 150)).toBe(false);
    expect(shouldMountAll(5000, 150)).toBe(false);
  });

  it("is untroubled by an empty wall", () => {
    // Either answer renders nothing, so this pins the behaviour rather than
    // asking the caller to special-case it.
    expect(shouldMountAll(0, 150)).toBe(true);
  });
});

describe("moveInGrid", () => {
  // Fourteen over six columns: two full rows and a short one, which is the
  // shape that makes the awkward cases exist at all.
  const COUNT = 14;
  const COLS = 6;
  const right = (i: number): number => moveInGrid(i, { columns: 1, rows: 0 }, COUNT, COLS);
  const left = (i: number): number => moveInGrid(i, { columns: -1, rows: 0 }, COUNT, COLS);
  const down = (i: number): number => moveInGrid(i, { columns: 0, rows: 1 }, COUNT, COLS);
  const up = (i: number): number => moveInGrid(i, { columns: 0, rows: -1 }, COUNT, COLS);

  it("steps along a row", () => {
    expect(right(0)).toBe(1);
    expect(left(3)).toBe(2);
  });

  it("reads on into the next row rather than stopping at the edge", () => {
    expect(right(5)).toBe(6);
    expect(left(6)).toBe(5);
  });

  it("wraps the ends of the whole set", () => {
    expect(right(COUNT - 1)).toBe(0);
    expect(left(0)).toBe(COUNT - 1);
  });

  it("steps a whole row vertically, staying in its column", () => {
    expect(down(3)).toBe(9);
    expect(up(9)).toBe(3);
  });

  it("keeps its column wrapping top to bottom", () => {
    // Column 0 reaches the short last row, so it wraps the full height.
    expect(up(0)).toBe(12);
    expect(down(12)).toBe(0);
  });

  it("lands on the nearest swatch a column has, never in the gap", () => {
    // Column 3 stops at row 1, so wrapping goes there rather than to the
    // fourth swatch of a short row that has only two.
    expect(up(3)).toBe(9);
    expect(down(9)).toBe(3);
  });

  it("always lands somewhere real", () => {
    for (let i = 0; i < COUNT; i++) {
      for (const step of [right, left, down, up]) {
        expect(step(i)).toBeGreaterThanOrEqual(0);
        expect(step(i)).toBeLessThan(COUNT);
      }
    }
  });

  it("covers the whole set given enough steps along a row", () => {
    const seen = new Set<number>();
    let at = 0;
    for (let i = 0; i < COUNT; i++) {
      seen.add(at);
      at = right(at);
    }
    expect(seen.size).toBe(COUNT);
  });

  it("survives a single row, where vertical movement has nowhere to go", () => {
    expect(moveInGrid(2, { columns: 0, rows: 1 }, 4, 6)).toBe(2);
    expect(moveInGrid(2, { columns: 0, rows: -1 }, 4, 6)).toBe(2);
    expect(moveInGrid(2, { columns: 1, rows: 0 }, 4, 6)).toBe(3);
  });

  it("handles the exactly-rectangular case with no short row", () => {
    // Thirty over six is the real grid: five full rows, no gap to fall into.
    expect(moveInGrid(0, { columns: 0, rows: -1 }, 30, 6)).toBe(24);
    expect(moveInGrid(24, { columns: 0, rows: 1 }, 30, 6)).toBe(0);
    expect(moveInGrid(29, { columns: 1, rows: 0 }, 30, 6)).toBe(0);
  });

  it("holds at nothing for an empty set", () => {
    expect(moveInGrid(0, { columns: 1, rows: 0 }, 0, 6)).toBe(0);
  });

  it("clamps an index that has fallen outside the set", () => {
    expect(moveInGrid(99, { columns: 0, rows: 0 }, COUNT, COLS)).toBe(COUNT - 1);
  });
});

describe("offsetToward", () => {
  // A 200 wide row centred at 100, and a 60 wide label: 70 of slack a side.
  const W = 200;
  const C = 100;
  const ITEM = 60;

  it("does not move for a target already at the centre", () => {
    expect(offsetToward(100, C, W, ITEM)).toBe(0);
  });

  it("follows a target across the row", () => {
    expect(offsetToward(140, C, W, ITEM)).toBe(40);
    expect(offsetToward(60, C, W, ITEM)).toBe(-40);
  });

  it("stops at the edge rather than hanging outside", () => {
    expect(offsetToward(200, C, W, ITEM)).toBe(70);
    expect(offsetToward(0, C, W, ITEM)).toBe(-70);
  });

  it("stays centred when the label is wider than the row", () => {
    expect(offsetToward(180, C, W, 400)).toBe(0);
  });

  it("stays centred when there is no slack at all", () => {
    expect(offsetToward(180, C, W, W)).toBe(0);
  });
});

describe("flipOffsets", () => {
  it("reports how far back a row must be pushed to look unmoved", () => {
    const before = new Map([["a", 0], ["b", 40]]);
    const after = new Map([["a", 40], ["b", 0]]);
    expect(flipOffsets(before, after)).toEqual(new Map([["a", -40], ["b", 40]]));
  });

  it("says nothing about rows that did not move", () => {
    const same = new Map([["a", 0], ["b", 40]]);
    expect(flipOffsets(same, same).size).toBe(0);
  });

  it("ignores a sub-pixel difference, which is rounding and not movement", () => {
    const before = new Map([["a", 10]]);
    const after = new Map([["a", 10.2]]);
    expect(flipOffsets(before, after).size).toBe(0);
  });

  it("skips a row that has only just appeared", () => {
    // It has nowhere to come from, so there is nothing to animate.
    const before = new Map([["a", 0]]);
    const after = new Map([["a", 0], ["b", 40]]);
    expect(flipOffsets(before, after).has("b")).toBe(false);
  });

  it("skips a row that has gone", () => {
    const before = new Map([["a", 0], ["b", 40]]);
    const after = new Map([["a", 40]]);
    const out = flipOffsets(before, after);
    expect(out.has("b")).toBe(false);
    expect(out.get("a")).toBe(-40);
  });

  it("has nothing to say about an empty list", () => {
    expect(flipOffsets(new Map(), new Map()).size).toBe(0);
  });
});

describe("dragSteps", () => {
  const H = 40;
  const T = 0.75;

  it("stays put until the threshold is crossed", () => {
    expect(dragSteps(0, H, T)).toBe(0);
    expect(dragSteps(29, H, T)).toBe(0);
    expect(dragSteps(-29, H, T)).toBe(0);
  });

  it("counts a row once the threshold is met", () => {
    expect(dragSteps(30, H, T)).toBe(1);
    expect(dragSteps(-30, H, T)).toBe(-1);
  });

  it("counts further rows as the drag continues", () => {
    expect(dragSteps(70, H, T)).toBe(2);
    expect(dragSteps(-110, H, T)).toBe(-3);
  });

  it("behaves as rounding when the threshold is a half", () => {
    expect(dragSteps(19, H, 0.5)).toBe(0);
    expect(dragSteps(20, H, 0.5)).toBe(1);
  });

  it("does not move on a row of no height", () => {
    expect(dragSteps(100, 0, T)).toBe(0);
  });

  it("is symmetric about the grab", () => {
    for (const dy of [5, 33, 61, 94]) {
      const down = dragSteps(dy, H, T);
      // Negating zero would give -0, which is the same number to arithmetic
      // and a different one to the comparison this makes.
      expect(dragSteps(-dy, H, T)).toBe(down === 0 ? 0 : -down);
    }
  });
});

describe("stepCursor", () => {
  const all = [true, true, true, true];

  it("steps forward and back", () => {
    expect(stepCursor(1, 1, all)).toBe(2);
    expect(stepCursor(1, -1, all)).toBe(0);
  });

  it("wraps at both ends", () => {
    expect(stepCursor(3, 1, all)).toBe(0);
    expect(stepCursor(0, -1, all)).toBe(3);
  });

  it("enters at the end the key points at", () => {
    // From no cursor, Down should land on the top row and Up on the bottom.
    expect(stepCursor(-1, 1, all)).toBe(0);
    expect(stepCursor(-1, -1, all)).toBe(3);
  });

  it("passes over inert rows", () => {
    const gap = [true, false, false, true];
    expect(stepCursor(0, 1, gap)).toBe(3);
    expect(stepCursor(3, 1, gap)).toBe(0);
    expect(stepCursor(0, -1, gap)).toBe(3);
  });

  it("stays put when nothing can be reached", () => {
    expect(stepCursor(2, 1, [false, false, false])).toBe(2);
  });

  it("has nowhere to go in an empty list", () => {
    expect(stepCursor(0, 1, [])).toBe(-1);
  });
});

describe("cursorAfterNarrowing", () => {
  const all = [true, true, true];

  it("takes the first row once something has been typed", () => {
    // Which is the top match when the query matched, and the row offering to
    // create what was typed when it did not.
    expect(cursorAfterNarrowing(all, 2, true)).toBe(0);
    expect(cursorAfterNarrowing([true], -1, true)).toBe(0);
  });

  it("leaves an untouched list unlit", () => {
    // A submenu opened by pointing at it should not look already answered.
    expect(cursorAfterNarrowing(all, -1, false)).toBe(-1);
  });

  it("holds a cursor that is still on a real row", () => {
    expect(cursorAfterNarrowing(all, 2, false)).toBe(2);
  });

  it("rescues a cursor that has fallen off the end", () => {
    expect(cursorAfterNarrowing(all, 9, false)).toBe(0);
  });

  it("rescues a cursor left on a row that went inert", () => {
    expect(cursorAfterNarrowing([true, false, true], 1, false)).toBe(0);
  });

  it("reports no cursor when there is nothing to put one on", () => {
    expect(cursorAfterNarrowing([], 0, true)).toBe(-1);
    expect(cursorAfterNarrowing([false, false], 0, true)).toBe(-1);
  });
});

describe("groupedMenu", () => {
  const row = (label: string): { label: string; divider?: boolean } => ({ label });

  it("rules every group off from the one before", () => {
    const out = groupedMenu([[row("a"), row("b")], [row("c")], [row("d")]]);
    expect(out.map((r) => [r.label, r.divider ?? false])).toEqual([
      ["a", false],
      ["b", false],
      ["c", true],
      ["d", true],
    ]);
  });

  it("never rules off the leading group", () => {
    const out = groupedMenu([[row("a")]]);
    expect(out[0].divider).toBeUndefined();
  });

  it("takes an empty group's rule away with it", () => {
    // The case the wall actually hits: a multi-selection drops every property
    // row, and the rule that would have introduced them must go too.
    const out = groupedMenu([[row("a")], [], [row("b")]]);
    expect(out.map((r) => r.label)).toEqual(["a", "b"]);
    expect(out[1].divider).toBe(true);
  });

  it("promotes the first surviving group rather than ruling it off", () => {
    const out = groupedMenu([[], [row("a")], [row("b")]]);
    expect(out[0].divider).toBeUndefined();
    expect(out[1].divider).toBe(true);
  });

  it("leaves the rows it was given alone", () => {
    const first = row("a");
    const second = row("b");
    groupedMenu([[first], [second]]);
    expect(first.divider).toBeUndefined();
    expect(second.divider).toBeUndefined();
  });

  it("has nothing to say about no groups at all", () => {
    expect(groupedMenu([[], []])).toEqual([]);
  });
});

describe("pressureAt", () => {
  const box = { x: 100, y: 100, w: 200, h: 100 };

  it("is neutral at the centre", () => {
    expect(pressureAt({ x: 200, y: 150 }, box)).toEqual({ dx: 0, dy: 0 });
  });

  it("reaches the extremes at the corners", () => {
    expect(pressureAt({ x: 100, y: 100 }, box)).toEqual({ dx: -1, dy: -1 });
    expect(pressureAt({ x: 300, y: 200 }, box)).toEqual({ dx: 1, dy: 1 });
  });

  it("separates the two axes", () => {
    expect(pressureAt({ x: 300, y: 150 }, box)).toEqual({ dx: 1, dy: 0 });
    expect(pressureAt({ x: 200, y: 100 }, box)).toEqual({ dx: 0, dy: -1 });
  });

  it("returns null outside the card", () => {
    expect(pressureAt({ x: 99, y: 150 }, box)).toBeNull();
    expect(pressureAt({ x: 200, y: 201 }, box)).toBeNull();
  });

  it("returns null for a degenerate box", () => {
    expect(pressureAt({ x: 0, y: 0 }, { x: 0, y: 0, w: 0, h: 0 })).toBeNull();
  });

  it("scales with the card, not with pixels", () => {
    const wide = { x: 0, y: 0, w: 1000, h: 100 };
    expect(pressureAt({ x: 750, y: 50 }, wide)?.dx).toBeCloseTo(0.5, 6);
  });
});

describe("fitRect", () => {
  const bounds = { width: 1000, height: 800 };

  it("fits a landscape image by width", () => {
    const box = fitRect({ width: 2000, height: 1000 }, bounds);
    expect(box.w).toBe(1000);
    expect(box.h).toBe(500);
  });

  it("fits a portrait image by height", () => {
    const box = fitRect({ width: 1000, height: 2000 }, bounds);
    expect(box.h).toBe(800);
    expect(box.w).toBe(400);
  });

  it("centres what it fits", () => {
    const box = fitRect({ width: 1000, height: 2000 }, bounds);
    expect(box.x).toBe((1000 - box.w) / 2);
    expect(box.y).toBe(0);
  });

  it("honours padding", () => {
    expect(fitRect({ width: 1000, height: 1000 }, bounds, 50).h).toBe(700);
  });

  it("falls back to a sane ratio for unknown dimensions", () => {
    const box = fitRect({ width: 0, height: 0 }, bounds);
    expect(box.w).toBeGreaterThan(0);
    expect(box.h).toBeGreaterThan(0);
  });
});

describe("flipTransform", () => {
  const from = { x: 100, y: 100, w: 200, h: 100 };
  const to = { x: 0, y: 0, w: 800, h: 400 };

  it("scales by the ratio between the boxes", () => {
    const t = flipTransform(from, to, { x: 0.5, y: 0.5 });
    expect(t.scaleX).toBeCloseTo(0.25, 6);
    expect(t.scaleY).toBeCloseTo(0.25, 6);
  });

  it("places the source centre over the destination centre", () => {
    const t = flipTransform(from, to, { x: 0.5, y: 0.5 });
    expect(t.dx).toBeCloseTo(200 - 400, 6);
    expect(t.dy).toBeCloseTo(150 - 200, 6);
  });

  it("changes trajectory with the click position", () => {
    const centre = flipTransform(from, to, { x: 0.5, y: 0.5 });
    const corner = flipTransform(from, to, { x: 0, y: 0 });
    expect(corner.dx).not.toBeCloseTo(centre.dx, 3);
    expect(corner.dy).not.toBeCloseTo(centre.dy, 3);
  });

  it("pins a top-left click to the top-left corners", () => {
    const t = flipTransform(from, to, { x: 0, y: 0 });
    expect(t.dx).toBeCloseTo(from.x - to.x, 6);
    expect(t.dy).toBeCloseTo(from.y - to.y, 6);
  });

  it("survives a zero-sized destination", () => {
    const t = flipTransform(from, { x: 0, y: 0, w: 0, h: 0 }, { x: 0.5, y: 0.5 });
    expect(t.scaleX).toBe(1);
    expect(t.scaleY).toBe(1);
  });
});

describe("flightMidpoint", () => {
  const to = { x: 300, y: 200, w: 600, h: 400 };

  it("sits between the endpoints, not on the straight line", () => {
    const from = { x: 0, y: 200, w: 100, h: 60 };
    const mid = flightMidpoint(from, to, { x: 0.5, y: 0.5 });
    const end = flipTransform(from, to, { x: 0.5, y: 0.5 });
    // Travelling horizontally, so the bow shows up on the vertical axis.
    expect(Math.abs(mid.dx)).toBeLessThan(Math.abs(end.dx));
    expect(Math.abs(mid.dy - end.dy)).toBeGreaterThan(0);
  });

  it("bows perpendicular to a vertical journey", () => {
    const from = { x: 300, y: 900, w: 100, h: 60 };
    const mid = flightMidpoint(from, to, { x: 0.5, y: 0.5 });
    const end = flipTransform(from, to, { x: 0.5, y: 0.5 });
    expect(Math.abs(mid.dx - end.dx)).toBeGreaterThan(1);
  });

  it("stretches along the direction of travel", () => {
    const across = { x: 0, y: 200, w: 100, h: 60 };
    const midAcross = flightMidpoint(across, to, { x: 0.5, y: 0.5 });
    expect(midAcross.scaleX).toBeGreaterThan(midAcross.scaleY);

    const down = { x: 300, y: 1200, w: 100, h: 60 };
    const midDown = flightMidpoint(down, to, { x: 0.5, y: 0.5 });
    expect(midDown.scaleY).toBeGreaterThan(midDown.scaleX);
  });

  it("has grown most of the way by the midpoint", () => {
    const from = { x: 0, y: 0, w: 60, h: 40 };
    const mid = flightMidpoint(from, to, { x: 0.5, y: 0.5 });
    const end = flipTransform(from, to, { x: 0.5, y: 0.5 });
    expect(mid.scaleX).toBeGreaterThan(end.scaleX);
    expect(mid.scaleX).toBeLessThan(1.2);
  });

  it("does not divide by zero when there is nowhere to travel", () => {
    const same = { x: 300, y: 200, w: 600, h: 400 };
    const mid = flightMidpoint(same, to, { x: 0.5, y: 0.5 });
    expect(Number.isFinite(mid.dx)).toBe(true);
    expect(Number.isFinite(mid.dy)).toBe(true);
  });

  it("caps the bow so a long journey does not sling wide", () => {
    const far = { x: -5000, y: 200, w: 100, h: 60 };
    const progress = 0.58;
    const mid = flightMidpoint(far, to, { x: 0.5, y: 0.5 }, progress);
    const end = flipTransform(far, to, { x: 0.5, y: 0.5 });

    // The bow is the deviation from the straight line at the same progress,
    // not the total offset, which also carries the journey itself.
    const straightX = end.dx * (1 - progress);
    const straightY = end.dy * (1 - progress);
    const bow = Math.hypot(mid.dx - straightX, mid.dy - straightY);
    expect(bow).toBeLessThanOrEqual(111);
  });

  it("bows proportionally on a short journey", () => {
    const near = { x: 260, y: 160, w: 100, h: 60 };
    const progress = 0.58;
    const mid = flightMidpoint(near, to, { x: 0.5, y: 0.5 }, progress);
    const end = flipTransform(near, to, { x: 0.5, y: 0.5 });
    const bow = Math.hypot(
      mid.dx - end.dx * (1 - progress),
      mid.dy - end.dy * (1 - progress)
    );
    expect(bow).toBeGreaterThan(0);
    expect(bow).toBeLessThan(110);
  });
});
