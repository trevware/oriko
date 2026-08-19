# User-Defined Filter Properties Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the filter menu offer facets for any frontmatter property the user chooses, instead of the four it hardcodes today.

**Architecture:** Facets become `FacetDef` descriptors instead of a `keyof FilterState` union, and `FilterState` becomes an open `Record<string, string[]>`. `ClippingRecord` carries every frontmatter value as strings so any key can back a facet. A new pure `facet-catalog.ts` surveys the vault and recommends which properties are worth offering. Settings hold the enabled list; the settings tab renders the survey.

**Tech Stack:** TypeScript, esbuild, Vitest (node environment, no DOM), Obsidian plugin API.

**Spec:** `docs/superpowers/specs/2026-08-19-filter-properties-design.md`

## Global Constraints

- **A module that imports from `obsidian` cannot be unit-tested.** Vitest cannot resolve the `obsidian` package. Pure logic goes in modules with zero Obsidian imports. `scan.ts`, `filter.ts`, `facet-catalog.ts`, `commands.ts` and `settings.ts` must all stay Obsidian-free.
- **Vitest runs `environment: "node"`.** No `document`, no `window`, in any tested module.
- **The plugin never edits a note's content.** This feature only reads frontmatter.
- **Verification is `npm test` and `npx tsc --noEmit`, checking the exit code.** Piping through `head` masks a non-zero status.
- **No AI attribution anywhere in repository information.** No `Co-Authored-By`, no "generated with", no mention in commit messages or code comments.
- **Commit as you go**, one commit per task, and push to `origin`.
- **Default `filterProperties` is exactly `["categories", "status"]`** so the menu opens unchanged on upgrade.
- **Facet ids:** `kind` and `domain` for the two derived facets (singular), and the property name itself for property facets.
- **Reserved keys, never suggested:** `title`, `description`, `source`, `cover`, `grid`, `media`.

---

### Task 1: `ClippingRecord` carries every frontmatter property

