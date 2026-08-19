import { bucketLabels, dateBuckets, dateTokenMatches, isDateProperty } from "./dates";
import type { DateWindow } from "./dates";
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
  /** How the values are read. Set by typedFacets, which is the only thing
      that sees the wall and can therefore tell. */
  shape?: "text" | "date";
  /** Reference instant for date bucketing. Carried on the descriptor so the
      per-tile calls below keep their signatures. */
  now?: number;
  /** The user's own relative windows, offered alongside the built-in ones. */
  windows?: DateWindow[];
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
export function facetDefs(properties: string[], windows: DateWindow[] = []): FacetDef[] {
  const defs: FacetDef[] = properties.map((key) => ({
    id: key,
    label: facetLabel(key),
    icon: PROPERTY_ICONS[key] ?? "tag",
    keywords: PROPERTY_KEYWORDS[key] ?? `${key} property narrow`,
    source: "property",
    key,
    windows,
  }));
  return [...defs, KIND_FACET, DOMAIN_FACET];
}

/**
 * How many tiles to look at when deciding a property holds dates.
 *
 * The whole wall would be exact and needless: this is a majority test, and
 * defs are rebuilt on every read, several times per render. A sample settles
 * it in a fixed cost no matter how large the vault gets.
 */
const TYPE_SAMPLE = 200;

/**
 * Fills in each property facet's shape by looking at what the wall actually
 * carries, which the settings cannot know: they hold a property name, not what
 * that property turned out to hold.
 */
export function typedFacets(
  defs: FacetDef[],
  tiles: TileModel[],
  now: number
): FacetDef[] {
  const sample = tiles.length > TYPE_SAMPLE ? tiles.slice(0, TYPE_SAMPLE) : tiles;

  return defs.map((def) => {
    if (def.source !== "property" || !def.key) return def;

    const values: string[] = [];
    for (const tile of sample) {
      const held = tile.record.properties[def.key];
      if (held) values.push(...held);
    }

    return isDateProperty(values)
      ? { ...def, shape: "date" as const, now }
      : { ...def, shape: "text" as const };
  });
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
    case "property": {
      if (!def.key) return [];
      const held = tile.record.properties[def.key] ?? [];
      if (def.shape !== "date") return held;
      // A date expands to every bucket it still falls inside. Several values
      // from one is exactly what a multi-valued property like categories
      // already does, so nothing downstream has to know these are dates.
      // Absence is a value of its own here, so "is empty" can be offered and
      // counted like any other row rather than needing a predicate beside the
      // list. There is no row for the opposite: almost every clipping has a
      // date, so "is not empty" named nearly the whole wall and narrowed
      // nothing worth the row it took.
      if (held.length === 0) return ["empty"];

      const now = def.now ?? 0;
      const buckets = new Set<string>();
      for (const value of held) {
        for (const bucket of dateBuckets(value, now, def.windows)) buckets.add(bucket);
      }
      return [...buckets];
    }
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
    if (held.some((value) => wanted.includes(value))) return true;

    // A comparison is not a value the tile reports, so membership cannot see
    // it. Only dates carry these, and only when one has been set.
    if (def.shape !== "date" || !def.key) return false;
    const raw = tile.record.properties[def.key] ?? [];
    return wanted.some((value) => dateTokenMatches(value, raw, def.now ?? 0) === true);
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

export interface PropertyVocabulary {
  /** The values in use, most used first. */
  values: FacetValue[];
  /**
   * True when no clipping on the wall holds more than one, so the property
   * reads as a choice rather than a set. Editing a choice replaces; editing a
   * set adds and removes.
   */
  single: boolean;
}

/**
 * Every value a property actually holds across the wall, for a picker that
 * writes one.
 *
 * Raw, unlike the facets above: a date facet offers the buckets its values
 * fall into, and those are groupings rather than anything you could write back
 * to a note. Counted before filtering, so editing a clipping can still offer a
 * value the filter currently happens to be hiding.
 */
export function propertyVocabulary(tiles: TileModel[], key: string): PropertyVocabulary {
  const counts = new Map<string, number>();
  let single = true;

  for (const tile of tiles) {
    const held = tile.record.properties[key] ?? [];
    if (held.length > 1) single = false;
    for (const value of held) counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  const values = [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));

  return { values, single };
}

function tally(tiles: TileModel[], def: FacetDef): FacetValue[] {
  const counts = new Map<string, number>();
  for (const tile of tiles) {
    for (const value of valuesFor(tile, def)) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }

  const values = [...counts.entries()].map(([value, count]) => ({ value, count }));

  // Date buckets read newest to oldest, always. Sorting them by count would
  // put the widest bucket first, which is the reverse of how a date list is
  // read and moves the rows about as the wall changes.
  if (def.shape === "date") {
    const order = [...bucketLabels(def.windows), "empty"];
    return values.sort((a, b) => order.indexOf(a.value) - order.indexOf(b.value));
  }

  // Most used first, then alphabetically, so the order is stable between
  // openings rather than shuffling as counts happen to tie.
  return values.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
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
