import { describe, expect, it } from "vitest";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  clampCamera,
  clampZoom,
  initialCamera,
  cameraBounds,
  cameraOvershoot,
  decayFactor,
  elasticCamera,
  flingVelocity,
  pinchCamera,
  pinchFactor,
  pinchMidpoint,
  pinchSpan,
  preserveAnchor,
  revealCamera,
  rubberBand,
  toContent,
  visibleContentBand,
  zoomAt,
} from "../src/camera";

const viewport = { width: 1000, height: 800 };
const content = { width: 1000, height: 5000 };

describe("clampZoom", () => {
  it("passes a zoom inside the range through", () => {
    expect(clampZoom(1.5)).toBe(1.5);
  });

  it("clamps below the minimum", () => {
    expect(clampZoom(0.001)).toBe(MIN_ZOOM);
  });

  it("clamps above the maximum", () => {
    expect(clampZoom(99)).toBe(MAX_ZOOM);
  });

  it("returns the minimum for a non-finite zoom", () => {
    expect(clampZoom(Number.NaN)).toBe(MIN_ZOOM);
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(MAX_ZOOM);
  });
});

describe("zoomAt", () => {
  const camera = { x: 0, y: 0, zoom: 1 };

  it("holds the content point under the cursor in place", () => {
    const pointer = { x: 300, y: 400 };
    const before = toContent(camera, pointer);
    const after = toContent(zoomAt(camera, 2, pointer), pointer);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it("holds the anchor when zooming out too", () => {
    const pointer = { x: 700, y: 200 };
    const start = { x: -120, y: -640, zoom: 1.8 };
    const before = toContent(start, pointer);
    const after = toContent(zoomAt(start, 0.5, pointer), pointer);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it("scales the zoom by the factor", () => {
    expect(zoomAt(camera, 2, { x: 0, y: 0 }).zoom).toBe(2);
  });

  it("stops at the maximum", () => {
    expect(zoomAt({ x: 0, y: 0, zoom: MAX_ZOOM }, 2, { x: 0, y: 0 }).zoom).toBe(MAX_ZOOM);
  });

  it("stops at the minimum", () => {
    expect(zoomAt({ x: 0, y: 0, zoom: MIN_ZOOM }, 0.5, { x: 0, y: 0 }).zoom).toBe(MIN_ZOOM);
  });

  it("returns the same camera when the zoom cannot change", () => {
    const pinned = { x: 5, y: 6, zoom: MAX_ZOOM };
    expect(zoomAt(pinned, 4, { x: 0, y: 0 })).toBe(pinned);
  });
});

describe("clampCamera", () => {
  it("stops with the first row against the top of the viewport", () => {
    const out = clampCamera({ x: 0, y: 9999, zoom: 1 }, viewport, content);
    expect(out.y).toBe(0);
  });

  it("stops with the last row against the bottom of the viewport", () => {
    const out = clampCamera({ x: 0, y: -99999, zoom: 1 }, viewport, content);
    expect(out.y).toBe(viewport.height - content.height);
  });

  it("leaves a camera inside the bounds untouched", () => {
    const inside = { x: 0, y: -1000, zoom: 1 };
    expect(clampCamera(inside, viewport, content)).toEqual(inside);
  });

  it("pins a wall shorter than the viewport to the top", () => {
    const small = { width: 200, height: 200 };
    const low = clampCamera({ x: 0, y: -99999, zoom: 1 }, viewport, small);
    const high = clampCamera({ x: 0, y: 99999, zoom: 1 }, viewport, small);
    expect(low.y).toBe(0);
    expect(high.y).toBe(0);
  });

  it("pins the wall to the centre horizontally when it is no wider than the viewport", () => {
    // The wall is laid out at viewport width, so this is the normal case:
    // panning sideways would only ever reveal empty canvas.
    const left = clampCamera({ x: -99999, y: 0, zoom: 1 }, viewport, content);
    const right = clampCamera({ x: 99999, y: 0, zoom: 1 }, viewport, content);
    expect(left.x).toBe(0);
    expect(right.x).toBe(0);
  });

  it("centres a wall that zooming out has made narrower than the viewport", () => {
    const out = clampCamera({ x: 99999, y: 0, zoom: 0.5 }, viewport, content);
    expect(out.x).toBe((viewport.width - content.width * 0.5) / 2);
  });

  it("allows horizontal panning once the wall is wider than the viewport", () => {
    const left = clampCamera({ x: -99999, y: 0, zoom: 2 }, viewport, content);
    const right = clampCamera({ x: 99999, y: 0, zoom: 2 }, viewport, content);
    expect(right.x).toBe(0);
    expect(left.x).toBe(viewport.width - content.width * 2);
  });

  it("accounts for zoom when computing the bottom bound", () => {
    const out = clampCamera({ x: 0, y: -99999, zoom: 0.5 }, viewport, content);
    expect(out.y).toBe(viewport.height - content.height * 0.5);
  });

  it("clamps the zoom as well as the position", () => {
    expect(clampCamera({ x: 0, y: 0, zoom: 99 }, viewport, content).zoom).toBe(MAX_ZOOM);
  });
});

describe("visibleContentBand", () => {
  it("maps the viewport to content space at zoom 1", () => {
    expect(visibleContentBand({ x: 0, y: -500, zoom: 1 }, viewport)).toEqual({
      top: 500,
      height: 800,
    });
  });

  it("covers more content when zoomed out", () => {
    expect(visibleContentBand({ x: 0, y: 0, zoom: 0.5 }, viewport).height).toBe(1600);
  });

  it("covers less content when zoomed in", () => {
    expect(visibleContentBand({ x: 0, y: 0, zoom: 2 }, viewport).height).toBe(400);
  });
});

describe("initialCamera", () => {
  it("starts at the top of the content", () => {
    expect(initialCamera(viewport, content).y).toBe(0);
  });

  it("starts at zoom 1", () => {
    expect(initialCamera(viewport, content).zoom).toBe(1);
  });

  it("centres content narrower than the viewport", () => {
    const out = initialCamera(viewport, { width: 600, height: 400 });
    expect(out.x).toBe(200);
  });
});

describe("preserveAnchor", () => {
  it("keeps an anchor at the same screen position when content shifts down", () => {
    const camera = { x: 0, y: -500, zoom: 1 };
    const moved = preserveAnchor(camera, 600, 900);
    // The anchor was 300px lower after relayout, so the camera rises by 300.
    expect(moved.y).toBe(-800);
    expect(600 * 1 + camera.y).toBe(900 * 1 + moved.y);
  });

  it("accounts for zoom", () => {
    const camera = { x: 0, y: -500, zoom: 2 };
    const moved = preserveAnchor(camera, 600, 900);
    expect(600 * 2 + camera.y).toBe(900 * 2 + moved.y);
  });

  it("does nothing when the anchor did not move", () => {
    const camera = { x: 0, y: -500, zoom: 1 };
    expect(preserveAnchor(camera, 600, 600)).toEqual(camera);
  });

  it("leaves x and zoom untouched", () => {
    const moved = preserveAnchor({ x: 40, y: -500, zoom: 1.5 }, 100, 200);
    expect(moved.x).toBe(40);
    expect(moved.zoom).toBe(1.5);
  });

  it("ignores a non-finite anchor rather than flinging the camera", () => {
    const camera = { x: 0, y: -500, zoom: 1 };
    expect(preserveAnchor(camera, Number.NaN, 900)).toEqual(camera);
  });
});

describe("pinchFactor", () => {
  it("turns a wheel delta into a multiplicative zoom step", () => {
    expect(pinchFactor(0)).toBe(1);
    expect(pinchFactor(-100)).toBeCloseTo(Math.exp(1), 6);
    expect(pinchFactor(100)).toBeCloseTo(Math.exp(-1), 6);
  });

  it("is symmetric: a pinch in undoes a pinch out", () => {
    expect(pinchFactor(-37) * pinchFactor(37)).toBeCloseTo(1, 9);
  });
});

describe("revealCamera", () => {
  const viewport = { width: 1000, height: 800 };
  const content = { width: 1000, height: 5000 };
  const small = { x: 0, y: 4000, w: 100, h: 100 };

  it("zooms a small tile up to fill a readable share of the viewport", () => {
    const camera = revealCamera({ x: 0, y: 0, zoom: 1 }, viewport, small, content);
    expect(camera.zoom).toBeGreaterThan(1);
  });

  it("keeps the zoom exactly as it was when asked not to fit", () => {
    const camera = revealCamera({ x: 0, y: 0, zoom: 1 }, viewport, small, content, false);
    expect(camera.zoom).toBe(1);
    // Still brought on screen: the camera has moved down to it.
    expect(camera.y).toBeLessThan(0);
  });
});

describe("pinchSpan", () => {
  it("measures the distance between two touches", () => {
    expect(pinchSpan({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it("is zero for two touches at the same point", () => {
    expect(pinchSpan({ x: 7, y: 7 }, { x: 7, y: 7 })).toBe(0);
  });
});

describe("pinchMidpoint", () => {
  it("sits halfway between the touches", () => {
    expect(pinchMidpoint({ x: 0, y: 0 }, { x: 10, y: 20 })).toEqual({ x: 5, y: 10 });
  });
});

describe("pinchCamera", () => {
  const camera = { x: 0, y: 0, zoom: 1 };
  const start = { camera, span: 100, midpoint: { x: 500, y: 400 } };

  it("holds the fingers still when nothing moves", () => {
    const next = pinchCamera(start, { x: 450, y: 400 }, { x: 550, y: 400 });
    expect(next.zoom).toBeCloseTo(1);
    expect(next.x).toBeCloseTo(0);
    expect(next.y).toBeCloseTo(0);
  });

  it("zooms in as the fingers spread", () => {
    const next = pinchCamera(start, { x: 400, y: 400 }, { x: 600, y: 400 });
    expect(next.zoom).toBeCloseTo(2);
  });

  it("zooms out as the fingers close", () => {
    const next = pinchCamera(start, { x: 475, y: 400 }, { x: 525, y: 400 });
    expect(next.zoom).toBeCloseTo(0.5);
  });

  it("keeps the content under the starting midpoint pinned there", () => {
    const anchor = toContent(camera, start.midpoint);
    const next = pinchCamera(start, { x: 400, y: 400 }, { x: 600, y: 400 });
    // The same content point must land back under the midpoint, which has
    // not moved: this is what stops the wall sliding out from under a pinch.
    expect(next.x + anchor.x * next.zoom).toBeCloseTo(500);
    expect(next.y + anchor.y * next.zoom).toBeCloseTo(400);
  });

  it("pans when the pair travels without spreading", () => {
    const next = pinchCamera(start, { x: 550, y: 500 }, { x: 650, y: 500 });
    expect(next.zoom).toBeCloseTo(1);
    expect(next.x).toBeCloseTo(100);
    expect(next.y).toBeCloseTo(100);
  });

  it("zooms and pans together", () => {
    const next = pinchCamera(start, { x: 500, y: 500 }, { x: 700, y: 500 });
    expect(next.zoom).toBeCloseTo(2);
    // Midpoint moved to (600, 500), and the anchor is pinned under it.
    const anchor = toContent(camera, start.midpoint);
    expect(next.x + anchor.x * next.zoom).toBeCloseTo(600);
    expect(next.y + anchor.y * next.zoom).toBeCloseTo(500);
  });

  it("clamps the zoom at both ends", () => {
    expect(pinchCamera(start, { x: 0, y: 400 }, { x: 4000, y: 400 }).zoom).toBe(MAX_ZOOM);
    expect(pinchCamera(start, { x: 500, y: 400 }, { x: 501, y: 400 }).zoom).toBe(MIN_ZOOM);
  });

  it("treats a zero starting span as pure pan rather than dividing by it", () => {
    const degenerate = { camera, span: 0, midpoint: { x: 100, y: 100 } };
    const next = pinchCamera(degenerate, { x: 150, y: 150 }, { x: 150, y: 150 });
    expect(next.zoom).toBeCloseTo(1);
    expect(next.x).toBeCloseTo(50);
    expect(next.y).toBeCloseTo(50);
  });
});

describe("cameraBounds", () => {
  it("gives a tall wall room to travel vertically and none sideways", () => {
    const bounds = cameraBounds(viewport, content, 1);
    expect(bounds.maxY).toBe(0);
    expect(bounds.minY).toBe(800 - 5000);
    // Content exactly as wide as the viewport has nowhere to go.
    expect(bounds.minX).toBe(bounds.maxX);
  });

  it("collapses an axis with nothing beyond the edge onto its resting place", () => {
    const bounds = cameraBounds(viewport, { width: 400, height: 200 }, 1);
    expect(bounds.minX).toBe(bounds.maxX);
    expect(bounds.minX).toBe((1000 - 400) / 2);
    expect(bounds.minY).toBe(0);
    expect(bounds.maxY).toBe(0);
  });

  it("agrees with clampCamera at both ends", () => {
    const bounds = cameraBounds(viewport, content, 1);
    expect(clampCamera({ x: 0, y: -99999, zoom: 1 }, viewport, content).y).toBe(bounds.minY);
    expect(clampCamera({ x: 0, y: 99999, zoom: 1 }, viewport, content).y).toBe(bounds.maxY);
  });
});

describe("rubberBand", () => {
  it("does not move an overshoot of nothing", () => {
    expect(rubberBand(0, 800)).toBe(0);
  });

  it("resists: the result is always shorter than the pull", () => {
    for (const pull of [10, 50, 200, 1000]) {
      expect(Math.abs(rubberBand(pull, 800))).toBeLessThan(pull);
    }
  });

  it("costs more per pixel the further out it goes", () => {
    const early = rubberBand(20, 800) - rubberBand(10, 800);
    const late = rubberBand(210, 800) - rubberBand(200, 800);
    expect(late).toBeLessThan(early);
  });

  it("never travels the full dimension, however hard it is pulled", () => {
    expect(rubberBand(100000, 800)).toBeLessThan(800);
  });

  it("is symmetric about zero", () => {
    expect(rubberBand(-120, 800)).toBeCloseTo(-rubberBand(120, 800));
  });
});

describe("elasticCamera", () => {
  it("leaves a camera inside its bounds exactly where it is", () => {
    const inside = { x: 0, y: -1000, zoom: 1 };
    const next = elasticCamera(inside, viewport, content);
    expect(next.y).toBe(-1000);
  });

  it("lets the top edge be pulled down, but not as far as asked", () => {
    const next = elasticCamera({ x: 0, y: 300, zoom: 1 }, viewport, content);
    expect(next.y).toBeGreaterThan(0);
    expect(next.y).toBeLessThan(300);
  });

  it("lets the bottom edge be pulled up, but not as far as asked", () => {
    const floor = 800 - 5000;
    const next = elasticCamera({ x: 0, y: floor - 300, zoom: 1 }, viewport, content);
    expect(next.y).toBeLessThan(floor);
    expect(next.y).toBeGreaterThan(floor - 300);
  });

  it("never hands back a camera clampCamera would have moved further than the viewport", () => {
    const next = elasticCamera({ x: 0, y: 100000, zoom: 1 }, viewport, content);
    expect(next.y).toBeLessThan(viewport.height);
  });
});

describe("cameraOvershoot", () => {
  it("is zero inside the bounds", () => {
    expect(cameraOvershoot({ x: 0, y: -1000, zoom: 1 }, viewport, content)).toEqual({
      x: 0,
      y: 0,
    });
  });

  it("is positive past the top and negative past the bottom", () => {
    expect(cameraOvershoot({ x: 0, y: 40, zoom: 1 }, viewport, content).y).toBe(40);
    const floor = 800 - 5000;
    expect(cameraOvershoot({ x: 0, y: floor - 40, zoom: 1 }, viewport, content).y).toBe(-40);
  });
});

describe("flingVelocity", () => {
  it("is still for fewer than two samples", () => {
    expect(flingVelocity([])).toEqual({ vx: 0, vy: 0 });
    expect(flingVelocity([{ x: 0, y: 0, t: 0 }])).toEqual({ vx: 0, vy: 0 });
  });

  it("measures px per millisecond", () => {
    const v = flingVelocity([
      { x: 0, y: 0, t: 0 },
      { x: 0, y: 50, t: 50 },
    ]);
    expect(v.vy).toBeCloseTo(1);
  });

  it("reads the tail, not the whole drag", () => {
    // Still for a second, then a flick: this must fling, not average to nothing.
    const v = flingVelocity([
      { x: 0, y: 0, t: 0 },
      { x: 0, y: 0, t: 1000 },
      { x: 0, y: 60, t: 1030 },
    ]);
    expect(v.vy).toBeCloseTo(2);
  });

  it("does not fling when the finger stopped before lifting", () => {
    const v = flingVelocity([
      { x: 0, y: 0, t: 0 },
      { x: 0, y: 300, t: 300 },
      { x: 0, y: 300, t: 400 },
    ]);
    expect(v.vy).toBe(0);
  });

  it("reports nothing rather than infinity for samples sharing a timestamp", () => {
    const v = flingVelocity([
      { x: 0, y: 0, t: 5 },
      { x: 0, y: 40, t: 5 },
    ]);
    expect(v).toEqual({ vx: 0, vy: 0 });
  });

  it("caps an implausibly fast flick", () => {
    const v = flingVelocity([
      { x: 0, y: 0, t: 0 },
      { x: 0, y: 10000, t: 1 },
    ]);
    expect(v.vy).toBeLessThanOrEqual(6);
  });
});

describe("decayFactor", () => {
  it("keeps a frame's worth of velocity at one frame", () => {
    expect(decayFactor(1000 / 60)).toBeCloseTo(0.97);
  });

  it("decays the same over a period however it is sliced", () => {
    // A 120Hz phone takes twice as many steps and must coast the same.
    const oneStep = decayFactor(1000 / 60);
    const twoHalves = decayFactor(1000 / 120) ** 2;
    expect(twoHalves).toBeCloseTo(oneStep);
  });

  it("costs nothing for no time at all", () => {
    expect(decayFactor(0)).toBe(1);
  });
});
