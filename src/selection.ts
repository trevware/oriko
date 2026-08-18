import type { Position } from "./layout";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Turns two drag corners into a rect with positive width and height. */
export function rectFromCorners(
  ax: number,
  ay: number,
  bx: number,
  by: number
): Rect {
  return {
    x: Math.min(ax, bx),
    y: Math.min(ay, by),
    w: Math.abs(ax - bx),
    h: Math.abs(ay - by),
  };
}

/** Touching counts, matching how Finder treats a marquee grazing an icon. */
export function intersects(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}

/** Ids of every tile the marquee touches, in layout order. */
export function idsInRect(positions: Position[], rect: Rect): string[] {
  const out: string[] = [];
  for (const p of positions) {
    if (intersects(rect, { x: p.x, y: p.y, w: p.w, h: p.h })) out.push(p.id);
  }
  return out;
}

/**
 * Applies a marquee result to the selection that existed when the drag
 * began. Additive with a modifier, replacing without, which is the
 * behaviour every desktop file manager has trained people to expect.
 */
export function mergeSelection(
  base: ReadonlySet<string>,
  hits: string[],
  additive: boolean
): Set<string> {
  const next = additive ? new Set(base) : new Set<string>();
  for (const id of hits) next.add(id);
  return next;
}

/** A drag shorter than this is a click, not a marquee. */
export const MARQUEE_SLOP = 4;
