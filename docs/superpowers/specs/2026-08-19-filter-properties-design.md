# Power Grid: User-Defined Filter Properties

## Why

The filter menu offers four facets and always the same four. `FilterState` is a fixed object, `Facet` is literally `keyof FilterState`, and `scanClipping` reads only the frontmatter keys it was written to know about. A user who adds a property to their clippings and starts filling it in has no way to filter by it, and no way to find out that they cannot except by looking.

The goal is that the filter menu reflects the vault. A property you actually use should be one click from being filterable, and a property the plugin has never heard of should be addable by name.

## The model

A **facet** is a described thing rather than a hardcoded one:

```ts
export type FacetSource = "property" | "kind" | "domain";

export interface FacetDef {
  /** Stable id: the FilterState key, and the menu item id. */
  id: string;
  label: string;
  icon: string;
  keywords: string;
  source: FacetSource;
  /** The frontmatter key. Set only when source is "property". */
  key?: string;
}
```

Two facets stay derived, because no frontmatter key backs them: **Media type** reads `tile.kind`, and **Source** reads the domain of `record.source`. Every other facet is a **property facet**, naming a frontmatter key.

`FilterState` opens up to match:

```ts
export type FilterState = Record<string, string[]>;   // facet id -> chosen values
```

The two filtering rules are unchanged and remain the point of the feature: **within a facet, any**, so picking two values widens; **across facets, all**, so combining facets narrows.

### Why the state is keyed by facet id, not by frontmatter key

Derived facets have no frontmatter key, so keying by property name would need a second channel for them, which is the two-kinds-of-facet split this change exists to remove. Ids are `kind`, `domain`, and for a property facet the property name itself, so a property facet's id and key coincide and no mapping table is needed.

## Data shapes

`ClippingRecord` gains one field:

```ts
/** Every frontmatter value, normalized to strings, so any key can back a
    facet. Kept whole rather than curated: the settings list has to be able to
    offer keys the suggester rejects. */
properties: Record<string, string[]>;
```

Normalization, which is the existing `asStringArray` widened:

| frontmatter value | becomes |
| --- | --- |
| `"unread"` | `["unread"]` |
| `[a, b]` | `["a", "b"]` |
| `7`, `true` | `["7"]`, `["true"]` |
| `""`, `null`, missing | omitted |
| a nested object | omitted |

Empty strings are dropped from arrays too, so a trailing `-` in a YAML list does not become a blank chip in the menu.

**Two keys are then overwritten from the fields `scanClipping` already computes**, after the generic pass:

```
properties.status     = [record.status]        // carries the "unread" default
properties.categories = record.categories      // carries asStringArray
```

This is load-bearing. `status` defaults to `"unread"` when the key is missing, and 34 of 35 clippings in the reference vault rely on that default being visible. A purely generic pass would drop every clipping with no `status:` line out of the Status facet, which is a silent regression in a facet that ships enabled.

### Settings

```ts
/** Frontmatter keys offered as filter facets, in menu order. */
filterProperties: string[];   // default ["categories", "status"]
```

The default reproduces today's menu exactly, so upgrading changes nothing on screen.

`loadSettings` needs the same defensive copy `grids` already gets:

```ts
this.settings.filterProperties = [...(this.settings.filterProperties ?? DEFAULT_SETTINGS.filterProperties)];
```

`Object.assign` copies the array reference, not the array. Without this line, a vault with no saved value would push straight into `DEFAULT_SETTINGS` and the module-level default would start carrying user data. This is the same bug `grids` already has a comment about.

## Which properties get suggested

The settings tab surveys the vault and recommends the properties that look like facets. Two pure functions, in a new `facet-catalog.ts`:

```ts
export interface PropertyStat {
  key: string;
  notes: number;      // records carrying the key
  occurrences: number;
  distinct: number;
  suggested: boolean;
}

export function surveyProperties(records: ClippingRecord[]): PropertyStat[];
```

A key is suggested when all of these hold:

- **Not reserved.** `title`, `description`, `source`, `cover`, `grid`, `media`. These are free text or plugin plumbing.
- **Not date-shaped.** More than half its distinct values match `YYYY-MM-DD`, optionally followed by a time. Matched on the values, not the key name, so a user's own `reviewed:` is caught while a key called `updated` holding real categories is not.
- **At least 2 distinct values.** One value cannot narrow anything.
- **At most 50 distinct values.**
- **Repetition of at least 1.5**, that is `occurrences / distinct`. Values have to recur across notes for grouping by them to mean anything.

### Where those thresholds come from

Measured against the reference vault of 35 clippings rather than guessed:

```
key            notes  occur distinct  repeat   verdict
categories        34    108       21    5.14   suggest
created           35     35        3   11.67   reject: date-shaped
updated           34     34        2   17.00   reject: date-shaped
author            16     16       16    1.00   reject: repeat too low
status            34     34        1   34.00   reject: one value so far
tags              35     35        1   35.00   reject: one value
title             35     35       35    1.00   reject: reserved, and repeat 1.00
source            29     29       29    1.00   reject: reserved
published         16     16       15    1.07   reject: repeat too low
```

