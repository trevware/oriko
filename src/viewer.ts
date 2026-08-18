import type { Camera, Size } from "./camera";

/**
 * Zoom for the detail view's single image, as distinct from the grid's
 * camera over the whole wall.
 *
 * The stage keeps its fitted rect and clips; an inner layer carries this
 * transform with a 0 0 origin, so the frame is the viewport and the media
 * moves inside it. Keeping the stage itself untouched is what lets zoom
 * coexist with the opening flight, which animates the stage's transform with
 * fill: both and would otherwise override anything written to it inline.
 */

/**
 * How far this media can usefully be zoomed, as a multiple of its fitted size.
 *
 * The floor is the fitted view and the ceiling is the media's true pixel size,
 * so zooming can reveal real detail but never magnify into interpolation. An
 * image displayed at or above its native size gets a range of exactly 1, which
 * disables zoom rather than offering a blurrier version of what is already on
 * screen.
 */
export function fitZoomRange(natural: Size, fitted: Size): { min: number; max: number } {
  if (!(natural.width > 0) || !(fitted.width > 0)) return { min: 1, max: 1 };
  return { min: 1, max: Math.max(1, natural.width / fitted.width) };
}

/**
 * Keeps the scaled media covering the frame, so it can never be dragged away
 * from an edge and leave a gap. At fit there is nothing to pan, and the
 * bounds collapse to a single point.
 */
export function clampPan(view: Camera, frame: Size): Camera {
  const clamp = (value: number, lo: number): number => Math.min(0, Math.max(lo, value));
  return {
    zoom: view.zoom,
    x: clamp(view.x, frame.width * (1 - view.zoom)),
    y: clamp(view.y, frame.height * (1 - view.zoom)),
  };
}
