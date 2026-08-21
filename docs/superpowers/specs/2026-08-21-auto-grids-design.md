# Power Grid: Auto-grids

## Why

Grids are places a clipping is put. Putting it there is a write, and it is exclusive: one key, one grid. That is the right model for a working set kept apart from an archive, and the wrong one for every collection whose definition is already sitting in the frontmatter. "Everything unread", "everything tagged design", "anything clipped in the last month" are all things the wall can already compute and already lets you narrow to, but only as a filter you re-apply by hand and lose on the next switch.

An auto-grid is that narrowing, named, given an icon, and put in the switcher beside the grids you filled by hand. Nothing is written to any note to belong to one.

## The model

An auto-grid is a **named `FilterState`**. It appears in the switcher, takes a hotkey position, holds its own ad-hoc filter, and can be renamed, reordered and deleted like any other grid. What it does not have is membership: a clipping is in it because it matches, and stops being in it the moment its properties change.

**Home stays everything.** A clipping matching an auto-grid is still in home. `effectiveGrid` is untouched, and the guarantee it exists for, that no clipping can end up in a collection no view will show, is untouched with it. Auto-grids are lenses over the wall, not a routing layer above it.

**Overlap is expected.** A clipping matching three auto-grids appears in three. This follows from the above and is not a defect to design around: the same clipping already appears under three categories in the filter menu.

**A manual grid's clippings are eligible too.** Rules run over every clipping, not over home alone, so an auto-grid for `status: unread` includes the unread things sitting in Manga. This is the only reading consistent with home staying everything, and it is what makes an auto-grid a view of the vault rather than a view of one wall.

### Why the rules are a stored FilterState

The obvious alternative is a rule language: boolean groups, comparisons, text predicates. It was rejected because `FilterState` is already the thing the user composes when they filter the wall, `matchesFilter` already evaluates it with tested semantics ("within a facet, any; across facets, all"), and date facets already carry both forms worth saving: a bucket label re-evaluates against `now` on every paint, so a rule holding one is a rolling window, while a `before:` / `on-or-after:` token from the custom prompt is an absolute cutoff that stays put. "Clipped this month" therefore needs nothing new, and neither does "clipped since the relaunch".

More importantly it means there is no rule editor to design. The rule editor is the filter menu, and creating an auto-grid is narrowing the wall until it looks right and giving it a name. A separate query builder would be a second way to express something the plugin already expresses, and the two would drift.

The cost is that `FilterState` cannot say "not". That is a real gap, `status is not archived` being an obvious want, and it is deliberately left to a later change rather than smuggled in as a special case. See "Not in this change".

## Data shapes

```ts
// spaces.ts
export interface GridSpace {
  name: string;
  icon: string;
  /** Present on an auto-grid: the rules its membership is computed from.
      Absent on a manual grid, whose membership is the `grid:` key. */
  rules?: FilterState;
}
```

One list, not two. `settings.grids` keeps both kinds in one order, because the order drives the hotkey positions and a second list would need an interleaving order anyway. Existing settings migrate by having no `rules` field, which is exactly what a manual grid is.

Home is still implicit and still cannot be an auto-grid: it is the remainder, and a remainder with rules is a contradiction.

```ts
// spaces.ts
export function isAutoGrid(space: GridSpace): boolean;

/**
 * The single property write that would make a clipping match, or null when
 * there isn't one. See "Dropping onto an auto-grid".
 */
export function assignableValue(
  space: GridSpace,
  defs: FacetDef[]
): { key: string; value: string } | null;
```

## Evaluation

Membership runs on tiles, after `buildTiles`, not on records. Two reasons, both structural: `buildTiles` drops any record whose cover does not resolve, so the set of tiles is not the set of records, and `kind` is produced by `pickCover` and is not reachable from a `ClippingRecord` at all. Evaluating rules earlier would mean either calling `pickCover` anyway, which is the expensive half, or forbidding `kind` in rules and losing "everything that is a video" as an auto-grid.

`paint()` gains one branch:

```
manual:  records -> filterByGrid -> buildTiles ---------------------> facets
auto:    records ------------------> buildTiles -> matchesFilter(rules) -> facets
```

and everything downstream is unchanged. `this.facets` keeps its current contract, "the grid's tiles before the ad-hoc filter", which for an auto-grid means the tiles its rules admit. Facet counts inside an auto-grid are therefore counts within the rule, which is what makes narrowing further legible.

The rules and the ad-hoc filter are the same type evaluated by the same matcher at two different stages. Stacking a filter on top of an auto-grid needs no new code and no new concept.

### The defs ordering, which is circular if written naively

`defs()` reads `this.facets`, because `typedFacets` samples the wall to decide whether a property holds dates. For an auto-grid `this.facets` is the rules' result, so computing it needs defs that were computed before the rules ran.

Rule evaluation therefore uses defs derived from **all** tiles, computed once in `paint()` before the branch, and kept separate from the display defs that `defs()` returns. This is a handful of lines and it is the single thing most likely to be got wrong by someone who does not know it is there.

### Cost

An auto-grid pays `buildTiles` over every record on each paint, where a manual grid pays it over its own slice. `buildTiles` is synchronous and cache-backed, so this is expected to be invisible at realistic vault sizes.

If it is not, the fix is to build all tiles once per index change, cache them on the view, and make every grid a partition of that cache. That is a better shape and makes grid switching cheaper across the board, but it takes on invalidation that today's rebuild-every-paint gets for free (archiver cache updates, the `unloadable` signature map). It is deliberately not in this change: it is an optimisation with its own risks, and it should be made when there is a measurement asking for it.

