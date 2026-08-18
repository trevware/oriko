import { domainOf } from "./scan";
import type { TileModel } from "./tile";

/**
 * Filtering the wall by the properties its clippings already carry.
 *
 * Two rules, and they are different on purpose:
 *
 * - **Within a facet, any.** Picking design and ios shows everything carrying
 *   either. Each pick widens, which is what a chip-style filter is expected to
 *   do, and it means you cannot drive yourself to an empty wall by adding one
 *   more thing you were interested in.
 * - **Across facets, all.** design plus unread means both. Combining facets is
 *   only useful if it narrows; otherwise picking a status would widen the
 *   result, which reads as the filter ignoring you.
 *
 * Filters run over tiles rather than records, so a facet only ever offers a
 * value that something renderable actually carries.
 */
export interface FilterState {
  categories: string[];
  statuses: string[];
  kinds: string[];
  domains: string[];
}

export type Facet = keyof FilterState;

export const FACETS: Facet[] = ["categories", "statuses", "kinds", "domains"];

export interface FacetValue {
  value: string;
  count: number;
}

export function emptyFilter(): FilterState {
  return { categories: [], statuses: [], kinds: [], domains: [] };
}

export function activeCount(filter: FilterState): number {
  return FACETS.reduce((total, facet) => total + filter[facet].length, 0);
}

export function isFilterEmpty(filter: FilterState): boolean {
  return activeCount(filter) === 0;
}

/** Returns a new state; never edits the one it was given. */
export function toggleFacet(filter: FilterState, facet: Facet, value: string): FilterState {
  const current = filter[facet];
  const next = current.includes(value)
    ? current.filter((v) => v !== value)
    : [...current, value];
  return { ...filter, [facet]: next };
}

function valuesFor(tile: TileModel, facet: Facet): string[] {
  switch (facet) {
    case "categories":
      return tile.record.categories;
    case "statuses":
      return tile.record.status ? [tile.record.status] : [];
    case "kinds":
      return [tile.kind];
    case "domains": {
      const domain = domainOf(tile.record.source);
      return domain ? [domain] : [];
    }
  }
}

export function matchesFilter(tile: TileModel, filter: FilterState): boolean {
  return FACETS.every((facet) => {
    const wanted = filter[facet];
    if (wanted.length === 0) return true;
    const held = valuesFor(tile, facet);
    return held.some((value) => wanted.includes(value));
  });
}

function tally(tiles: TileModel[], facet: Facet): FacetValue[] {
  const counts = new Map<string, number>();
  for (const tile of tiles) {
    for (const value of valuesFor(tile, facet)) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  // Most used first, then alphabetically, so the order is stable between
  // openings rather than shuffling as counts happen to tie.
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

/**
 * What each facet can offer, counted from the wall as it stands before any
 * filtering. Counting the filtered result instead would make options vanish
 * as soon as you used one, leaving no way back.
 */
export function facetsOf(tiles: TileModel[]): Record<Facet, FacetValue[]> {
  return {
    categories: tally(tiles, "categories"),
    statuses: tally(tiles, "statuses"),
    kinds: tally(tiles, "kinds"),
    domains: tally(tiles, "domains"),
  };
}
