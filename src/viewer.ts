import type { Camera, Size } from "./camera";
import { fitRect } from "./layout";
import type { Box } from "./layout";

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

/** Clearance round the picture when the details sit beside it. */
export const DETAIL_PADDING = 56;
/** Width of the details column, beside the picture. */
export const DETAIL_SIDEBAR = 300;
/** Space between the picture's edge and the start of the details. */
export const DETAIL_META_GAP = 24;
/** Clearance round the picture when the details are stacked under it. Tighter
    than beside: a pane this narrow has no room to spend on margins. */
export const STACK_PADDING = 20;
/** Where a stacked picture starts: below the back button at top left (20px
    in, about 36px tall), which would otherwise sit on the picture. */
export const STACK_TOP = 72;
/** The most of the pane's height a stacked picture may take, so the details
    under it are not pushed entirely off the bottom. */
export const STACK_SHARE = 0.6;
/**
 * Narrowest the picture may be drawn beside its details. Under this, the
 * beside layout was a thumbnail in a corner next to a full column of text,
 * in a pane whose tile had been wider than the picture it opened into.
 */
const MIN_BESIDE_WIDTH = 240;

export interface DetailLayout {
  /** `beside`: picture left, details in a column right. `stacked`: picture
      across the top, details under it, for a narrow pane such as a sidebar. */
  mode: "beside" | "stacked";
  stage: Box;
  meta: { x: number; y: number; width: number };
}

/**
 * Where the picture and its details go, given the pane. Beside is the wide
 * arrangement; stacked is what a pane too narrow for it gets, with the
 * picture taking the width so it is at least as large as the tile it flew
 * out of, and the details running under it and scrolling.
 */
export function detailLayout(natural: Size, bounds: Size): DetailLayout {
  const beside = bounds.width - DETAIL_SIDEBAR - 2 * DETAIL_PADDING;
  if (beside >= MIN_BESIDE_WIDTH) {
    const stage = fitRect(
      natural,
      { width: bounds.width - DETAIL_SIDEBAR, height: bounds.height },
      DETAIL_PADDING
    );
    return {
      mode: "beside",
      stage,
      meta: {
        // Against the picture rather than in a fixed column, clamped so it
        // can never run off the right edge.
        x: Math.min(stage.x + stage.w + DETAIL_META_GAP, bounds.width - DETAIL_SIDEBAR),
        y: stage.y,
        width: DETAIL_SIDEBAR,
      },
    };
  }

  const fit = fitRect(
    natural,
    { width: bounds.width, height: bounds.height * STACK_SHARE },
    STACK_PADDING
  );
  const stage: Box = { x: (bounds.width - fit.w) / 2, y: STACK_TOP, w: fit.w, h: fit.h };
  return {
    mode: "stacked",
    stage,
    meta: { x: stage.x, y: stage.y + stage.h + DETAIL_META_GAP, width: stage.w },
  };
}