**Files:**
- Modify: `src/scan.ts` (the `ClippingRecord` interface, and the return of `scanClipping`)
- Test: `tests/scan.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ClippingRecord.properties: Record<string, string[]>`. Task 2 surveys it; Task 3 reads it through `valuesFor`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/scan.test.ts`. Check how existing tests in that file call `scanClipping(path, frontmatter, body)` and match their style.

```ts
describe("scanClipping properties", () => {
  it("captures scalars, lists, numbers and booleans as string arrays", () => {
    const record = scanClipping(
      "Clippings/a.md",
      { medium: "photo", tags: ["a", "b"], rating: 4, starred: true },
      ""
    );
    expect(record.properties.medium).toEqual(["photo"]);
    expect(record.properties.tags).toEqual(["a", "b"]);
    expect(record.properties.rating).toEqual(["4"]);
    expect(record.properties.starred).toEqual(["true"]);
  });

  it("omits empty values, blank list entries and nested objects", () => {
    const record = scanClipping(
      "Clippings/a.md",
      { blank: "", nothing: null, list: ["a", "", "  "], nested: { x: 1 } },
      ""
    );
    expect(record.properties.blank).toBeUndefined();
    expect(record.properties.nothing).toBeUndefined();
    expect(record.properties.nested).toBeUndefined();
    expect(record.properties.list).toEqual(["a"]);
  });

  it("carries the unread default into properties.status", () => {
    const record = scanClipping("Clippings/a.md", {}, "");
    expect(record.status).toBe("unread");
    expect(record.properties.status).toEqual(["unread"]);
  });

  it("mirrors the normalized categories into properties.categories", () => {
    const record = scanClipping("Clippings/a.md", { categories: "solo" }, "");
    expect(record.categories).toEqual(["solo"]);
    expect(record.properties.categories).toEqual(["solo"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/scan.test.ts`
Expected: FAIL, `record.properties` is undefined.

- [ ] **Step 3: Write the implementation**

In `src/scan.ts`, add to the `ClippingRecord` interface, after `media`:

```ts
  /**
   * Every frontmatter value, normalized to strings, so any key can back a
   * filter facet. Kept whole rather than curated: the settings list has to be
   * able to offer keys the suggester rejects.
   */
  properties: Record<string, string[]>;
```

Add this function next to `asStringArray`:

```ts
/** One frontmatter value as facet values. Anything with no sensible string
    form, an object or an empty value, contributes nothing. */
function toValues(value: unknown): string[] {
  const one = (v: unknown): string | null => {
    if (typeof v === "string") return v.trim() || null;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    return null;
  };
  if (Array.isArray(value)) {
    return value.map(one).filter((v): v is string => v !== null);
  }
  const single = one(value);
  return single === null ? [] : [single];
}

function toProperties(frontmatter: Record<string, unknown>): Record<string, string[]> {
  const properties: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(frontmatter)) {
    const values = toValues(value);
    if (values.length > 0) properties[key] = values;
  }
  return properties;
}
```

In `scanClipping`, after `const grid = str(frontmatter.grid);`, add:

```ts
  const properties = toProperties(frontmatter);
  // The two facets that ship enabled take the fields computed above rather
  // than the raw frontmatter, so status keeps its "unread" default and
  // categories keeps asStringArray. A purely generic pass would drop every
  // clipping with no status line out of the Status facet.
  properties.status = [status];
  if (categories.length > 0) properties.categories = categories;
  else delete properties.categories;
```

Add `properties,` to the returned object.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/scan.test.ts` then `npm test` and `npx tsc --noEmit`
Expected: all PASS, tsc exit 0. Other test files may fail to typecheck if they build a `ClippingRecord` literal; add `properties: {}` to those fixtures.

- [ ] **Step 5: Commit**

```bash
git add src/scan.ts tests/scan.test.ts
git commit -m "feat: carry every frontmatter property on a clipping record

A facet can only be offered for a key the record actually holds, and
scanClipping read only the keys it was written to know about. Values are
normalized to string arrays so one code path serves a scalar, a list and
a number.

status and categories are overwritten from the fields computed above, not
taken raw. status defaults to unread when the key is missing, and 34 of 35
clippings in the reference vault rely on that default being visible; a
purely generic pass would drop all of them out of the Status facet."
```

---

### Task 2: Survey the vault and recommend facet-shaped properties

**Files:**
- Create: `src/facet-catalog.ts`
- Test: `tests/facet-catalog.test.ts`

**Interfaces:**
- Consumes: `ClippingRecord.properties` from Task 1.
- Produces: `surveyProperties(records: ClippingRecord[]): PropertyStat[]`, and `PropertyStat { key, notes, occurrences, distinct, suggested }`. Task 7 renders it.

- [ ] **Step 1: Write the failing tests**

Create `tests/facet-catalog.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { surveyProperties } from "../src/facet-catalog";
import type { ClippingRecord } from "../src/scan";

function record(properties: Record<string, string[]>): ClippingRecord {
  return {
    path: "a.md",
    title: "",
    source: "",
    description: "",
    categories: [],
    status: "unread",
    created: "",
    cover: "",
    grid: "",
    media: [],
    haystack: "",
    properties,
  };
}

/** n records each carrying `key` with one value drawn from `values`. */
function spread(key: string, values: string[], per = 1): ClippingRecord[] {
  const out: ClippingRecord[] = [];
  for (const value of values) {
    for (let i = 0; i < per; i++) out.push(record({ [key]: [value] }));
  }
  return out;
}

const statOf = (records: ClippingRecord[], key: string) =>
  surveyProperties(records).find((s) => s.key === key);

describe("surveyProperties", () => {
  it("counts notes, occurrences and distinct values", () => {
    const stat = statOf(
      [record({ medium: ["photo", "video"] }), record({ medium: ["photo"] })],
      "medium"
    );
    expect(stat).toMatchObject({ notes: 2, occurrences: 3, distinct: 2 });
  });

  it("suggests a property whose values recur", () => {
    expect(statOf(spread("medium", ["photo", "video"], 4), "medium")?.suggested).toBe(true);
  });

  it("rejects a property with only one distinct value", () => {
    expect(statOf(spread("type", ["clipping"], 10), "type")?.suggested).toBe(false);
  });

  it("rejects a property whose every value is unique", () => {
    const authors = Array.from({ length: 16 }, (_, i) => `author ${i}`);
    expect(statOf(spread("author", authors), "author")?.suggested).toBe(false);
  });

  it("rejects a date-shaped property even when its values repeat heavily", () => {
    // The case that motivates the rule: three clipping days across 35 notes
    // looks like an ideal facet by repetition alone, and is useless.
    const dates = ["2026-08-17", "2026-08-18", "2026-08-19"];
    expect(statOf(spread("created", dates, 12), "created")?.suggested).toBe(false);
  });

  it("rejects a timestamped date property too", () => {
    const stamps = ["2026-08-17T09:00:00", "2026-08-18T11:30:00"];
    expect(statOf(spread("logged", stamps, 12), "logged")?.suggested).toBe(false);
  });

  it("never suggests a reserved key", () => {
    expect(statOf(spread("source", ["a.com", "b.com"], 4), "source")?.suggested).toBe(false);
  });

  it("still reports an unsuggested key, since the settings list offers it", () => {
    const authors = Array.from({ length: 16 }, (_, i) => `author ${i}`);
    expect(statOf(spread("author", authors), "author")).toBeDefined();
  });

  it("rejects a property with too many distinct values", () => {
    const many = Array.from({ length: 60 }, (_, i) => `v${i}`);
    expect(statOf(spread("id", many, 3), "id")?.suggested).toBe(false);
  });

  it("orders suggested keys first, then by how many notes carry them", () => {
    const records = [
      ...spread("medium", ["photo", "video"], 4),
      ...spread("type", ["clipping"], 20),
    ];
    const keys = surveyProperties(records).map((s) => s.key);
    expect(keys[0]).toBe("medium");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/facet-catalog.test.ts`
Expected: FAIL with "Cannot find module '../src/facet-catalog'".

- [ ] **Step 3: Write the implementation**

Create `src/facet-catalog.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/facet-catalog.test.ts` then `npx tsc --noEmit`
Expected: all PASS, tsc exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/facet-catalog.ts tests/facet-catalog.test.ts
git commit -m "feat: survey which frontmatter properties are worth filtering by

Thresholds measured against the reference vault rather than guessed. The
date rule is the one that is not obvious: created holds three distinct
values across 35 clippings, because they were clipped on three days, so by
repetition alone it scores 11.67 and looks like an ideal facet while being
useless. Dates are judged by value shape, not by key name, so a custom
reviewed field is caught too.

Unsuggested keys are still reported. author scores 1.00 and is rightly not
recommended, but it is exactly the property this vault would want, so the
settings list has to be able to offer it."
```

---

### Task 3: Facets become descriptors, filter state opens up

**Files:**
- Modify: `src/filter.ts` (substantially rewritten)
- Test: `tests/filter.test.ts`

**Interfaces:**
- Consumes: `ClippingRecord.properties` from Task 1.
- Produces: `FacetSource`, `FacetDef`, `FilterState = Record<string, string[]>`, `facetDefs(properties: string[]): FacetDef[]`, `facetLabel(key: string): string`, and the reworked `emptyFilter`, `activeCount`, `isFilterEmpty`, `toggleFacet(filter, id, value)`, `matchesFilter(tile, filter, defs)`, `facetsOf(tiles, defs)`, `pruneFilter(filter, defs)`. Tasks 5, 6 and 7 all consume these. `Facet` and `FACETS` are deleted.

- [ ] **Step 1: Write the failing tests**

In `tests/filter.test.ts`, update the `tile()` helper to add `properties` to its record, derived from the options so property facets have something to read:

```ts
    record: {
      // ... existing fields unchanged
      properties: {
        categories: opts.categories ?? [],
        status: [opts.status ?? "unread"],
      },
    },
```

Update every existing call that names a facet: `"categories"` stays, `"statuses"` becomes `"status"`, `"kinds"` becomes `"kind"`, `"domains"` becomes `"domain"`. Every call to `matchesFilter` and `facetsOf` takes a defs argument. Add at the top of the file:

```ts
import { facetDefs, facetLabel, pruneFilter } from "../src/filter";

const DEFS = facetDefs(["categories", "status"]);
```

Then append these new cases:

```ts
describe("facetDefs", () => {
  it("puts configured properties first, then the derived facets", () => {
    expect(facetDefs(["categories", "status"]).map((d) => d.id)).toEqual([
      "categories",
      "status",
      "kind",
      "domain",
    ]);
  });

  it("gives a property facet the property's own name as its id", () => {
    const def = facetDefs(["medium"]).find((d) => d.id === "medium");
    expect(def).toMatchObject({ source: "property", key: "medium", label: "Medium" });
  });

  it("always offers the derived facets, even with no properties configured", () => {
    expect(facetDefs([]).map((d) => d.id)).toEqual(["kind", "domain"]);
  });
});

describe("facetLabel", () => {
  it("reads a key as a sentence", () => {
    expect(facetLabel("categories")).toBe("Categories");
    expect(facetLabel("publish_date")).toBe("Publish date");
    expect(facetLabel("publish-date")).toBe("Publish date");
  });
});

describe("toggleFacet", () => {
  it("drops the key entirely when its last value goes", () => {
    const on = toggleFacet(emptyFilter(), "categories", "design");
    expect(toggleFacet(on, "categories", "design")).toEqual({});
  });
});

describe("matchesFilter with property facets", () => {
  it("filters on a property no built-in facet knows about", () => {
    const defs = facetDefs(["medium"]);
    const photo = tile("a");
    photo.record.properties.medium = ["photo"];
    const video = tile("b");
    video.record.properties.medium = ["video"];
    const filter: FilterState = { medium: ["photo"] };

    expect(matchesFilter(photo, filter, defs)).toBe(true);
    expect(matchesFilter(video, filter, defs)).toBe(false);
  });

  it("ignores a chosen value whose facet is no longer configured", () => {
    // Switching a property off in settings must not empty the wall.
    const only = tile("a", { categories: ["design"] });
    expect(matchesFilter(only, { medium: ["photo"] }, DEFS)).toBe(true);
  });
});

describe("pruneFilter", () => {
  it("drops state for facets that are no longer configured", () => {
    const filter: FilterState = { categories: ["design"], medium: ["photo"] };
    expect(pruneFilter(filter, DEFS)).toEqual({ categories: ["design"] });
  });

  it("returns the same object when nothing is stale, so callers can skip work", () => {
    const filter: FilterState = { categories: ["design"] };
    expect(pruneFilter(filter, DEFS)).toBe(filter);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/filter.test.ts`
Expected: FAIL, `facetDefs` / `facetLabel` / `pruneFilter` are not exported.

- [ ] **Step 3: Write the implementation**

Rewrite `src/filter.ts`. Keep the existing file header comment about the two filtering rules verbatim, it still describes the behaviour exactly. Replace the types and functions with:

```ts
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
  const defs = properties.map((key) => ({
    id: key,
    label: facetLabel(key),
    icon: PROPERTY_ICONS[key] ?? "tag",
    keywords: PROPERTY_KEYWORDS[key] ?? `${key} property narrow`,
    source: "property" as const,
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
```

Delete the old `Facet` type, the `FACETS` constant, and the old `valuesFor` switch.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/filter.test.ts`
Expected: all PASS. `npx tsc --noEmit` will still fail in `view.ts` and `commands.ts`, which Tasks 5 and 6 fix. That is expected at this point.

- [ ] **Step 5: Commit**

```bash
git add src/filter.ts tests/filter.test.ts
git commit -m "feat: describe facets as data instead of a fixed union

Facet was keyof FilterState, so the set of things you could filter by was
the set the type declared. It is now a FacetDef list built from settings,
and FilterState is keyed by facet id.

matchesFilter iterates the defs rather than the state. Switching a property
off in settings while a value is still chosen for it would otherwise match
nothing and empty the wall; pruneFilter then clears those keys so the active
count cannot claim a narrowing that is not being applied.

Property facets take the property's own name as their id, so a facet needs
no id-to-key mapping. The two derived facets, which no frontmatter backs,
keep hardcoded descriptors."
```

---

### Task 4: The `filterProperties` setting

**Files:**
- Modify: `src/settings.ts`, `src/main.ts:233-239` (`loadSettings`)
- Test: none. This is two constants and one defensive copy; the behaviour is covered where it is consumed.

**Interfaces:**
- Consumes: nothing.
- Produces: `PowerGridSettings.filterProperties: string[]`, default `["categories", "status"]`. Tasks 5, 6 and 7 read it.

- [ ] **Step 1: Add the setting**

In `src/settings.ts`, add to `PowerGridSettings` after `useResolvers`:

```ts
  /**
   * Frontmatter keys offered as filter facets, in the order they appear in the
   * menu. The default reproduces the four-facet menu this replaced.
   */
  filterProperties: string[];
```

Add to `DEFAULT_SETTINGS`:

```ts
  filterProperties: ["categories", "status"],
```

- [ ] **Step 2: Copy the array on load**

In `src/main.ts`, in `loadSettings`, below the existing `grids` line:

```ts
    this.settings.filterProperties = [
      ...(this.settings.filterProperties ?? DEFAULT_SETTINGS.filterProperties),
    ];
```

This is the same bug the `grids` line above it guards against: `Object.assign` copies the array reference, so a vault with no saved value would push straight into `DEFAULT_SETTINGS` and the module-level default would start carrying user data.

- [ ] **Step 3: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: the only remaining errors are in `view.ts` and `commands.ts`, from Task 3.

- [ ] **Step 4: Commit**

```bash
git add src/settings.ts src/main.ts
git commit -m "feat: settings hold which properties the filter offers

Defaults to categories and status, which is exactly the menu that existed
before, so upgrading changes nothing on screen. The array is copied on load
for the same reason grids is: Object.assign copies the reference, and a vault
with no saved value would otherwise write user data into the module default."
```

---

### Task 5: The command palette builds its filters from defs

**Files:**
- Modify: `src/commands.ts:1-2` (imports), `:83-102` (the three lookup tables), `:69-81` (`PaletteContext`), `:256-292` (`filterCommands`)
- Test: `tests/commands.test.ts`

**Interfaces:**
- Consumes: `FacetDef`, `FilterState`, `FacetValue` from Task 3.
- Produces: `PaletteContext.facetDefs: FacetDef[]`, and `PaletteActions.toggleFacet(id: string, value: string)`. Task 6 supplies both.

- [ ] **Step 1: Update the test fixture and write the failing tests**

In `tests/commands.test.ts`, update the `context()` helper:

```ts
import { emptyFilter, facetDefs } from "../src/filter";

const DEFS = facetDefs(["categories", "status"]);

function context(over: Partial<PaletteContext> = {}): PaletteContext {
  return {
    // ... existing fields unchanged
    facetDefs: DEFS,
    facets: { categories: [], status: [], kind: [], domain: [] },
    filter: emptyFilter(),
    // ...
  };
}
```

Update the existing cases that reference `statuses`, `kinds` or `domains` to `status`, `kind`, `domain`. Then append:

```ts
it("offers a user-defined property as a filter", () => {
  const ctx = context({
    facetDefs: facetDefs(["medium"]),
    facets: { medium: [{ value: "photo", count: 3 }], kind: [], domain: [] },
  });
  expect(buildCommands(ctx).map((c) => c.id)).toContain("filter:medium");
});

it("labels a property facet from its key", () => {
  const ctx = context({
    facetDefs: facetDefs(["publish_date"]),
    facets: { publish_date: [{ value: "2026", count: 2 }], kind: [], domain: [] },
  });
  expect(find(ctx, "filter:publish_date")?.label).toBe("Filter by publish date");
});
```

`filterCommands` is private; the file's existing tests reach it through the exported `buildCommands`, and the `find(ctx, id)` helper at the top of the test file already does exactly that. Use it, and do not export `filterCommands`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/commands.test.ts`
Expected: FAIL, `facetDefs` is not a property of `PaletteContext`.

- [ ] **Step 3: Write the implementation**

Change the imports at the top of `src/commands.ts`:

```ts
import type { FacetDef, FacetValue, FilterState } from "./filter";
```

Delete `FACET_LABELS`, `FACET_ICONS` and `FACET_KEYWORDS` entirely. In `PaletteContext`, replace the `facets` line with:

```ts
  /** The facets on offer, in menu order. */
  facetDefs: FacetDef[];
  facets: Record<string, FacetValue[]>;
```

Change the action signature:

```ts
  toggleFacet(id: string, value: string): void;
```

Rewrite the loop in `filterCommands`:

```ts
  for (const def of context.facetDefs) {
    const values = context.facets[def.id] ?? [];
    // A facet nothing on the wall carries has nothing to offer. The menu
    // shows it disabled so its set reads whole; a search result cannot.
    if (values.length === 0) continue;

    const chosen = context.filter[def.id] ?? [];
    const label = `Filter by ${def.label.toLowerCase()}`;
    items.push({
      id: `filter:${def.id}`,
      label,
      icon: def.icon,
      section: "Filters",
      detail: chosen.length > 0 ? `${chosen.length}` : undefined,
      keywords: def.keywords,
      stage: {
        title: label,
        placeholder: `${label}…`,
        items: () =>
          (context.facets[def.id] ?? []).map((entry) => ({
            id: `filter:${def.id}:${entry.value}`,
            label: entry.value,
            // Blank keeps the gutter, so labels do not jump as values tick.
            icon: (context.filter[def.id] ?? []).includes(entry.value) ? "check" : "",
            section: "Filters" as const,
            detail: String(entry.count),
            keepOpen: true,
            run: () => actions.toggleFacet(def.id, entry.value),
          })),
      },
    });
  }

  const active = Object.values(context.filter).reduce((n, v) => n + v.length, 0);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/commands.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands.ts tests/commands.test.ts
git commit -m "feat: build palette filter commands from facet descriptors

The three Record<Facet, string> lookup tables were a parallel copy of the
facet list that had to be edited in step with it. They are now fields on the
descriptor, so a facet carries its own label, icon and search keywords and
there is one list to keep correct."
```

---

### Task 6: The view builds and prunes its facets

**Files:**
- Modify: `src/view.ts:27-35` (imports), `:601-611` (`applyFilter`), `:615-628` (`activeFilter`, `setFilter`), `:626-676` (`openFilter`), `:737-770` (`paletteContext`)
- Test: none possible. `view.ts` imports `obsidian`, so Vitest cannot load it. Verified by `npx tsc --noEmit`, `npm run build`, and using the plugin.

**Interfaces:**
- Consumes: everything from Tasks 3, 4 and 5.
- Produces: `PowerGridView.refreshFacets(): void`, public, called by Task 7 when settings change.

- [ ] **Step 1: Update the imports and add a defs accessor**

```ts
import {
  activeCount,
  emptyFilter,
  facetDefs,
  facetsOf,
  isFilterEmpty,
  matchesFilter,
  pruneFilter,
  toggleFacet,
} from "./filter";
import type { FacetDef, FilterState } from "./filter";
```

Add a private method near `activeFilter`:

```ts
  /** The facets on offer, rebuilt from settings on each read. The list is
      four or five items long, so caching it would cost more in staleness
      than it saves. */
  private defs(): FacetDef[] {
    return facetDefs(this.plugin.settings.filterProperties);
  }
```

- [ ] **Step 2: Thread the defs through filtering**

In `applyFilter`, replace the filtering line:

```ts
    const defs = this.defs();
    const shown = isFilterEmpty(filter)
      ? this.facets
      : this.facets.filter((tile) => matchesFilter(tile, filter, defs));
```

In `activeFilter`, prune on read so a facet switched off in settings stops counting:

```ts
  private activeFilter(): FilterState {
    const stored = this.filters.get(this.activeGrid().name) ?? emptyFilter();
    const pruned = pruneFilter(stored, this.defs());
    if (pruned !== stored) this.filters.set(this.activeGrid().name, pruned);
    return pruned;
  }
```

In `setFilter`, change the key argument type only where needed; the body is unchanged.

The second `matchesFilter` call around line 727 also needs the defs argument.

- [ ] **Step 3: Rebuild the filter menu from defs**

Replace the body of `openFilter`'s `build` with:

```ts
    const build = (): MenuItem[] => {
      const defs = this.defs();
      const available = facetsOf(this.facets, defs);
      const filter = this.activeFilter();

      const items: MenuItem[] = defs.map((def) => {
        const values = available[def.id] ?? [];
        const chosen = filter[def.id] ?? [];
        return {
          icon: def.icon,
          label: def.label,
          // Nothing to offer is still worth showing: an absent row reads as a
          // missing feature, a disabled one reads as an empty shelf.
          disabled: values.length === 0,
          detail: values.length === 0 ? "none" : chosen.length > 0 ? `${chosen.length}` : undefined,
          submenu: values.map((entry) => ({
            icon: chosen.includes(entry.value) ? "check" : "",
            label: entry.value,
            detail: String(entry.count),
            keepOpen: true,
            onSelect: () => this.setFilter(toggleFacet(this.activeFilter(), def.id, entry.value)),
          })),
        };
      });

      const active = activeCount(filter);
      items.push({
        icon: "circle-slash",
        label: "Clear filters",
        divider: true,
        disabled: active === 0,
        detail: active > 0 ? `${active} active` : undefined,
        keepOpen: true,
        onSelect: () => this.setFilter(emptyFilter()),
      });

      return items;
    };
```

Delete the `labels` and `icons` objects.

- [ ] **Step 4: Supply the defs to the palette, and add the refresh hook**

In `paletteContext`, replace the `facets` line:

```ts
      facetDefs: this.defs(),
      facets: facetsOf(this.facets, this.defs()),
```

and change the action to take an id:

```ts
        toggleFacet: (id, value) =>
          this.setFilter(toggleFacet(this.activeFilter(), id, value)),
```

Add a public method near `togglePalette`:

```ts
  /**
   * Public: the settings tab calls this when the property list changes, so an
   * open wall picks up a new facet without a reload. Filters for a facet that
   * has just been switched off are pruned by activeFilter on the way through.
   */
  refreshFacets(): void {
    this.applyFilter({ replace: true });
  }
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit` then `npm test` then `npm run build`
Expected: tsc exit 0, all tests pass, build exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/view.ts
git commit -m "feat: build the wall's filter menu from the configured facets

The menu and the palette both read one descriptor list, so a property the
user enables appears in both without either surface knowing what a property
is. Filters are pruned as they are read, so switching a property off cannot
leave a count claiming a narrowing that is no longer applied."
```

---

### Task 7: The settings tab

**Files:**
- Modify: `src/settings-tab.ts`
- Test: none possible. `settings-tab.ts` imports `obsidian`. Verified by `npx tsc --noEmit`, `npm run build`, and using the plugin.

**Interfaces:**
- Consumes: `surveyProperties` and `PropertyStat` from Task 2, `facetLabel` from Task 3, `filterProperties` from Task 4, `refreshFacets` from Task 6.
- Produces: nothing.

- [ ] **Step 1: Add the imports**

```ts
import { App, PluginSettingTab, Setting } from "obsidian";
import { surveyProperties } from "./facet-catalog";
import { facetLabel } from "./filter";
import { PowerGridView, VIEW_TYPE_GRID } from "./view";
import type PowerGridPlugin from "./main";
```

This introduces no import cycle. `view.ts` does not import `settings-tab.ts`, and its only reference to `main.ts` is `import type`, which is erased at compile time. Only `main.ts` imports `settings-tab.ts`, at runtime, in one direction.

- [ ] **Step 2: Add the save-and-repaint helper**

Add as a private method on `PowerGridSettingTab`:

```ts
  /** Saves, repaints any open wall so a new facet appears at once, and
      redraws this tab so the enabled and available lists swap correctly. */
  private async commit(properties: string[]): Promise<void> {
    this.plugin.settings.filterProperties = properties;
    await this.plugin.saveSettings();
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_GRID)) {
      if (leaf.view instanceof PowerGridView) leaf.view.refreshFacets();
    }
    this.display();
  }
```

- [ ] **Step 3: Render the section**

Add at the end of `display()`:

```ts
    const enabled = this.plugin.settings.filterProperties;

    new Setting(containerEl).setName("Filter properties").setHeading();

    containerEl.createEl("p", {
      cls: "setting-item-description",
      text:
        "Frontmatter properties the filter menu offers, in this order. " +
        "Media type and Source are always available and are not listed here, " +
        "because no property backs them.",
    });

    enabled.forEach((key, index) => {
      new Setting(containerEl)
        .setName(facetLabel(key))
        .setDesc(key)
        .addExtraButton((button) =>
          button
            .setIcon("chevron-up")
            .setTooltip("Move up")
            .setDisabled(index === 0)
            .onClick(() => {
              const next = [...enabled];
              [next[index - 1], next[index]] = [next[index], next[index - 1]];
              void this.commit(next);
            })
        )
        .addExtraButton((button) =>
          button
            .setIcon("chevron-down")
            .setTooltip("Move down")
            .setDisabled(index === enabled.length - 1)
            .onClick(() => {
              const next = [...enabled];
              [next[index], next[index + 1]] = [next[index + 1], next[index]];
              void this.commit(next);
            })
        )
        .addExtraButton((button) =>
          button
            .setIcon("x")
            .setTooltip("Remove")
            .onClick(() => void this.commit(enabled.filter((k) => k !== key)))
        );
    });

    if (enabled.length === 0) {
      containerEl.createEl("p", {
        cls: "setting-item-description",
        text: "No properties enabled. The menu still offers Media type and Source.",
      });
    }

    const survey = surveyProperties(this.plugin.index.records()).filter(
      (stat) => !enabled.includes(stat.key)
    );

    if (survey.length > 0) {
      new Setting(containerEl).setName("Found in your clippings").setHeading();

      for (const stat of survey) {
        const notes = `${stat.notes} ${stat.notes === 1 ? "note" : "notes"}`;
        const values = `${stat.distinct} ${stat.distinct === 1 ? "value" : "values"}`;
        new Setting(containerEl)
          .setName(facetLabel(stat.key))
          // The counts are the whole reason this list is worth showing: they
          // are what tells you a property is worth filtering by before you
          // switch it on.
          .setDesc(
            stat.suggested
              ? `${stat.key} · ${notes}, ${values} · recommended`
              : `${stat.key} · ${notes}, ${values}`
          )
          .addButton((button) => {
            // The recommended ones get the accent treatment, so the list reads
            // as a recommendation rather than an undifferentiated dump.
            if (stat.suggested) button.setCta();
            button
              .setButtonText("Add")
              .onClick(() => void this.commit([...enabled, stat.key]));
          });
      }
    }

    let typed = "";
    new Setting(containerEl)
      .setName("Add a property")
      .setDesc("For a property you have not started filling in yet.")
      .addText((text) =>
        text.setPlaceholder("property name").onChange((value) => {
          typed = value.trim();
        })
      )
      .addButton((button) =>
        button.setButtonText("Add").onClick(() => {
          if (!typed || enabled.includes(typed)) return;
          void this.commit([...enabled, typed]);
        })
      );
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` then `npm test` then `npm run build`
Expected: tsc exit 0, all tests pass, build exit 0.

- [ ] **Step 5: Build into the vault and check it by hand**

Run: `node esbuild.config.mjs`

Then in Obsidian, with the reference vault:

1. Open Power Grid. The filter button offers Categories, Status, Media type, Source, in that order. Nothing has changed.
2. Settings, Power Grid, Filter properties. Categories and Status are listed as enabled. Below, "Found in your clippings" lists `author`, `tags`, `type`, `created`, `updated`, `published`, `title`, `source`, `description` with their counts. None is marked recommended in this vault, which is correct.
3. Add `author`. The filter menu now offers an Author facet listing the sixteen authors with counts.
4. Choose an author. The wall narrows. The filter badge reads 1.
5. Remove `author` from settings while that filter is still active. The wall returns to everything and the badge returns to 0, rather than emptying.
6. Move Status above Categories. The menu order follows.
7. Add a property that no clipping carries, through the text field. It appears in the menu, disabled, reading "none".

- [ ] **Step 6: Commit and push**

```bash
git add src/settings-tab.ts
git commit -m "feat: choose which properties the filter offers, from settings

The list shows every property found in the clippings with its note and value
counts, recommended ones first, because the recommendation rule rightly
rejects properties a user still wants. author scores 1.00 repetition in the
reference vault and is not recommended, yet it is the most useful facet that
vault could add, so it has to be one click rather than a remembered spelling.
The text field covers a property that has been decided on but not yet filled
in, which no survey can find."
git push origin HEAD
```

---

## Self-review notes

Spec coverage checked section by section:

- "The model", `FacetDef` and open `FilterState`: Task 3.
- "Data shapes", `properties` and the status/categories overwrite: Task 1.
- "Settings" and the `loadSettings` defensive copy: Task 4.
- "Which properties get suggested", all five rules and the thresholds: Task 2.
- "Settings UI", enabled list with reorder and remove, survey list, text field: Task 7.
- "Menus", defs-driven, label derivation, icon hints, order, stale pruning: Tasks 3, 5 and 6.
- "Testing", all three test files: Tasks 1, 2, 3 and 5.
- "Not doing": nothing in any task adds typed facets, per-grid property sets, custom labels or frontmatter writes.
