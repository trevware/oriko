import type { TileModel } from "./tile";

/**
 * Folders: a named pile inside one grid, shown on that grid's wall as a
 * single collage tile that spans one, two or every column.
 *
 * Membership is a `folder` frontmatter key beside `grid`, and the same two
 * rules grids run on do the work here: no key means loose, and a key naming
 * no folder registered on this grid also means loose. Deleting a folder
 * therefore needs no cleanup pass and a hand-typed value is a harmless
 * mistake. Design: docs/superpowers/specs/2026-09-05-folders-design.md.
 */

/** Columns the tile spans. "full" is however many the wall has. */
export type FolderWidth = 1 | 2 | "full";

export const FOLDER_WIDTHS: readonly FolderWidth[] = [1, 2, "full"];

export interface FolderSpace {
  /** Identity and display both. This is the value written to `folder:`. */
  name: string;
  /** A lucide icon id. */
  icon: string;
  /** The grid this folder sits on. "" is home, as it is in `grid:`. */
  grid: string;
  width: FolderWidth;
}

export interface FolderTileModel {
  kind: "folder";
  id: string;
  folder: FolderSpace;
  /** In wall order, so the collage shows what the wall would show first. */
  members: TileModel[];
}

/**
 * How many member covers the collage shows at each width, and how tall the
 * tile is as a fraction of its width. Kept together because a change to one
 * is a change to the other: more covers need more room.
 */
export const COVER_COUNT: Record<FolderWidth, number> = { 1: 3, 2: 6, full: 10 };

/** The collage's cell grid at each width, two rows deep throughout. */
export const COLLAGE_GRID: Record<FolderWidth, { columns: number; rows: number }> = {
  1: { columns: 2, rows: 2 },
  2: { columns: 4, rows: 2 },
  full: { columns: 6, rows: 2 },
};

export interface CoverSpan {
  columns: number;
  rows: number;
}

/**
 * How the covers tile the collage, one span per cover, filling every cell.
 *
 * A fixed grid with covers dropped in left the card mostly bare whenever a
 * folder held fewer than its full count, and the same shape whatever was in
 * it. Each count gets its own arrangement instead: a lone cover takes the
 * card, two split it, and larger counts mix a big cover with small ones,
 * the way the wall itself mixes sizes. Every plan's cells add up to the grid,
 * so dense auto-placement packs it without a hole.
 */
const PLANS: Record<FolderWidth, string[][]> = {
  1: [[], ["2x2"], ["2x1", "2x1"], ["2x1", "1x1", "1x1"]],
  2: [
    [],
    ["4x2"],
    ["2x2", "2x2"],
    ["2x2", "2x1", "2x1"],
    ["2x2", "1x1", "1x1", "2x1"],
    ["2x2", "1x1", "1x1", "1x1", "1x1"],
    ["2x1", "1x1", "1x1", "1x1", "1x1", "2x1"],
  ],
  full: [
    [],
    ["6x2"],
    ["3x2", "3x2"],
    ["2x2", "2x2", "2x2"],
    ["2x2", "2x2", "2x1", "2x1"],
    ["2x2", "2x2", "2x1", "1x1", "1x1"],
    ["2x2", "2x2", "1x1", "1x1", "1x1", "1x1"],
    ["2x2", "2x1", "2x1", "1x1", "1x1", "1x1", "1x1"],
    ["2x2", "1x1", "1x1", "1x1", "1x1", "1x1", "1x1", "2x1"],
    ["2x2", "1x1", "1x1", "1x1", "1x1", "1x1", "1x1", "1x1", "1x1"],
    ["2x1", "2x1", "1x1", "1x1", "1x1", "1x1", "1x1", "1x1", "1x1", "1x1"],
  ],
};

export function collagePlan(count: number, width: FolderWidth): CoverSpan[] {
  const n = Math.max(0, Math.min(count, COVER_COUNT[width]));
  const plan = PLANS[width][n] ?? [];
  return plan.map((cell) => {
    const [columns, rows] = cell.split("x").map(Number);
    return { columns, rows };
  });
}

const HEIGHT_RATIO: Record<FolderWidth, number> = { 1: 1.3, 2: 0.66, full: 0 };

/**
 * A full-width card's height, as a multiple of one column's width. Its own
 * constant because the card's width says nothing about the wall: a wall of
 * six narrow columns and a wall of two wide ones both want the card about
 * as tall as a tile is wide.
 */
export const FULL_HEIGHT = 1.3;

