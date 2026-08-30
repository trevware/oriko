import { describe, expect, it } from "vitest";
import { MAX_ZOOM, revealCamera } from "../src/core/camera";

const viewport = { width: 1000, height: 800 };
const content = { width: 1000, height: 5000 };
/** A tile a third of the way down a tall wall, clear of the pan clamp. */
const tile = { x: 350, y: 1500, w: 300, h: 400 };

const centreOnScreen = (camera: { x: number; y: number; zoom: number }) => ({
  x: (tile.x + tile.w / 2) * camera.zoom + camera.x,
  y: (tile.y + tile.h / 2) * camera.zoom + camera.y,
});

describe("revealCamera", () => {
  it("puts the tile's centre in the middle of the viewport", () => {
    const camera = revealCamera({ x: 0, y: 0, zoom: 1 }, viewport, tile, content);
    expect(centreOnScreen(camera)).toEqual({ x: 500, y: 400 });
  });

  it("leaves a comfortable zoom alone", () => {
    expect(revealCamera({ x: 0, y: 0, zoom: 1 }, viewport, tile, content).zoom).toBe(1);
  });

  it("zooms in when the tile would arrive as a speck", () => {
    const camera = revealCamera({ x: 0, y: 0, zoom: 0.2 }, viewport, tile, content);
    expect(camera.zoom).toBeGreaterThan(0.2);
  });

  it("zooms out when the tile would overflow the viewport", () => {
    const camera = revealCamera({ x: 0, y: 0, zoom: 4 }, viewport, tile, content);
    expect(tile.h * camera.zoom).toBeLessThanOrEqual(viewport.height);
  });

  it("never leaves the allowed zoom range", () => {
    const speck = { x: 0, y: 0, w: 1, h: 1 };
    const camera = revealCamera({ x: 0, y: 0, zoom: 1 }, viewport, speck, content);
    expect(camera.zoom).toBeLessThanOrEqual(MAX_ZOOM);
  });

  it("keeps the camera within the pannable bounds", () => {
    // Centring a short tile in the first row would push the wall's top edge
    // into the middle of the screen; the pan clamp is what stops that, so it
    // lands against the top instead.
    const top = { x: 350, y: 0, w: 300, h: 100 };
    const camera = revealCamera({ x: 0, y: 0, zoom: 1 }, viewport, top, content);
    expect(camera.y).toBe(0);
  });
});
