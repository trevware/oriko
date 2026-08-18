export interface LayoutItem {
  id: string;
  width: number;
  height: number;
}

export interface Position {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutResult {
  positions: Position[];
  totalHeight: number;
}

export function columnsForWidth(
  containerWidth: number,
  targetColumnWidth: number,
  gap: number
): number {
  const count = Math.floor((containerWidth + gap) / (targetColumnWidth + gap));
  return Math.max(1, count);
}

/**
 * Shortest-column-first masonry. Pure: no DOM measurement, no reflow. Every
 * item's aspect ratio is known in advance from its archived file header, so
 * the full layout resolves in one pass before any image loads.
 */
export function computeLayout(
  items: LayoutItem[],
  containerWidth: number,
  columns: number,
  gap: number
): LayoutResult {
  if (items.length === 0) return { positions: [], totalHeight: 0 };

  const columnCount = Math.max(1, columns);
  const columnWidth = (containerWidth - gap * (columnCount - 1)) / columnCount;
  const heights = new Array<number>(columnCount).fill(0);
  const positions: Position[] = [];

  for (const item of items) {
    let target = 0;
    for (let c = 1; c < columnCount; c++) {
      // Epsilon keeps ties resolving to the leftmost column, which is what
      // makes the layout deterministic for identical inputs.
      if (heights[c] < heights[target] - 0.01) target = c;
    }

    const ratio = item.width > 0 && item.height > 0 ? item.height / item.width : 1;
    const h = Math.round(columnWidth * ratio);
    const x = Math.round(target * (columnWidth + gap));
    const y = Math.round(heights[target]);

    positions.push({ id: item.id, x, y, w: Math.floor(columnWidth), h });
    heights[target] = y + h + gap;
  }

  const totalHeight = Math.max(0, Math.max(...heights) - gap);
  return { positions, totalHeight };
}

export function visibleRange(
  positions: Position[],
  scrollTop: number,
  viewportHeight: number,
  overscan: number
): Position[] {
  const top = scrollTop - overscan;
  const bottom = scrollTop + viewportHeight + overscan;
  return positions.filter((p) => p.y + p.h >= top && p.y <= bottom);
}

/** Keeps the panel fully on screen, flipping rather than clipping. */
export function placeMenu(
  point: { x: number; y: number },
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = 8
): { x: number; y: number } {
  let x = point.x;
  let y = point.y;
  if (x + menu.width + margin > viewport.width) x = point.x - menu.width;
  if (y + menu.height + margin > viewport.height) y = point.y - menu.height;
  return {
    x: Math.max(margin, Math.min(x, viewport.width - menu.width - margin)),
    y: Math.max(margin, Math.min(y, viewport.height - menu.height - margin)),
  };
}

/**
 * How hard the cursor is "pressing" a card, as offsets from its centre in
 * the range -1..1. Feeding these into a rotation makes a card tip away
 * from the pointer, as though the corner under it were being pushed in.
 */
export function pressureAt(
  point: { x: number; y: number },
  box: { x: number; y: number; w: number; h: number }
): { dx: number; dy: number } | null {
  if (box.w <= 0 || box.h <= 0) return null;
  if (point.x < box.x || point.x > box.x + box.w) return null;
  if (point.y < box.y || point.y > box.y + box.h) return null;

  const clamp = (v: number): number => Math.max(-1, Math.min(1, v));
  return {
    dx: clamp(((point.x - box.x) / box.w) * 2 - 1),
    dy: clamp(((point.y - box.y) / box.h) * 2 - 1),
  };
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Largest box with the given aspect that fits inside bounds, centred. */
export function fitRect(
  natural: { width: number; height: number },
  bounds: { width: number; height: number },
  padding = 0
): Box {
  const availableW = Math.max(1, bounds.width - padding * 2);
  const availableH = Math.max(1, bounds.height - padding * 2);
  const ratio =
    natural.width > 0 && natural.height > 0 ? natural.height / natural.width : 3 / 4;

  let w = availableW;
  let h = w * ratio;
  if (h > availableH) {
    h = availableH;
    w = h / ratio;
  }

  return {
    x: (bounds.width - w) / 2,
    y: (bounds.height - h) / 2,
    w,
    h,
  };
}

/**
 * Transform that makes an element already laid out at `to` appear exactly at
 * `from`. Animating this back to identity is the FLIP technique: the browser
 * only ever interpolates a transform, so the whole move composites.
 *
 * `origin` is where the click landed inside the source card, in 0..1. Using
 * it as the transform origin is what gives the flight its trajectory: a
 * corner click swings, a centre click grows straight out.
 */
export function flipTransform(
  from: Box,
  to: Box,
  origin: { x: number; y: number }
): { scaleX: number; scaleY: number; dx: number; dy: number } {
  const scaleX = to.w > 0 ? from.w / to.w : 1;
  const scaleY = to.h > 0 ? from.h / to.h : 1;

  // The anchor point inside the destination, which the origin pins in place.
  const anchorX = to.x + to.w * origin.x;
  const anchorY = to.y + to.h * origin.y;
  const sourceX = from.x + from.w * origin.x;
  const sourceY = from.y + from.h * origin.y;

  return { scaleX, scaleY, dx: sourceX - anchorX, dy: sourceY - anchorY };
}

export interface FlightStep {
  dx: number;
  dy: number;
  scaleX: number;
  scaleY: number;
}

/**
 * Midpoint of the flight, which is what turns a straight interpolation into
 * something that reads as fluid.
 *
 * Two things happen here that a two-keyframe animation cannot do. The path
 * bows sideways, perpendicular to the direction of travel, so the card
 * arcs instead of sliding down a ruler. And the card stretches along the
 * axis it is travelling and pinches across it, the way a drop of water
 * elongates as it moves and settles round when it stops.
 */
/** How far the flight bows off a straight line, and how much it squashes. */
export interface FlightShape {
  /** Sideways bow, as a fraction of the distance travelled. */
  arc: number;
  /** Cap on that bow, in pixels, so a long throw does not swing wildly. */
  arcCap: number;
  /** Squash along the direction of travel. */
  stretch: number;
}

export const DEFAULT_FLIGHT_SHAPE: FlightShape = { arc: 0.13, arcCap: 110, stretch: 0.07 };

export function flightMidpoint(
  from: Box,
  to: Box,
  origin: { x: number; y: number },
  progress = 0.58,
  shape: FlightShape = DEFAULT_FLIGHT_SHAPE
): FlightStep {
  const end = flipTransform(from, to, origin);

  // Travel runs from the start offset back to zero, which is the destination.
  const travelX = -end.dx;
  const travelY = -end.dy;
  const distance = Math.hypot(travelX, travelY);

  const arc = Math.min(distance * shape.arc, shape.arcCap);
  const normalX = distance > 0 ? -travelY / distance : 0;
  const normalY = distance > 0 ? travelX / distance : 0;

  const toward = (value: number): number => value + (1 - value) * progress;
  const horizontal = Math.abs(travelX) >= Math.abs(travelY);
  const stretch = shape.stretch;

  return {
    dx: end.dx + travelX * progress + normalX * arc,
    dy: end.dy + travelY * progress + normalY * arc,
    scaleX: toward(end.scaleX) * (horizontal ? 1 + stretch : 1 - stretch * 0.55),
    scaleY: toward(end.scaleY) * (horizontal ? 1 - stretch * 0.55 : 1 + stretch),
  };
}
