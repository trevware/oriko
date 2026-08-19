import type { ClippingRecord } from "./scan";

/**
 * Which frontmatter properties are worth offering as filter facets.
 *
 * Pure, no DOM and no Obsidian: the settings tab renders what this returns.
 */

/** Free text, or plugin plumbing. Never suggested, but the settings list
    still shows them, so a user who wants one can add it by hand. */
const RESERVED = new Set(["title", "description", "source", "cover", "grid", "media"]);

/** ISO date, with or without a time. */
const DATE_SHAPED = /^\d{4}-\d{2}-\d{2}([T ]|$)/;

const MIN_DISTINCT = 2;
const MAX_DISTINCT = 50;
/**
 * Occurrences per distinct value. Below this the values barely recur, so
 * grouping by them puts almost every clipping in its own bucket: an author
 * field with sixteen authors across sixteen notes scores 1.00 and is no use
 * as a facet, however much you might want it.
 */
const MIN_REPETITION = 1.5;

export interface PropertyStat {
  key: string;
  /** Records carrying the key at all. */
  notes: number;
  /** Total values across those records; a list contributes each entry. */
  occurrences: number;
  distinct: number;
  suggested: boolean;
}

/**
 * A date field is the case that defeats repetition alone. In the reference
 * vault `created` holds three distinct values across 35 clippings, because
 * they were clipped on three days, which scores 11.67 and looks ideal. Judged
 * on the values rather than the key name, so a user's own `reviewed:` is
 * caught and a key that happens to be called `updated` while holding real
 * categories is not.
 */
function dateShaped(values: Set<string>): boolean {
  let dates = 0;
  for (const value of values) if (DATE_SHAPED.test(value)) dates++;
  return dates * 2 > values.size;
}

export function surveyProperties(records: ClippingRecord[]): PropertyStat[] {
  const notes = new Map<string, number>();
  const occurrences = new Map<string, number>();
  const values = new Map<string, Set<string>>();

  for (const record of records) {
    for (const [key, list] of Object.entries(record.properties)) {
      if (list.length === 0) continue;
      notes.set(key, (notes.get(key) ?? 0) + 1);
      occurrences.set(key, (occurrences.get(key) ?? 0) + list.length);
      let seen = values.get(key);
      if (!seen) {
        seen = new Set<string>();
        values.set(key, seen);
      }
      for (const value of list) seen.add(value);
    }
  }

  const stats: PropertyStat[] = [];
  for (const [key, seen] of values) {
    const distinct = seen.size;
    const total = occurrences.get(key) ?? 0;
    const suggested =
      !RESERVED.has(key) &&
      !dateShaped(seen) &&
      distinct >= MIN_DISTINCT &&
      distinct <= MAX_DISTINCT &&
      total / distinct >= MIN_REPETITION;
    stats.push({ key, notes: notes.get(key) ?? 0, occurrences: total, distinct, suggested });
  }

  // Suggested first, then the most widely used, then alphabetically so the
  // order is stable between openings rather than shuffling as counts tie.
  return stats.sort(
    (a, b) =>
      Number(b.suggested) - Number(a.suggested) ||
      b.notes - a.notes ||
      a.key.localeCompare(b.key)
  );
}
