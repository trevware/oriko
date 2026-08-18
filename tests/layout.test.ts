import { describe, expect, it } from "vitest";
import { columnsForWidth, computeLayout, pressureAt, visibleRange } from "../src/layout";
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
