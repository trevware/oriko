import { EMPTY_VALUE, isFilterEmpty } from "./filter";
import type { FacetDef, FilterState } from "./filter";
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
  /**
   * Present on a smart grid: the rules its membership is computed from, which
   * is the same shape the filter menu composes. Absent on a manual grid, whose
   * membership is the `grid:` key and a write.
   */
  rules?: FilterState;
}

/**
 * Whether a grid computes its membership rather than being filled by hand.
 *
 * Empty rules read as manual, not as a smart grid matching everything. A grid
 * naming the whole wall would be a second copy of home; the editor refuses to
 * create one, and deciding it here means a hand-edited data.json cannot make
 * one either.
 */
export function isSmartGrid(space: GridSpace): boolean {
  return space.rules !== undefined && !isFilterEmpty(space.rules);
}

/**
 * The single property write that would make a clipping match, or null when
 * there is not exactly one.
 *
 * This is what decides whether a smart grid can be moved into. Every ambiguous
 * case refuses rather than picking a value out of the rule and hoping: a target
 * that cannot act is worse than an absent one, which is the same bargain the
 * palette makes when it drops a facet with nothing to offer.
 */
export function assignableValue(
  space: GridSpace,
  defs: FacetDef[]
): { key: string; value: string } | null {
  if (!isSmartGrid(space) || !space.rules) return null;

  const entries = Object.entries(space.rules);
  if (entries.length !== 1) return null;

  const [id, values] = entries[0];
  if (values.length !== 1) return null;

  // A facet switched off in settings has no def, so its shape cannot be read
  // and its writability cannot be judged. Rules are never pruned, so a rule
  // naming one is a state the wall can genuinely be in.
  const def = defs.find((candidate) => candidate.id === id);
  if (!def || def.source !== "property" || !def.key) return null;
  // A date facet's values are buckets and comparisons, which is to say
  // groupings rather than anything a note could be given.
  if (def.shape === "date") return null;
  // "Is empty" is the absence of a value, not one to write.
  if (values[0] === EMPTY_VALUE) return null;

  return { key: def.key, value: values[0] };
}

/**
 * The grid a new clipping should carry when filed into `active`, or "" when
 * that is home.
 *
 * A smart grid is never it. Nothing is filed into one: its membership is
 * computed, and writing its name into `grid:` would put the clipping in a
 * collection that no wall reads. Home would not show it, because the key
 * names a registered grid; the smart grid would not show it either, because
 * it ignores the key and asks its rules. The clipping would exist and be
 * visible nowhere, which is the exact failure effectiveGrid's fallbacks are
 * there to prevent. A name that no longer exists falls back the same way.
 */
export function fileableGrid(active: string, home: string, grids: readonly GridSpace[]): string {
  if (active === home) return "";
  const found = grids.find((grid) => grid.name === active);
  if (!found || isSmartGrid(found)) return "";
  return active;
}

/**
 * Where a clip that arrived from outside the app goes: the share sheet on a
 * phone, the URI from a terminal on a desktop.
 *
 * `last-opened` files into whatever grid is on screen, which is also where an
 * in-app clip goes. `home` ignores the open grid, because on a phone "the
 * open grid" is whatever was left up hours ago. `ask` puts the choice to the
 * user each time.
 */
export type SharedClipTarget = "last-opened" | "home" | "ask";

/** The grid a shared clip should carry, "" for home, or null to ask first. */
export function sharedClipGrid(
  mode: SharedClipTarget,
  active: string,
  home: string,
  grids: readonly GridSpace[]
): string | null {
  if (mode === "ask") return null;
  if (mode === "home") return "";
  return fileableGrid(active, home, grids);
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

export interface PlacedGrid {
  grid: GridSpace;
  /**
   * Where it sits in the switcher order, which is what its hotkey follows.
   *
   * Carried because the picker groups the two kinds and the hotkeys do not:
   * ⌘1..9 indexes the stored order directly, so a grid shown second may well
   * be ⌘4, and a hint read off the grouped list would name the wrong grid.
   */
  position: number;
}

/**
 * The grids split by kind for a picker, each keeping its stored order.
 *
 * Manual first, because home is one and home is always first. Grouping is
 * presentation only: nothing here reorders the registry, so the hotkeys and
 * the manager are untouched by it.
 */
export function groupedGrids(grids: readonly GridSpace[]): {
  manual: PlacedGrid[];
  smart: PlacedGrid[];
} {
  const manual: PlacedGrid[] = [];
  const smart: PlacedGrid[] = [];

  grids.forEach((grid, position) => {
    (isSmartGrid(grid) ? smart : manual).push({ grid, position });
  });

  return { manual, smart };
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

/**
 * Which registry entry a row of the manager list stands for, and where it
 * would land, or null when it cannot move.
 *
 * The list shows home first and the registry after it, but home is not in the
 * registry at all: it is the fallback every unknown grid resolves to, so it
 * has no stored position to change and nothing may be moved above it. That
 * offset by one is the whole of the arithmetic, and getting it wrong moves the
 * grid next to the one you meant, which is the sort of mistake that is only
 * obvious after it has been saved.
 */
export function reorderTarget(
  row: number,
  delta: number,
  count: number
): { from: number; to: number } | null {
  const from = row - 1;
  if (from < 0 || from >= count) return null;
  const to = from + delta;
  if (to < 0 || to >= count) return null;
  return { from, to };
}
