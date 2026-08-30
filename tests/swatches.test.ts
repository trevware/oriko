import { describe, expect, it } from "vitest";
import { extractSwatches } from "../src/core/swatches";

type Rgba = [number, number, number, number];

/** Builds a flat RGBA buffer from runs of [r, g, b, a] repeated `count` times. */
function pixels(...runs: Array<{ color: Rgba; count: number }>): Uint8ClampedArray {
  const total = runs.reduce((sum, run) => sum + run.count, 0);
  const buffer = new Uint8ClampedArray(total * 4);
  let at = 0;
  for (const run of runs) {
    for (let i = 0; i < run.count; i++) {
      buffer.set(run.color, at);
      at += 4;
    }
  }
  return buffer;
}

const opaque = (r: number, g: number, b: number): Rgba => [r, g, b, 255];

describe("extractSwatches", () => {
  it("returns nothing for an empty buffer", () => {
    expect(extractSwatches(new Uint8ClampedArray(0))).toEqual([]);
  });

  it("returns one uppercase hex for a solid colour", () => {
    const swatches = extractSwatches(pixels({ color: opaque(255, 0, 0), count: 100 }));
    expect(swatches).toEqual(["#FF0000"]);
  });

  it("keeps two clearly different colours apart", () => {
    const swatches = extractSwatches(
      pixels(
        { color: opaque(255, 0, 0), count: 100 },
        { color: opaque(0, 0, 255), count: 100 }
      )
    );
    expect(swatches).toHaveLength(2);
    expect(new Set(swatches)).toEqual(new Set(["#FF0000", "#0000FF"]));
  });

  it("collapses colours too close to tell apart", () => {
    const swatches = extractSwatches(
      pixels(
        { color: opaque(100, 100, 100), count: 200 },
        { color: opaque(118, 118, 118), count: 100 }
      )
    );
    expect(swatches).toEqual(["#646464"]);
  });

  it("collapses a ladder of greys that read as the same tone", () => {
    // A UI screenshot is mostly one grey in several shades. Left alone these
    // eat most of the row and the picture's actual accents never appear.
    const swatches = extractSwatches(
      pixels(
        { color: opaque(238, 238, 238), count: 300 },
        { color: opaque(201, 202, 202), count: 200 }
      )
    );
    expect(swatches).toEqual(["#EEEEEE"]);
  });

  it("orders by how much of the picture a colour covers", () => {
    const swatches = extractSwatches(
      pixels(
        { color: opaque(128, 128, 128), count: 300 },
        { color: opaque(255, 0, 0), count: 50 }
      )
    );
    expect(swatches).toEqual(["#808080", "#FF0000"]);
  });

  it("lets a small vibrant area outrank a larger flat grey", () => {
    const swatches = extractSwatches(
      pixels(
        { color: opaque(128, 128, 128), count: 300 },
        { color: opaque(255, 0, 0), count: 100 }
      )
    );
    expect(swatches[0]).toBe("#FF0000");
  });

  it("does not let a black border crowd out the picture's colours", () => {
    const swatches = extractSwatches(
      pixels(
        { color: opaque(5, 5, 5), count: 300 },
        { color: opaque(255, 0, 0), count: 60 }
      )
    );
    expect(swatches[0]).toBe("#FF0000");
  });

  it("ignores transparent pixels", () => {
    const swatches = extractSwatches(
      pixels(
        { color: [0, 0, 255, 0], count: 500 },
        { color: opaque(255, 0, 0), count: 40 }
      )
    );
    expect(swatches).toEqual(["#FF0000"]);
  });

  it("never returns more than the requested count", () => {
    const swatches = extractSwatches(
      pixels(
        { color: opaque(255, 0, 0), count: 100 },
        { color: opaque(0, 255, 0), count: 90 },
        { color: opaque(0, 0, 255), count: 80 },
        { color: opaque(255, 255, 0), count: 70 }
      ),
      2
    );
    expect(swatches).toHaveLength(2);
  });

  it("defaults to at most eight swatches", () => {
    const runs = Array.from({ length: 20 }, (_, i) => ({
      color: opaque((i * 37) % 256, (i * 91) % 256, (i * 143) % 256),
      count: 100 - i,
    }));
    expect(extractSwatches(pixels(...runs)).length).toBeLessThanOrEqual(8);
  });
});
