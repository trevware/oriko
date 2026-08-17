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
 * When the content is smaller than the viewport the two bounds invert; the
 * min/max pair is normalised so the allowed band is the same either way.
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
    x: clamp(camera.x, Math.min(margin, xEdge), Math.max(margin, xEdge)),
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
