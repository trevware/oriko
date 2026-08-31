import { describe, expect, it } from "vitest";
import {
  DETAIL_PADDING,
  DETAIL_SIDEBAR,
  STACK_PADDING,
  STACK_SHARE,
  clampPan,
  DETAIL_META_MIN_RUN,
  detailLayout,
  fitZoomRange,
} from "../src/core/viewer";

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

describe("detailLayout", () => {
  const square = { width: 2400, height: 2400 };

  it("puts the details beside the picture in a wide pane", () => {
    const layout = detailLayout(square, { width: 1400, height: 900 });
    expect(layout.mode).toBe("beside");
    // The picture sits in the space left of the sidebar, padded.
    expect(layout.stage.h).toBe(900 - 2 * DETAIL_PADDING);
    expect(layout.meta.x).toBeGreaterThanOrEqual(layout.stage.x + layout.stage.w);
    expect(layout.meta.y).toBe(layout.stage.y);
    expect(layout.meta.width).toBe(DETAIL_SIDEBAR);
  });

  it("stacks the details under the picture when beside would squeeze it", () => {
    const layout = detailLayout(square, { width: 420, height: 900 });
    expect(layout.mode).toBe("stacked");
    // The picture takes the pane's width, so it is at least as big as the
    // tile it opened from rather than a thumbnail in a corner.
    expect(layout.stage.w).toBe(420 - 2 * STACK_PADDING);
    expect(layout.stage.x).toBe(STACK_PADDING);
    expect(layout.meta.y).toBeGreaterThanOrEqual(layout.stage.y + layout.stage.h);
    expect(layout.meta.x).toBe(layout.stage.x);
    expect(layout.meta.width).toBe(layout.stage.w);
  });

  it("caps a tall picture so the details still have room beneath it", () => {
    const portrait = { width: 1000, height: 3000 };
    const layout = detailLayout(portrait, { width: 420, height: 900 });
    expect(layout.mode).toBe("stacked");
    expect(layout.stage.h).toBeLessThanOrEqual(900 * STACK_SHARE);
    expect(layout.stage.x + layout.stage.w / 2).toBeCloseTo(210, 5);
  });

  it("never produces a zero-width stage, however narrow the pane", () => {
    const layout = detailLayout(square, { width: 120, height: 600 });
    expect(layout.stage.w).toBeGreaterThan(0);
  });
});

describe("detailLayout meta clamp", () => {
  it("keeps the details column from starting too low beside a small picture", () => {
    // A tiny image centers deep down the pane; the details are capped so a
    // useful run of fields always fits above the action bar.
    const layout = detailLayout({ width: 200, height: 150 }, { width: 1400, height: 900 });
    expect(layout.mode).toBe("beside");
    expect(layout.meta.y).toBeLessThanOrEqual(900 - DETAIL_META_MIN_RUN);
  });

  it("still aligns the details with a tall picture's top", () => {
    const layout = detailLayout({ width: 900, height: 1400 }, { width: 1400, height: 900 });
    expect(layout.mode).toBe("beside");
    expect(layout.meta.y).toBe(layout.stage.y);
  });

  it("never lifts the details above the pane padding", () => {
    const layout = detailLayout({ width: 200, height: 150 }, { width: 1400, height: 420 });
    expect(layout.meta.y).toBeGreaterThanOrEqual(DETAIL_PADDING);
  });
});