The date rule is the one that is not obvious. `created` has three distinct values across the whole vault, because the clippings were made on three days, so by repetition alone it looks like an ideal facet and is in fact useless. Dates are excluded by shape for that reason.

`author` is rejected and that is the right call for a suggestion, but it is exactly the property a user of this vault would want. That asymmetry is why suggestion is not the only route in.

## Settings UI

One section, "Filter properties", in the existing settings tab. It has to stay small: a settings row per property put a full-height card on screen for every key in the vault, which is thirteen cards to express a list of two words.

**Enabled properties are chips**, in menu order, each with a remove control. Removing is not destructive; the property returns to the suggestions.

**One "Add a property" row**, a text field with an Obsidian `AbstractInputSuggest` attached. That single control does both jobs: it type-aheads the keys already in the clippings, suggested ones first, and it still accepts a property that has been decided on but not yet filled in, which no survey can find. Enter, the Add button, or picking a suggestion all commit.

A `<datalist>` was the obvious way to get type-ahead out of one input and is the wrong one: Chromium draws that popup itself and it takes no styling, so it lands on the settings pane as a black box in a bold serif stack matching neither the theme nor the page. `AbstractInputSuggest` renders in the same popover the file and folder suggesters use. It costs a `minAppVersion` bump to 1.6.6, which is when `selectSuggestion` became public API.

**Counts are not shown.** `surveyProperties` still computes notes, occurrences and distinct values, because that is how the suggestion order is decided, but the numbers are working out rather than something to read.

**No reordering control.** Order is the order properties are added; to change it, remove and re-add. Up and down buttons on every row were most of what made the first version of this section heavy, and reordering four facets is rare enough not to earn permanent screen space.

Changing any of this saves settings, reprunes active filters, and repaints the view.

Because this section renders in Obsidian's settings pane rather than inside `.power-grid-view`, the plugin's `--pg-*` surface tokens are out of scope and would resolve to nothing. The chips use Obsidian's own variables, which is also what keeps the section looking like the rest of the settings.

## Menus

The `Facet` type and the `FACETS` constant both go. Nothing persists a facet id, so there is no migration: filter state lives in an in-memory `Map` in `view.ts` and is rebuilt every session. The two derived facets take the ids `kind` and `domain`, singular, since a facet id now names one thing rather than a bucket.

`view.ts`'s `openFilter` and `commands.ts`'s `filterCommands` both map over the defs instead of the `FACETS` constant. The three `Record<Facet, string>` lookup tables in `commands.ts` and the two inline ones in `view.ts` collapse into fields on `FacetDef`.

**Label** for the two derived facets is fixed, "Media type" and "Source". For a property facet it derives from the key in sentence case: `categories` to "Categories", `publish_date` and `publish-date` to "Publish date". Sentence case rather than title case, matching the vault's Linter setting and Obsidian's own property display.

**Icon** comes from a small hint map for keys the plugin knows (`categories` to `tag`, `status` to `circle-dot`), and `tag` otherwise.

**Order** is the configured properties first, then Media type, then Source. With the default settings that is Categories, Status, Media type, Source, which is exactly today's order.

**Stale filters.** `matchesFilter` iterates the defs and not the state, so a value still selected for a facet that has since been switched off is ignored rather than emptying the wall. `pruneFilter(filter, defs)` drops those keys outright so `activeCount` and the button's badge stay honest; it runs when settings change and when a grid is activated.

## Testing

`tests/facet-catalog.test.ts`, new:

- a list-valued property with recurring values is suggested
- a date-valued property is rejected even with high repetition
- a one-value property is rejected
- a property whose values are all unique is rejected
- a reserved key is never suggested
- surveyed stats count notes, occurrences and distinct values correctly
- an unsuggested key is still present in the survey, since the UI has to offer it

`tests/filter.test.ts`, extended, keeping every existing case:

- toggling adds and removes, and deletes the key when its last value goes
- `matchesFilter` ignores a state key with no matching def
- within-facet OR and across-facet AND still hold with property facets
- `facetsOf` counts per def, including a property facet
- `pruneFilter` drops stale keys and leaves live ones

`tests/scan.test.ts`, extended:

- properties captures scalars, lists, numbers and booleans
- empty values and nested objects are omitted
- `properties.status` is `["unread"]` when the note has no status
- `properties.categories` matches `record.categories`

## Not doing

- **Typed facets.** Every value is a string and equality is exact. No numeric ranges, no date ranges, no sorting by value type.
- **Per-grid property sets.** `filterProperties` is global. Filter *state* stays per-grid and in memory, as it is today.
- **Custom labels or icons per property.** Derived from the key.
- **Writing frontmatter.** This feature only ever reads. The `grid` key remains the single exception in the plugin.
