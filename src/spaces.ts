import type { ClippingRecord } from "./scan";

/**
 * Grids: named collections a clipping belongs to by a `grid` frontmatter key.
 *
 * Two rules do all the work here, and both exist so the vault can never end up
 * holding a clipping that no view will show:
 *
 * - No key means home. That is what lets grids ship without a migration; an
 *   existing vault is untouched until something is explicitly moved.
 * - A key naming no registered grid also means home. Deleting a grid therefore
 *   needs no cleanup pass, a half-finished rename cannot lose notes, and a
 *   hand-typed value is a harmless mistake rather than a disappearance.
 */
export interface GridSpace {
  /** Identity and display both. This is the value written to `grid:`. */
  name: string;
  /** A lucide icon id. */
  icon: string;
}

/** The grid a record actually appears in, after both fallbacks. */
export function effectiveGrid(
  record: ClippingRecord,
  home: string,
  registered: ReadonlySet<string>
): string {
  const named = record.grid.trim();
  if (!named) return home;
  if (named === home) return home;
  return registered.has(named) ? named : home;
}

export function filterByGrid(
  records: ClippingRecord[],
  grid: string,
  home: string,
  registered: ReadonlySet<string>
): ClippingRecord[] {
  return records.filter((record) => effectiveGrid(record, home, registered) === grid);
}

/** Home first, then the created grids in their stored order. */
export function orderedGrids(home: GridSpace, grids: readonly GridSpace[]): GridSpace[] {
  return [home, ...grids];
}

/**
 * Which grid a digit selects, or null if the key is not a grid shortcut.
 * 0 is excluded deliberately: it is already the zoom reset.
 */
export function hotkeyPosition(key: string): number | null {
  if (!/^[1-9]$/.test(key)) return null;
  return Number(key) - 1;
}

/**
 * Why a name cannot be used, or null if it can. `self` exempts a grid from
 * colliding with itself, so its icon can be changed without renaming it.
 */
export function validateGridName(
  name: string,
  existing: readonly string[],
  home: string,
  self?: string
): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "A grid needs a name";

  const taken = [home, ...existing]
    .filter((other) => !self || other.toLowerCase() !== self.toLowerCase())
    .map((other) => other.toLowerCase());

  if (taken.includes(trimmed.toLowerCase())) return `A grid called ${trimmed} already exists`;
  return null;
}

/**
 * The records that would have to be rewritten to rename a grid.
 *
 * Deliberately only those carrying the name outright. Notes at home carry no
 * key, and renaming home must not go and write one into every clipping in the
 * vault; they belong to home by absence, which survives the rename untouched.
 */
export function membersOf(records: ClippingRecord[], name: string): ClippingRecord[] {
  return records.filter((record) => record.grid.trim() === name);
}
