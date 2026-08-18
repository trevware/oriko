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

/** Adds or removes one id, the way a modifier-click does. */
export function toggleSelection(base: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(base);
  if (!next.delete(id)) next.add(id);
  return next;
}

/**
 * Selects everything between the anchor and the target in layout order,
 * which is how a shift-click behaves in every file manager. With no anchor
 * yet it degrades to selecting the single target.
 */
export function rangeSelection(
  order: string[],
  anchorId: string | null,
  targetId: string,
  base: ReadonlySet<string>
): Set<string> {
  const to = order.indexOf(targetId);
  if (to < 0) return new Set(base);

  const from = anchorId ? order.indexOf(anchorId) : -1;
  if (from < 0) return new Set([...base, targetId]);

  const next = new Set(base);
  const [lo, hi] = from <= to ? [from, to] : [to, from];
  for (let i = lo; i <= hi; i++) next.add(order[i]);
  return next;
}
