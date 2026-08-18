import { describe, expect, it } from "vitest";
import { clampPan, fitZoomRange } from "../src/viewer";

describe("fitZoomRange", () => {
  it("lets a large image zoom up to its native pixels", () => {
    const range = fitZoomRange({ width: 3000, height: 2000 }, { width: 900, height: 600 });
    expect(range.min).toBe(1);
    expect(range.max).toBeCloseTo(3.3333, 3);
  });

  it("does not zoom an image already shown at native size", () => {
    expect(fitZoomRange({ width: 900, height: 600 }, { width: 900, height: 600 })).toEqual({
      min: 1,
      max: 1,
    });
  });

  it("does not zoom an image smaller than its fitted box", () => {
    // Upscaled to fit already; there is no further detail to reveal.
    expect(fitZoomRange({ width: 400, height: 300 }, { width: 900, height: 675 })).toEqual({
      min: 1,
      max: 1,
    });
  });

  it("survives a zero-width fitted box without returning Infinity", () => {
    expect(fitZoomRange({ width: 3000, height: 2000 }, { width: 0, height: 0 })).toEqual({
      min: 1,
      max: 1,
    });
  });

  it("survives a zero-width source", () => {
    expect(fitZoomRange({ width: 0, height: 0 }, { width: 900, height: 600 })).toEqual({
      min: 1,
      max: 1,
    });
  });
});

describe("clampPan", () => {
  const frame = { width: 100, height: 100 };

  it("locks panning entirely at fit", () => {
    expect(clampPan({ x: 40, y: -70, zoom: 1 }, frame)).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  it("allows panning up to the far edge when zoomed", () => {
    // At 2x the content is 200 wide in a 100 frame, so x may run to -100.
    expect(clampPan({ x: -60, y: -30, zoom: 2 }, frame)).toEqual({ x: -60, y: -30, zoom: 2 });
  });

  it("stops the content pulling away from the leading edge", () => {
    expect(clampPan({ x: 25, y: 40, zoom: 2 }, frame)).toEqual({ x: 0, y: 0, zoom: 2 });
  });

  it("stops the content pulling away from the trailing edge", () => {
    expect(clampPan({ x: -400, y: -400, zoom: 2 }, frame)).toEqual({
      x: -100,
      y: -100,
      zoom: 2,
    });
  });

  it("keeps the frame covered at fractional zoom", () => {
    const panned = clampPan({ x: -999, y: -999, zoom: 1.5 }, frame);
    expect(panned.x).toBeCloseTo(-50);
    expect(panned.y).toBeCloseTo(-50);
  });

  it("leaves the zoom untouched", () => {
    expect(clampPan({ x: 0, y: 0, zoom: 2.75 }, frame).zoom).toBe(2.75);
  });
});
