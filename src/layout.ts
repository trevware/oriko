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
