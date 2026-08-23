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

/**
 * Trackpad pinch and cmd/ctrl+wheel both arrive as a wheel event with
 * ctrlKey set; this tunes how fast a given delta zooms. One figure for the
 * wall and the detail view: they had drifted to 0.01 and 0.0022, which made
 * the same pinch zoom the detail view four and a half times slower than the
 * wall it was opened from.
 */
export const PINCH_SENSITIVITY = 0.01;
/** One notch of keyboard zoom, cmd+= and cmd+-. */
export const KEY_ZOOM_STEP = 1.2;

/** The multiplicative zoom step a wheel delta asks for. Negative delta,
    fingers spreading, zooms in. */
export function pinchFactor(deltaY: number): number {
  return Math.exp(-deltaY * PINCH_SENSITIVITY);
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

export function clampZoom(zoom: number, min = MIN_ZOOM, max = MAX_ZOOM): number {
  // NaN has no meaningful clamp, but infinities clamp to their end normally.
  if (Number.isNaN(zoom)) return min;
  return clamp(zoom, min, max);
}

/**
 * Holds the wall against the edges of the viewport: the first row can reach
 * the top and the last row the bottom, and neither goes past.
 *
 * There used to be 240px of overshoot in every direction, on the theory that
 * a canvas should feel loose. On a wall it reads as slop: you flick, the
 * content stops, and the canvas keeps going into blank space you have no
 * reason to be looking at. An axis with nothing beyond the edge should not
 * move at all.
 *
 * Horizontally that means no movement whatsoever until the wall is genuinely
 * wider than the viewport, which happens only when zoom pushes the columns
 * past both edges. The wall is laid out at viewport width, so at rest it
 * fills the viewport exactly and any sideways travel is drift.
 *
 * Vertically a wall shorter than the viewport pins to the top, which is
 * where initialCamera puts it and where a list of things belongs.
 */
export function clampCamera(camera: Camera, viewport: Size, content: Size): Camera {
  const zoom = clampZoom(camera.zoom);
  const bounds = cameraBounds(viewport, content, zoom);
  return {
    zoom,
    x: clamp(camera.x, bounds.minX, bounds.maxX),
    y: clamp(camera.y, bounds.minY, bounds.maxY),
  };
}

/** The range the camera may occupy: the rule clampCamera enforces, as numbers. */
export interface CameraBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * The travel available at a given zoom. An axis with nothing beyond the
 * viewport edge has none, and its two ends collapse onto the single
 * resting place clampCamera would have pinned it to.
 */
export function cameraBounds(viewport: Size, content: Size, zoom: number): CameraBounds {
  const scaledWidth = content.width * zoom;
  const scaledHeight = content.height * zoom;
  const restX = (viewport.width - scaledWidth) / 2;

  return {
    minX: scaledWidth > viewport.width ? viewport.width - scaledWidth : restX,
    maxX: scaledWidth > viewport.width ? 0 : restX,
    minY: scaledHeight > viewport.height ? viewport.height - scaledHeight : 0,
    maxY: 0,
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
  content: Size,
  fit = true
): Camera {
  // `fit` off keeps the zoom exactly as it is: a clipping that has just
  // landed is brought into view, not made the subject of it.
  const zoom = fit
    ? clampZoom(
        clamp(
          camera.zoom,
          fillZoom(viewport, box, REVEAL_MIN_FILL),
          fillZoom(viewport, box, REVEAL_MAX_FILL)
        )
      )
    : camera.zoom;

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

/**
 * How far apart two touches are, which is the only thing a pinch measures.
 */
export function pinchSpan(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** The point a pinch scales about: dead centre between the two fingers. */
export function pinchMidpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Where a two-finger gesture began, held for its duration. */
export interface PinchStart {
  camera: Camera;
  span: number;
  midpoint: Point;
}

/**
 * The camera a two-finger gesture asks for.
 *
 * Both halves of the gesture are one calculation: the fingers spreading
 * scales the wall, and the pair travelling across the screen moves it. A
 * pinch that also drifts should do both at once, and computing them
 * separately makes the anchor fight the pan.
 *
 * Everything is measured against where the gesture *started* rather than
 * against the previous frame, so rounding cannot accumulate over a long
 * pinch and the wall returns exactly where it began if the fingers do.
 */
export function pinchCamera(
  start: PinchStart,
  a: Point,
  b: Point,
  min = MIN_ZOOM,
  max = MAX_ZOOM
): Camera {
  // Two touches at the same point have no span and no direction to grow in.
  // Treating that as a factor of 1 leaves the pan working on its own.
  const factor = start.span > 0 ? pinchSpan(a, b) / start.span : 1;
  const zoom = clampZoom(start.camera.zoom * factor, min, max);

  const anchor = toContent(start.camera, start.midpoint);
  const now = pinchMidpoint(a, b);
  return { zoom, x: now.x - anchor.x * zoom, y: now.y - anchor.y * zoom };
}

/**
 * How hard the wall resists being pulled past its edge. Apple's own figure
 * for UIScrollView; lower drags heavier.
 */
export const RUBBER_TENSION = 0.55;
/**
 * Velocity retained per 60fps frame while a flick decelerates. iOS uses
 * a "normal" deceleration rate of 0.998 per millisecond, which is this
 * per frame, and it is the single number that decides whether a flick
 * feels like paper sliding or like it hit sand.
 */
export const SCROLL_FRICTION = 0.97;
/** Below this the wall is not moving in any way a person can see. */
export const FLING_MIN_SPEED = 0.02;
/**
 * A flick should report the speed the finger was doing when it left, not
 * the average of the whole drag, so only the tail is measured.
 */
export const FLING_WINDOW_MS = 90;
/** Nothing may be flung faster than this, however fast the finger left. */
export const FLING_MAX_SPEED = 6;

/**
 * Apple's rubber-band curve: the first pixels past the edge come easily
 * and each one after costs more, so the wall can always be pulled a little
 * and never pulled far.
 *
 * `(1 - 1 / (x * tension / dimension + 1)) * dimension`, which approaches
 * `dimension` asymptotically and so cannot be dragged off the screen no
 * matter how determined the finger is.
 */
export function rubberBand(overshoot: number, dimension: number, tension = RUBBER_TENSION): number {
  if (overshoot === 0 || dimension <= 0) return 0;
  const distance = Math.abs(overshoot);
  const resisted = (1 - 1 / ((distance * tension) / dimension + 1)) * dimension;
  return Math.sign(overshoot) * resisted;
}

/**
 * Like clampCamera, but the edges give.
 *
 * Inside its bounds the wall tracks the finger exactly; past them it
 * follows with resistance. This is the whole difference between a canvas
 * that stops dead at the last row and one that feels physical.
 */
export function elasticCamera(camera: Camera, viewport: Size, content: Size): Camera {
  const zoom = clampZoom(camera.zoom);
  const bounds = cameraBounds(viewport, content, zoom);

  const soften = (value: number, lo: number, hi: number, dimension: number): number => {
    if (value < lo) return lo + rubberBand(value - lo, dimension);
    if (value > hi) return hi + rubberBand(value - hi, dimension);
    return value;
  };

  return {
    zoom,
    x: soften(camera.x, bounds.minX, bounds.maxX, viewport.width),
    y: soften(camera.y, bounds.minY, bounds.maxY, viewport.height),
  };
}

/** How far outside its bounds a camera currently sits, per axis. */
export function cameraOvershoot(
  camera: Camera,
  viewport: Size,
  content: Size
): { x: number; y: number } {
  const bounds = cameraBounds(viewport, content, clampZoom(camera.zoom));
  return {
    x: camera.x < bounds.minX ? camera.x - bounds.minX : Math.max(0, camera.x - bounds.maxX),
    y: camera.y < bounds.minY ? camera.y - bounds.minY : Math.max(0, camera.y - bounds.maxY),
  };
}

/** Where the finger was, and when. */
export interface Sample {
  x: number;
  y: number;
  t: number;
}

/**
 * The velocity a flick ends at, in px/ms, measured across the tail of the
 * drag rather than all of it: a long slow drag that finishes with a flick
 * should fling, and one that finishes stationary should not.
 */
export function flingVelocity(
  samples: Sample[],
  window = FLING_WINDOW_MS,
  max = FLING_MAX_SPEED
): { vx: number; vy: number } {
  if (samples.length < 2) return { vx: 0, vy: 0 };

  const last = samples[samples.length - 1];
  // The oldest sample still inside the window, or the one before last when
  // every earlier sample has aged out.
  let first = samples[samples.length - 2];
  for (let i = samples.length - 2; i >= 0; i--) {
    if (last.t - samples[i].t > window) break;
    first = samples[i];
  }

  const dt = last.t - first.t;
  // Two samples in the same millisecond say nothing about speed, and
  // dividing by that gap is how a flick becomes infinite.
  if (dt <= 0) return { vx: 0, vy: 0 };

  const cap = (v: number): number => Math.max(-max, Math.min(max, v));
  return { vx: cap((last.x - first.x) / dt), vy: cap((last.y - first.y) / dt) };
}

/**
 * What a velocity is worth after `dt` milliseconds of deceleration.
 *
 * Raised to dt/frame rather than applied per frame, so the wall coasts the
 * same distance on a 120Hz phone as on a 60Hz one, and a dropped frame
 * does not extend the glide.
 */
export function decayFactor(dt: number, friction = SCROLL_FRICTION): number {
  return Math.pow(friction, dt / (1000 / 60));
}
