import { describe, expect, it } from "vitest";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  PAN_MARGIN,
  clampCamera,
  clampZoom,
  initialCamera,
  preserveAnchor,
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
  it("allows panning up to the margin past the top", () => {
    const out = clampCamera({ x: 0, y: 9999, zoom: 1 }, viewport, content);
    expect(out.y).toBe(PAN_MARGIN);
  });

  it("allows panning up to the margin past the bottom", () => {
    const out = clampCamera({ x: 0, y: -99999, zoom: 1 }, viewport, content);
    expect(out.y).toBe(viewport.height - content.height - PAN_MARGIN);
  });

  it("leaves a camera inside the bounds untouched", () => {
    const inside = { x: 0, y: -1000, zoom: 1 };
    expect(clampCamera(inside, viewport, content)).toEqual(inside);
  });

  it("keeps a vertical band to move in when the content is shorter than the viewport", () => {
    const small = { width: 200, height: 200 };
    const low = clampCamera({ x: 0, y: -99999, zoom: 1 }, viewport, small);
    const high = clampCamera({ x: 0, y: 99999, zoom: 1 }, viewport, small);
    expect(high.y).toBeGreaterThan(low.y);
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
    expect(right.x).toBe(PAN_MARGIN);
    expect(left.x).toBe(viewport.width - content.width * 2 - PAN_MARGIN);
  });

  it("accounts for zoom when computing the bottom bound", () => {
    const out = clampCamera({ x: 0, y: -99999, zoom: 0.5 }, viewport, content);
    expect(out.y).toBe(viewport.height - content.height * 0.5 - PAN_MARGIN);
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
