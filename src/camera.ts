import type { Box } from "./layout";

export interface Camera {
  /** Screen-space offset of the content origin. */
  x: number;
  y: number;
  zoom: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 4;

/** How far past the content edges the camera may travel, in screen pixels. */
export const PAN_MARGIN = 240;

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

export function clampZoom(zoom: number, min = MIN_ZOOM, max = MAX_ZOOM): number {
  // NaN has no meaningful clamp, but infinities clamp to their end normally.
  if (Number.isNaN(zoom)) return min;
  return clamp(zoom, min, max);
}

/**
 * Keeps the camera within the content plus a margin of empty space, so a
 * pan can overshoot the wall a little but never lose it off screen.
 *
 * Vertically the two bounds invert once the content is shorter than the
 * viewport; the min/max pair is normalised so the allowed band is the same
 * either way.
 *
 * Horizontally there is no band at all unless the wall is genuinely wider
 * than the viewport. The wall is laid out at viewport width, so at rest it
 * exactly fills it and sliding sideways only reveals blank canvas, which
 * reads as the whole grid having drifted off-centre. Zoom in far enough that
 * the columns really do run past both edges and panning comes back.
 */
export function clampCamera(
  camera: Camera,
  viewport: Size,
  content: Size,
  margin = PAN_MARGIN
): Camera {
  const zoom = clampZoom(camera.zoom);
  const scaledWidth = content.width * zoom;
  const scaledHeight = content.height * zoom;

  const xEdge = viewport.width - scaledWidth - margin;
  const yEdge = viewport.height - scaledHeight - margin;

  return {
    zoom,
    x:
      scaledWidth > viewport.width
        ? clamp(camera.x, Math.min(margin, xEdge), Math.max(margin, xEdge))
        : (viewport.width - scaledWidth) / 2,
    y: clamp(camera.y, Math.min(margin, yEdge), Math.max(margin, yEdge)),
  };
}

/** Screen point to content point under the current camera. */
export function toContent(camera: Camera, point: Point): Point {
  return {
    x: (point.x - camera.x) / camera.zoom,
    y: (point.y - camera.y) / camera.zoom,
  };
}

/**
 * Scales about a screen point, holding whatever sits under the cursor in
 * place. This is what makes trackpad pinch feel anchored rather than
 * sliding the wall around.
 */
export function zoomAt(
  camera: Camera,
  factor: number,
  pointer: Point,
  min = MIN_ZOOM,
  max = MAX_ZOOM
): Camera {
  const zoom = clampZoom(camera.zoom * factor, min, max);
  if (zoom === camera.zoom) return camera;

  const anchor = toContent(camera, pointer);
  return {
    zoom,
    x: pointer.x - anchor.x * zoom,
    y: pointer.y - anchor.y * zoom,
  };
}

/** The slice of content space the viewport currently covers, vertically. */
export function visibleContentBand(
  camera: Camera,
  viewport: Size
): { top: number; height: number } {
  return {
    top: -camera.y / camera.zoom,
    height: viewport.height / camera.zoom,
  };
}

/** Centres the content horizontally and puts its top edge at the viewport top. */
export function initialCamera(viewport: Size, content: Size): Camera {
  return clampCamera(
    { x: (viewport.width - content.width) / 2, y: 0, zoom: 1 },
    viewport,
    content
  );
}

/**
 * Holds a content point still on screen across a relayout.
 *
 * Clippings sort newest first, so adding one inserts at the top and pushes
 * every existing tile down. Without this the camera stays put while the
 * wall slides underneath it, which reads as the canvas jumping.
 */
export function preserveAnchor(camera: Camera, oldY: number, newY: number): Camera {
  if (!Number.isFinite(oldY) || !Number.isFinite(newY)) return camera;
  return { ...camera, y: camera.y + (oldY - newY) * camera.zoom };
}

/**
 * How much of the viewport a revealed tile should fill at most, and at
 * least. Between the two the camera keeps whatever zoom it had: arriving
 * from the palette should move the wall, not redecide how you were looking
 * at it. Outside them it would land as a speck or spill off the edges, and
 * a reveal you cannot see is not a reveal.
 */
const REVEAL_MAX_FILL = 0.85;
const REVEAL_MIN_FILL = 0.35;

/** The zoom at which a box fills the given fraction of the viewport. */
function fillZoom(viewport: Size, box: Box, fraction: number): number {
  return Math.min(
    (viewport.width * fraction) / Math.max(1, box.w),
    (viewport.height * fraction) / Math.max(1, box.h)
  );
}

/**
 * Centres a tile on screen, which is how the palette lands on a clipping
 * that may be nowhere near the current view. Clamped like any other pan, so
 * revealing something in the first row cannot leave the wall hanging in the
 * middle of an empty canvas.
 */
export function revealCamera(
  camera: Camera,
  viewport: Size,
  box: Box,
  content: Size
): Camera {
  const zoom = clampZoom(
    clamp(
      camera.zoom,
      fillZoom(viewport, box, REVEAL_MIN_FILL),
      fillZoom(viewport, box, REVEAL_MAX_FILL)
    )
  );

  return clampCamera(
    {
      zoom,
      x: viewport.width / 2 - (box.x + box.w / 2) * zoom,
      y: viewport.height / 2 - (box.y + box.h / 2) * zoom,
    },
    viewport,
    content
  );
}