## Creating one: "Save as grid"

The filter menu gains a final row, below a divider, marked `alwaysShow` so it survives type-to-filter: **Save as grid…**. It is offered only while the filter is non-empty, since saving an empty rule would produce a grid that is a second copy of home.

Choosing it opens the existing grid editor sheet, the same one `openNewGrid` opens, pre-seeded with the current `FilterState`. Name validation and the icon picker are reused unchanged. The name field is seeded with the value when the rule is a single facet holding a single value, and left empty otherwise, because no short name for a three-facet rule is going to be better than the one the user types.

This is the whole creation flow. There is no separate rule builder to design, which was the point of storing a `FilterState`.

## Editing rules

Two surfaces show a rule, and only one of them changes it.

**The filter menu, while an auto-grid is on screen,** opens with an inert section at the top headed by the grid's name, listing the rules as rows that cannot be toggled. They are there to explain why the wall looks like this, so that the ad-hoc facets below are read as narrowing something rather than as the whole story.

**The manage sheet's edit screen** gains a Rules line showing the same summary and an **Edit rules** action. Choosing it closes the sheet and reopens the filter menu in **rule mode**: the same facet rows, a chip reading `Editing rules: <name>`, and toggles writing to the grid's rules instead of to the ad-hoc filter. Escape commits and returns.

Rule mode is the one genuinely new UI state in this change and is the riskiest part of it. The alternative considered and rejected was "narrow the wall, then update the rules from the current filter", which reads well until you are inside an auto-grid, where the ad-hoc filter is stacked on top of the rules and "the current filter" no longer names one thing.

## Dropping onto an auto-grid

A drop, or a "Move to grid" from the palette or context menu, **makes the rule true** when there is exactly one write that would do it.

A rule is assignable when all of the following hold, which is what `assignableValue` returns:

- it names exactly one facet, holding exactly one value
- that facet's `source` is `property`, so it is something a note can carry (`kind` and `domain` are derived and cannot be written)
- that facet's `shape` is not `date`, since a date facet's values are buckets and comparisons rather than literals

An assignable auto-grid accepts drops and appears in move targets, and the write goes through `view.setProperty`, which is already licensed for the user's own properties and already refuses everything `editable.isEditable` refuses. A non-assignable auto-grid accepts no drops and does not appear as a move target, for the same reason the palette drops a facet with nothing to offer: a target that cannot act is worse than an absent one.

Note that this write is not a move. The clipping keeps whatever `grid:` key it had, because home stays everything and an auto-grid is not a place.

## Rename, delete, reorder, hotkeys

- **Rename** rewrites nothing. A manual grid's rename is a bulk rewrite of `grid:` across its members; an auto-grid has no members carrying its name, so the rename is a settings edit. `memberCount` must not be called for one, and the confirmation copy that quotes it must not be shown.
- **Delete** is a settings edit and touches no note. The confirmation says so, rather than reusing the manual grid's "its clippings return to home", which would be a lie.
- **Reorder and hotkeys** are unchanged: position in `settings.grids` drives `⌘1..9` for both kinds.
- **Name conflicts** are checked across both kinds together, since they share one namespace and one switcher.

## Empty states

An auto-grid whose rules match nothing shows "No clipping matches these rules", with the rule summary and an action opening rule mode. This is distinct from a manual grid's empty state, which invites a drop; nothing can be dropped into a non-assignable auto-grid, and telling the user to drop something into one would be a dead end.

## The pruning hazard

`pruneFilter` drops state for facets no longer on offer, so the ad-hoc filter's badge cannot claim a narrowing that `matchesFilter` is not applying. That behaviour is correct for a filter and wrong for a rule: silently dropping a facet from an auto-grid's rules **widens** it, and a grid that quietly starts showing three times as much is worse than one that admits it is broken.

So rules are never pruned. An auto-grid whose rules name a property no longer in `filterProperties` keeps them, still evaluates the facets it can, and is marked in the manage sheet with what it can no longer apply. Re-adding the property in settings restores it.

## Not in this change

- **Negation.** `status is not archived` needs a per-facet negate flag on `FilterState` and a way to express it in the menu. It is the most likely next step and is deliberately separate: it changes a tested core that everything else here depends on being stable.
- **Hybrid grids.** A grid that is both a `grid:` key and a rule. No evidence anyone wants it, and it doubles the number of states every screen above has to describe.
- **Nested grids.** Rejected in conversation: it re-imports the folder hierarchy the vault's own rules turned down for `Clippings/`, and starts competing with categories for the same job.
- **Manual stacks.** Durable hand-picked membership needs a new frontmatter key, which `CLAUDE.md` explicitly warns off as its own decision rather than a precedent already set.

## Testing

Pure, so unit tested:

- `isAutoGrid` and `assignableValue`, including each of the three rejections (derived facet, date facet, more than one value or facet).
- Name conflicts resolved across both kinds.
- Membership: a tile matching the rules is admitted, one that does not is not, and an ad-hoc filter stacked on top narrows the result further rather than replacing it.
- Rules survive a facet leaving `filterProperties`, where an ad-hoc filter is pruned.

Not unit tested, per the repo's rule that a module importing `obsidian` cannot be: the `paint()` branch, rule mode, the sheet screens. The defs ordering above is the part of that untested half most worth checking by hand against a real vault, since getting it wrong produces a wall that is subtly wrong rather than one that is obviously broken.
