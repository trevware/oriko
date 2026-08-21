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

/**
 * Whether a wall is small enough to keep in the DOM in its entirety.
 *
 * Virtualizing trades memory for hitches. A tile leaving the overscan band is
 * torn down, so panning back rebuilds its element from scratch and decodes its
 * image again, which is seen as the tile loading in late rather than simply
 * being there. Below the budget that trade is not worth making: mounting
 * everything means each tile is built once, decoded once, and thereafter only
 * ever moved by the camera transform, which the compositor does alone.
 *
 * The budget counts tiles rather than bytes because tile count is the only
 * thing known before decoding. The layout knows an image's aspect ratio, never
 * its pixel area, and tiles paint the full-resolution original so they stay
 * sharp when zoomed, so a single one can decode to tens of megabytes. Hence a
 * cautious ceiling: it is meant to cover a personal wall, which is the case
 * that suffers the hitching, and to hand anything larger back to the window.
 */
export function shouldMountAll(count: number, budget: number): boolean {
  return count <= budget;
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
 * Where the cursor lands moving across a wrapped grid of swatches.
 *
 * A list only wraps at its two ends. A grid has four, and the axes want
 * different answers: stepping right off the last swatch carries on to the
 * first of the next row, the way reading does, while stepping down off the
 * bottom returns to the top of the same column rather than shuffling
 * sideways. Columns therefore wrap through the flat index, rows within the
 * column.
 *
 * The last row is usually short. Stepping into the gap past its end lands on
 * the nearest swatch that column actually has, so every press moves something
 * rather than appearing to jam.
 */
export function moveInGrid(
  index: number,
  delta: { columns: number; rows: number },
  count: number,
  columns: number
): number {
  if (count <= 0) return 0;
  const width = Math.max(1, columns);
  const here = Math.max(0, Math.min(index, count - 1));

  if (delta.columns !== 0) return (here + delta.columns + count) % count;
  if (delta.rows === 0) return here;

  const column = here % width;
  const height = Math.ceil(count / width);
  let row = (Math.floor(here / width) + delta.rows + height) % height;

  // Landed past the end of a short last row: take the nearest row that has
  // this column, which is the one the gap sits directly under.
  if (row * width + column >= count) row = delta.rows > 0 ? 0 : Math.max(0, height - 2);

  return Math.min(row * width + column, count - 1);
}

/**
 * How far to shift an item from its container's centre to sit under a target,
 * without letting it hang outside the container.
 *
 * For a label that names whichever of a row of things the pointer is on. One
 * label that moves, rather than one per thing, because the row lives in a
 * scrolling panel and a scroll container clips absolutely positioned children:
 * a tip on each would be cut off the first and the last. Moving a single one
 * keeps it in the flow, where nothing can clip it.
 */
export function offsetToward(
  targetCentre: number,
  containerCentre: number,
  containerWidth: number,
  itemWidth: number
): number {
  // Half the slack either side. An item wider than its container has none, and
  // clamping to zero leaves it centred rather than swinging past both edges.
  const limit = Math.max(0, (containerWidth - itemWidth) / 2);
  const wanted = targetCentre - containerCentre;
  return Math.max(-limit, Math.min(wanted, limit));
}

/**
 * How far each row has to be pushed back to appear where it just was.
 *
 * The first half of FLIP, for a list that rebuilds rather than moves: the rows
 * are already in their new places by the time this runs, so animating means
 * putting them back and then letting go. Only rows present both before and
 * after are considered, since one that has just appeared has nowhere to come
 * from and one that has gone is not there to move.
 *
 * Sub-pixel differences are dropped. They come of rounding rather than of
 * anything actually moving, and animating them puts a transition on rows that
 * did not move, which is enough to make a settled list shimmer.
 */
export function flipOffsets(
  before: ReadonlyMap<string, number>,
  after: ReadonlyMap<string, number>
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [key, wasAt] of before) {
    const isAt = after.get(key);
    if (isAt === undefined) continue;
    const dy = wasAt - isAt;
    if (Math.abs(dy) >= 0.5) out.set(key, dy);
  }
  return out;
}

/**
 * How many rows a drag has carried something, from how far the pointer has
 * travelled since it was picked up.
 *
 * Measured as displacement from the grab, not as the pointer's position
 * against the rows. Position is wrong twice over: a row grabbed near its
 * bottom edge is already past its own midpoint, so it swaps on the first pixel
 * of movement, and once rows animate their measured positions are where they
 * appear rather than where they are, which lets the test and the animation
 * chase each other. Displacement is immune to both, and it needs the row
 * height and nothing else.
 *
 * `threshold` is the share of a row that must be crossed before it counts, so
 * 0.5 swaps at the halfway point and higher values ask for more commitment
 * before anything moves.
 */
