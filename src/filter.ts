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
 *
 * Which facets exist is a setting, not a type. Everything below is driven by
 * a FacetDef list, so a property the user starts filling in becomes filterable
 * without any of this knowing its name.
 */

export type FacetSource = "property" | "kind" | "domain";

export interface FacetDef {
  /** The FilterState key and the menu item id. For a property facet this is
      the property's own name, so no id-to-key mapping is needed. */
  id: string;
  label: string;
  icon: string;
  keywords: string;
  source: FacetSource;
  /** The frontmatter key. Set only when source is "property". */
  key?: string;
}

/** Chosen values, by facet id. A facet with nothing chosen is absent rather
    than present and empty, so isFilterEmpty is a key count. */
export type FilterState = Record<string, string[]>;

export interface FacetValue {
  value: string;
  count: number;
}

/** Icons for the keys the plugin ships knowing about. Anything else is a tag. */
const PROPERTY_ICONS: Record<string, string> = {
  categories: "tag",
  status: "circle-dot",
};

const PROPERTY_KEYWORDS: Record<string, string> = {
  categories: "tag topic category narrow",
  status: "unread read archived status narrow",
};

const KIND_FACET: FacetDef = {
  id: "kind",
  label: "Media type",
  icon: "image",
  keywords: "image video media type narrow",
  source: "kind",
};

const DOMAIN_FACET: FacetDef = {
  id: "domain",
  label: "Source",
  icon: "globe",
  keywords: "domain site host source narrow",
  source: "domain",
};

/** A frontmatter key as a heading: sentence case, separators to spaces. */
export function facetLabel(key: string): string {
  const words = key.replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}

/**
 * The facets on offer: the user's chosen properties in their order, then the
 * two the plugin derives. Properties lead so the default settings reproduce
 * the menu this feature replaced, exactly.
 */
export function facetDefs(properties: string[]): FacetDef[] {
  const defs: FacetDef[] = properties.map((key) => ({
    id: key,
    label: facetLabel(key),
    icon: PROPERTY_ICONS[key] ?? "tag",
    keywords: PROPERTY_KEYWORDS[key] ?? `${key} property narrow`,
    source: "property",
    key,
  }));
  return [...defs, KIND_FACET, DOMAIN_FACET];
}

export function emptyFilter(): FilterState {
  return {};
}

export function activeCount(filter: FilterState): number {
  return Object.values(filter).reduce((total, values) => total + values.length, 0);
}

export function isFilterEmpty(filter: FilterState): boolean {
  return activeCount(filter) === 0;
}

/** Returns a new state; never edits the one it was given. */
export function toggleFacet(filter: FilterState, id: string, value: string): FilterState {
  const current = filter[id] ?? [];
  const next = current.includes(value)
    ? current.filter((v) => v !== value)
    : [...current, value];

  const copy = { ...filter };
  if (next.length === 0) delete copy[id];
  else copy[id] = next;
  return copy;
}

function valuesFor(tile: TileModel, def: FacetDef): string[] {
  switch (def.source) {
    case "property":
      return def.key ? tile.record.properties[def.key] ?? [] : [];
    case "kind":
      return [tile.kind];
    case "domain": {
      const domain = domainOf(tile.record.source);
      return domain ? [domain] : [];
    }
  }
}

/**
 * Iterates the defs and not the state, so a value still chosen for a facet
 * that has since been switched off is ignored rather than matching nothing
 * and emptying the wall.
 */
export function matchesFilter(
  tile: TileModel,
  filter: FilterState,
  defs: FacetDef[]
): boolean {
  return defs.every((def) => {
    const wanted = filter[def.id];
    if (!wanted || wanted.length === 0) return true;
    const held = valuesFor(tile, def);
    return held.some((value) => wanted.includes(value));
  });
}

/** Drops state for facets no longer on offer, so the active count and the
    button's badge cannot claim a narrowing that is not being applied. */
export function pruneFilter(filter: FilterState, defs: FacetDef[]): FilterState {
  const live = new Set(defs.map((def) => def.id));
  const stale = Object.keys(filter).filter((id) => !live.has(id));
  if (stale.length === 0) return filter;

  const copy = { ...filter };
  for (const id of stale) delete copy[id];
  return copy;
}

function tally(tiles: TileModel[], def: FacetDef): FacetValue[] {
  const counts = new Map<string, number>();
  for (const tile of tiles) {
    for (const value of valuesFor(tile, def)) {
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
export function facetsOf(
  tiles: TileModel[],
  defs: FacetDef[]
): Record<string, FacetValue[]> {
  const out: Record<string, FacetValue[]> = {};
  for (const def of defs) out[def.id] = tally(tiles, def);
  return out;
}