/**
 * Height over width for a tile of this span. Full width is the exception:
 * its height follows the column, not the card, so it is returned as 0 and
 * the caller uses FULL_HEIGHT against the column width instead.
 */
export function heightRatioFor(width: FolderWidth): number {
  return width === "full" ? FULL_HEIGHT : HEIGHT_RATIO[width];
}

export function folderTileId(folder: FolderSpace): string {
  return `folder:${folder.grid}/${folder.name}`;
}

export function isFolderWidth(value: unknown): value is FolderWidth {
  return value === 1 || value === 2 || value === "full";
}

/** The column span a width resolves to on a wall this many columns wide. */
export function spanFor(width: FolderWidth, columns: number): number {
  const wanted = width === "full" ? columns : width;
  return Math.max(1, Math.min(wanted, columns));
}

/**
 * Splits a grid's tiles into its folder tiles and the loose remainder.
 *
 * Folders are pinned first, widest first and otherwise in stored order: a
 * folder is a place you go back to, and a place should not move. An empty folder is still a tile, because
 * it was just made and has to be on the wall to be filled. A tile naming a
 * folder on some other grid is loose here; from this grid's point of view
 * that folder is not registered.
 */
export function partitionWall(
  tiles: TileModel[],
  folders: readonly FolderSpace[],
  grid: string
): { folders: FolderTileModel[]; loose: TileModel[] } {
  // Widest first, and stored order within a width. A full-width folder
  // placed after a narrow one has to wait until every column is level, and
  // the columns beside the narrow one stay bare until it lands; leading
  // with the wide ones lays them while the wall is still level.
  const rank: Record<FolderWidth, number> = { full: 0, 2: 1, 1: 2 };
  const here = folders
    .filter((folder) => folder.grid === grid)
    .map((folder, index) => ({ folder, index }))
    .sort((a, b) => rank[a.folder.width] - rank[b.folder.width] || a.index - b.index)
    .map((entry) => entry.folder);
  const byName = new Map(here.map((folder) => [folder.name, folder]));
  const members = new Map<string, TileModel[]>(here.map((folder) => [folder.name, []]));
  const loose: TileModel[] = [];

  for (const tile of tiles) {
    const named = tile.record.folder.trim();
    const owner = named ? byName.get(named) : undefined;
    if (owner) members.get(owner.name)?.push(tile);
    else loose.push(tile);
  }

  return {
    folders: here.map((folder) => ({
      kind: "folder",
      id: folderTileId(folder),
      folder,
      members: members.get(folder.name) ?? [],
    })),
    loose,
  };
}

/**
 * The folder a new clipping should carry when filed while `open` is on
 * screen, or "" when none applies. Mirrors fileableGrid: a name that is not
 * registered on this grid would put the clipping in a pile no wall reads.
 */
export function fileableFolder(
  open: string | null,
  grid: string,
  folders: readonly FolderSpace[]
): string {
  if (!open) return "";
  const found = folders.find((folder) => folder.grid === grid && folder.name === open);
  return found ? found.name : "";
}

/**
 * Why a name cannot be used on this grid, or null if it can. `self` exempts
 * a folder from colliding with itself, so its icon can change without a
 * rename. Uniqueness is per grid: two grids may each have a References.
 */
export function validateFolderName(
  name: string,
  existingOnGrid: readonly string[],
  self?: string
): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "A folder needs a name";

  const taken = existingOnGrid
    .filter((other) => !self || other.toLowerCase() !== self.toLowerCase())
    .map((other) => other.toLowerCase());

  if (taken.includes(trimmed.toLowerCase())) {
    return `A folder called ${trimmed} already exists here`;
  }
  return null;
}

/**
 * The width a corner drag lands on. Only the horizontal travel counts, since
 * height follows width, and each column's worth of travel is one step along
 * the three widths, snapping at the midpoint. A wall with one column has one
 * width, and on a two-column wall the second step is already full.
 */
export function widthForDrag(
  start: FolderWidth,
  deltaX: number,
  columnWidth: number,
  gap: number,
  columns: number
): FolderWidth {
  if (columns <= 1) return 1;
  const steps = Math.round(deltaX / (columnWidth + gap));
  const from = FOLDER_WIDTHS.indexOf(start);
  const index = Math.max(0, Math.min(FOLDER_WIDTHS.length - 1, from + steps));
  const width = FOLDER_WIDTHS[index] ?? 1;
  return width === 2 && columns <= 2 ? "full" : width;
}