export function dragSteps(dy: number, rowHeight: number, threshold: number): number {
  if (rowHeight <= 0) return 0;
  const raw = dy / rowHeight;
  const magnitude = Math.floor(Math.abs(raw) + (1 - threshold));
  // Signed only once there is something to sign. Multiplying the sign through
  // a zero magnitude yields -0 for any upward drag short of the threshold,
  // which is the same number to arithmetic and a different one to Object.is.
  if (magnitude === 0) return 0;
  return raw < 0 ? -magnitude : magnitude;
}

/**
 * Where a menu's cursor sits once its rows have been narrowed.
 *
 * Typing sends it to the first row, which is the convention everywhere else
 * here and does the useful thing at both ends: when the query matched, the top
 * match is what Enter should take; when it matched nothing, the only row left
 * is the one offering to create what was typed, so it arrives already picked.
 *
 * With no query the cursor stays put, and stays absent if it was absent. A
 * submenu opened by pointing at it should not look as though a row has already
 * been chosen, so nothing is lit until a key asks for it.
 */
export function cursorAfterNarrowing(
  selectable: boolean[],
  current: number,
  hasQuery: boolean
): number {
  const first = selectable.indexOf(true);
  if (first === -1) return -1;
  if (hasQuery) return first;
  if (current >= 0 && current < selectable.length && selectable[current]) return current;
  return current < 0 ? -1 : first;
}

/**
 * The next row a cursor reaches, wrapping, passing over anything inert.
 *
 * From nowhere it enters at the end the key points at, so the first Down lands
 * on the top row and the first Up on the bottom one. A list with nothing
 * selectable leaves the cursor where it was rather than spinning.
 */
export function stepCursor(current: number, delta: number, selectable: boolean[]): number {
  const count = selectable.length;
  if (count === 0) return -1;

  let at = current >= 0 && current < count ? current : delta > 0 ? -1 : 0;
  for (let i = 0; i < count; i++) {
    at = (at + delta + count) % count;
    if (selectable[at]) return at;
  }
  return current;
}

/**
 * Flattens rows grouped by what they act on, ruling off each group from the
 * last.
 *
 * Menus are built as groups rather than as one list with dividers set by hand
 * because most rows are conditional. A rule written onto a row is a claim
 * about what precedes it, and that claim goes stale the moment the rows above
 * turn out to be absent: a multi-selection drops every property row, and a
 * hand-placed rule then floats at the top of the panel separating nothing.
 * Grouping states the intent instead, so an empty group takes its rule with
 * it and the leading group never gets one.
 *
 * Generic over the row rather than typed to MenuItem: the shape it needs is
 * one optional field, and staying structural is what keeps this in a module
 * that never imports Obsidian, and therefore testable.
 */
export function groupedMenu<T extends { divider?: boolean }>(groups: T[][]): T[] {
  const out: T[] = [];
  for (const group of groups) {
    if (group.length === 0) continue;
    const [first, ...rest] = group;
    out.push(out.length > 0 ? { ...first, divider: true } : first, ...rest);
  }
  return out;
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

export interface WindowQuery {
  scrollTop: number;
  viewportHeight: number;
  rowHeight: number;
  count: number;
  overscan?: number;
}

export interface WindowRange {
  start: number;
  /** Exclusive. */
  end: number;
}

/**
 * Which rows of a uniform-height list are worth building.
 *
 * The panel lists a whole grid, which can be thousands of clippings, so the
 * cost of showing it has to be the size of the window rather than the size
 * of the list: twenty-odd rows exist at any moment whether the grid holds
 * fifty or fifty thousand. Uniform heights are what make this arithmetic
 * rather than a search, which is why a row is a fixed size by design.
 */
export function windowRange({
  scrollTop,
  viewportHeight,
  rowHeight,
  count,
  overscan = 4,
}: WindowQuery): WindowRange {
  if (rowHeight <= 0 || count <= 0) return { start: 0, end: 0 };

  const first = Math.floor(scrollTop / rowHeight) - overscan;
  const last = Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan;

  return {
    start: Math.max(0, Math.min(first, count)),
    end: Math.max(0, Math.min(last, count)),
  };
}
