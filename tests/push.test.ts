import { describe, expect, it } from "vitest";
import { cardsBelow } from "../src/core/push";
import type { Position } from "../src/core/layout";

const at = (id: string, x: number, y: number, w = 100, h = 100): Position => ({ id, x, y, w, h });

describe("cardsBelow", () => {
  // Three columns, 106px apart.
  const wall = [
    at("a", 0, 0),
    at("b", 106, 0),
    at("c", 212, 0),
    at("a2", 0, 106),
    at("b2", 106, 106),
    at("a3", 0, 212),
    at("wide", 106, 212, 206), // spans columns two and three
    at("c4", 212, 318),
    at("a4", 0, 318),
  ];

  it("moves the rest of the opened card's column", () => {
    expect(cardsBelow(wall, wall[0])).toEqual(new Set(["a2", "a3", "a4"]));
  });

  it("takes a wide card's other column along with it", () => {
    const moved = cardsBelow(wall, wall[1]);
    expect(moved).toEqual(new Set(["b2", "wide", "c4"]));
    // c sits above the opened card's bottom edge and stays put.
    expect(moved.has("c")).toBe(false);
  });

  it("leaves cards past the reach where they are", () => {
    expect(cardsBelow(wall, wall[0], 250)).toEqual(new Set(["a2", "a3"]));
  });

  it("never moves the opened card itself", () => {
    expect(cardsBelow(wall, wall[3]).has("a2")).toBe(false);
  });

  it("stays quick on a large wall", () => {
    const positions: Position[] = [];
    for (let i = 0; i < 4000; i++) positions.push(at(`t${i}`, (i % 5) * 106, Math.floor(i / 5) * 106));
    const started = performance.now();
    for (let i = 0; i < 20; i++) cardsBelow(positions, positions[2], 2000);
    expect((performance.now() - started) / 20).toBeLessThan(5);
  });
});
