import { isFilterEmpty } from "./filter";
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
   * Present on an auto-grid: the rules its membership is computed from, which
   * is the same shape the filter menu composes. Absent on a manual grid, whose
   * membership is the `grid:` key and a write.
   */
  rules?: FilterState;
}

/**
 * Whether a grid computes its membership rather than being filled by hand.
 *
 * Empty rules read as manual, not as an auto-grid matching everything. A grid
 * naming the whole wall would be a second copy of home; the editor refuses to
 * create one, and deciding it here means a hand-edited data.json cannot make
 * one either.
 */
export function isAutoGrid(space: GridSpace): boolean {
  return space.rules !== undefined && !isFilterEmpty(space.rules);
}

/**
 * The single property write that would make a clipping match, or null when
 * there is not exactly one.
 *
 * This is what decides whether an auto-grid can be moved into. Every ambiguous
 * case refuses rather than picking a value out of the rule and hoping: a target
 * that cannot act is worse than an absent one, which is the same bargain the
 * palette makes when it drops a facet with nothing to offer.
 */
export function assignableValue(
  space: GridSpace,
  defs: FacetDef[]
): { key: string; value: string } | null {
  if (!isAutoGrid(space) || !space.rules) return null;

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

  return { key: def.key, value: values[0] };
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
