/**
 * Which frontmatter keys the plugin may write, and how their values change.
 *
 * Pure, no DOM and no Obsidian, so the contract below is testable on its own
 * rather than only discoverable by writing to somebody's notes.
 */

/**
 * The Web Clipper's own keys. The vault treats these as a contract and
 * says never to modify, reorder or remove any of them, so the detail view
 * shows them and will not write them. Editing `title` here would rewrite the
 * clipped page's own record of itself.
 */
const CLIPPER_KEYS = new Set([
  "title",
  "source",
  "author",
  "published",
  "created",
  "description",
  "tags",
]);

/**
 * Keys the plugin owns. `type` is the parse flag, so clearing it would unfile
 * the clipping; `grid` has its own write path in view.assign and two routes to
 * one key is how they drift; `cover` and `media` are pointers at files, not
 * values to pick from a list.
 */
const PLUGIN_KEYS = new Set(["type", "grid", "cover", "media"]);

/** The status vocabulary, in reading order rather than alphabetical: it is a
    progression, and a picker should show it as one. */
export const STATUSES = ["unread", "read", "archived"];

export function isEditable(key: string): boolean {
  const name = key.trim().toLowerCase();
  return name.length > 0 && !CLIPPER_KEYS.has(name) && !PLUGIN_KEYS.has(name);
}

/** Returns a new list; never edits the one it was given. */
export function withValue(values: string[], value: string): string[] {
  const wanted = value.trim();
  if (!wanted || values.includes(wanted)) return [...values];
  return [...values, wanted];
}

/** Returns a new list; never edits the one it was given. Removes every
    occurrence, so a value duplicated by hand cannot survive one click. */
export function withoutValue(values: string[], value: string): string[] {
  return values.filter((held) => held !== value);
}

/** Whether a value is held by every clipping in a selection, some, or none. */
export type Holding = "all" | "some" | "none";

export function holdingAcross(held: readonly (readonly string[])[], value: string): Holding {
  const count = held.filter((values) => values.includes(value)).length;
  if (count === 0) return "none";
  return count === held.length ? "all" : "some";
}

/**
 * One tap on a value across a selection: held by all, it comes off all of
 * them; held by some or none, it goes on all of them. The tick and the dash
 * both mean "not yet everywhere", and the tap makes it everywhere. A
 * single-choice property replaces rather than adds, as it does for one
 * clipping. Returns new lists; never edits the ones it was given.
 */
export function toggleAcross(
  held: readonly (readonly string[])[],
  value: string,
  single: boolean
): string[][] {
  const everywhere = holdingAcross(held, value) === "all";
  return held.map((values) => {
    if (everywhere) return single ? [] : withoutValue([...values], value);
    return single ? [value] : withValue([...values], value);
  });
}
