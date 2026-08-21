# Power Grid: Smart grids

## Why

Grids are places a clipping is put. Putting it there is a write, and it is exclusive: one key, one grid. That is the right model for a working set kept apart from an archive, and the wrong one for every collection whose definition is already sitting in the frontmatter. "Everything unread", "everything tagged design", "anything clipped in the last month" are all things the wall can already compute and already lets you narrow to, but only as a filter you re-apply by hand and lose on the next switch.

A smart grid is that narrowing, named, given an icon, and put in the switcher beside the grids you filled by hand. Nothing is written to any note to belong to one.

## The model

A smart grid is a **named `FilterState`**. It appears in the switcher, takes a hotkey position, holds its own ad-hoc filter, and can be renamed, reordered and deleted like any other grid. What it does not have is membership: a clipping is in it because it matches, and stops being in it the moment its properties change.

**Home stays everything.** A clipping matching a smart grid is still in home. `effectiveGrid` is untouched, and the guarantee it exists for, that no clipping can end up in a collection no view will show, is untouched with it. Smart grids are lenses over the wall, not a routing layer above it.

**Overlap is expected.** A clipping matching three smart grids appears in three. This follows from the above and is not a defect to design around: the same clipping already appears under three categories in the filter menu.

**A manual grid's clippings are eligible too.** Rules run over every clipping, not over home alone, so a smart grid for `status: unread` includes the unread things sitting in Manga. This is the only reading consistent with home staying everything, and it is what makes a smart grid a view of the vault rather than a view of one wall.

### Why the rules are a stored FilterState

The obvious alternative is a rule language: boolean groups, comparisons, text predicates. It was rejected because `FilterState` is already the thing the user composes when they filter the wall, `matchesFilter` already evaluates it with tested semantics ("within a facet, any; across facets, all"), and date facets already carry both forms worth saving: a bucket label re-evaluates against `now` on every paint, so a rule holding one is a rolling window, while a `before:` / `on-or-after:` token from the custom prompt is an absolute cutoff that stays put. "Clipped this month" therefore needs nothing new, and neither does "clipped since the relaunch".

More importantly it decides what the rule editor is. Because a rule is a set of ticked facet values and nothing else, the editor is a list of facets and a tick list of values, which is an idiom the plugin already draws twice (the filter menu's submenus and the palette's stage). An expression tree with groups and operators would be a second way to say something the plugin already says, and the two would drift.

The cost is that `FilterState` cannot say "not". That is a real gap, `status is not archived` being an obvious want, and it is deliberately left to a later change rather than smuggled in as a special case. See "Not in this change".

## Data shapes

```ts
// spaces.ts
export interface GridSpace {
  name: string;
  icon: string;
  /** Present on a smart grid: the rules its membership is computed from.
      Absent on a manual grid, whose membership is the `grid:` key. */
  rules?: FilterState;
}
```

One list, not two. `settings.grids` keeps both kinds in one order, because the order drives the hotkey positions and a second list would need an interleaving order anyway. Existing settings migrate by having no `rules` field, which is exactly what a manual grid is.

Home is still implicit and still cannot be a smart grid: it is the remainder, and a remainder with rules is a contradiction.

```ts
// spaces.ts
export function isSmartGrid(space: GridSpace): boolean;

/**
 * The single property write that would make a clipping match, or null when
 * there isn't one. See "Dropping onto a smart grid".
 */
export function assignableValue(
  space: GridSpace,
  defs: FacetDef[]
): { key: string; value: string } | null;
```

## Evaluation

Membership runs on tiles, after `buildTiles`, not on records. Two reasons, both structural: `buildTiles` drops any record whose cover does not resolve, so the set of tiles is not the set of records, and `kind` is produced by `pickCover` and is not reachable from a `ClippingRecord` at all. Evaluating rules earlier would mean either calling `pickCover` anyway, which is the expensive half, or forbidding `kind` in rules and losing "everything that is a video" as a smart grid.

`paint()` gains one branch:

```
manual:  records -> filterByGrid -> buildTiles ---------------------> facets
auto:    records ------------------> buildTiles -> matchesFilter(rules) -> facets
```

and everything downstream is unchanged. `this.facets` keeps its current contract, "the grid's tiles before the ad-hoc filter", which for a smart grid means the tiles its rules admit. Facet counts inside a smart grid are therefore counts within the rule, which is what makes narrowing further legible.

The rules and the ad-hoc filter are the same type evaluated by the same matcher at two different stages. Stacking a filter on top of a smart grid needs no new code and no new concept.

### The defs ordering, which is circular if written naively

`defs()` reads `this.facets`, because `typedFacets` samples the wall to decide whether a property holds dates. For a smart grid `this.facets` is the rules' result, so computing it needs defs that were computed before the rules ran.

Rule evaluation therefore uses defs derived from **all** tiles, computed once in `paint()` before the branch, and kept separate from the display defs that `defs()` returns. This is a handful of lines and it is the single thing most likely to be got wrong by someone who does not know it is there.

### Cost

A smart grid pays `buildTiles` over every record on each paint, where a manual grid pays it over its own slice. `buildTiles` is synchronous and cache-backed, so this is expected to be invisible at realistic vault sizes.

If it is not, the fix is to build all tiles once per index change, cache them on the view, and make every grid a partition of that cache. That is a better shape and makes grid switching cheaper across the board, but it takes on invalidation that today's rebuild-every-paint gets for free (archiver cache updates, the `unloadable` signature map). It is deliberately not in this change: it is an optimisation with its own risks, and it should be made when there is a measurement asking for it.

## Creating one: pick the kind, then say what picks it up

The kind is chosen up front, the way Finder makes you choose between a folder and a smart folder, because the two are different objects and the difference is the whole point. The create menu, which today holds Clip link, Clip image and New grid, gains **New smart grid** beneath New grid.

Creation is three screens on the existing sheet, which already pushes and pops screens for the manager.

**1. Name and icon.** Exactly today's `gridEditorScreen`, unchanged apart from its CTA, which reads `Next: rules` instead of `Create grid` when a smart grid is being made.

**2. Rules.** A row per facet, in the order the filter menu shows them, each row showing what it has chosen: `Categories · ios, design`, or `Any` when it is unset. The `note` line carries a live **`Matches 42 clippings`**, recomputed as values are ticked, which is the affordance that makes a rule editor legible rather than a form you fill in blind. The CTA is `Create grid`, and it is refused while nothing is chosen, since an empty rule is a second copy of home.

**3. Values for one facet.** The tick list the plugin already draws in two places: label is the value, detail is the count, a chosen value marks itself with a check where its count was. Escape returns to the rules screen.

**The counts and the values on screens 2 and 3 come from every tile, not from the active grid's.** Rules run over the whole vault, so offering them the vocabulary of whichever wall happened to be open would let you define a vault-wide rule from one wall's values and see a count that does not match what the grid will hold.

**The filter menu keeps a shortcut into this.** Below a divider, marked `alwaysShow` so it survives type-to-filter, a **Save as grid…** row appears while the filter is non-empty and opens screen 1 with the rules already filled in from what is on screen. It is the fastest path when you have just narrowed the wall by hand, and it costs nothing once the editor exists. It is a shortcut, not the way in.

## Editing rules

The same editor, reached from the manager: editing a smart grid opens screen 1, whose CTA is `Save`, with a **Rules** row that pushes screen 2. Create and edit are one flow with one difference in wording.

An earlier draft put rule editing in the filter menu instead, as a mode in which toggles wrote to the grid's rules rather than to the ad-hoc filter. It is recorded here only so it is not reinvented: it needed a new UI state on a surface that already has two jobs, and it was never going to explain itself as well as a screen that says `Matches 42 clippings` at the bottom.

**The filter menu still shows the rules, inertly.** While a smart grid is on screen it opens with a section at the top headed by the grid's name, listing the rules as rows that cannot be toggled, so the ad-hoc facets below are read as narrowing something rather than as the whole story.

## Telling the two kinds apart

A smart grid carries a small badge on its switcher chip and its manager row, in addition to whatever icon the user chose. You need to know at a glance which grids will accept a drag, and an icon the user picked cannot carry that, since they will reasonably choose the same bookmark icon for both kinds.

## Dropping onto a smart grid

A drop, or a "Move to grid" from the palette or context menu, **makes the rule true** when there is exactly one write that would do it.

A rule is assignable when all of the following hold, which is what `assignableValue` returns:

- it names exactly one facet, holding exactly one value
- that facet's `source` is `property`, so it is something a note can carry (`kind` and `domain` are derived and cannot be written)
- that facet's `shape` is not `date`, since a date facet's values are buckets and comparisons rather than literals

An assignable smart grid accepts drops and appears in move targets, and the write goes through `view.setProperty`, which is already licensed for the user's own properties and already refuses everything `editable.isEditable` refuses. A non-assignable smart grid accepts no drops and does not appear as a move target, for the same reason the palette drops a facet with nothing to offer: a target that cannot act is worse than an absent one.

Note that this write is not a move. The clipping keeps whatever `grid:` key it had, because home stays everything and a smart grid is not a place.

## Rename, delete, reorder, hotkeys

- **Rename** rewrites nothing. A manual grid's rename is a bulk rewrite of `grid:` across its members; a smart grid has no members carrying its name, so the rename is a settings edit. `memberCount` must not be called for one, and the confirmation copy that quotes it must not be shown.
- **Delete** is a settings edit and touches no note. The confirmation says so, rather than reusing the manual grid's "its clippings return to home", which would be a lie.
- **Reorder and hotkeys** are unchanged: position in `settings.grids` drives `⌘1..9` for both kinds.
- **Name conflicts** are checked across both kinds together, since they share one namespace and one switcher.

## Empty states

There is no empty state in the plugin today: an empty grid is a blank wall. That is survivable for a manual grid, whose emptiness you caused by not having put anything in it yet, and confusing for a smart grid, where a blank wall is indistinguishable from a bug.

So this change builds one, with two variants. A manual grid reads "Nothing in this grid yet" and invites a drop. A smart grid reads "No clipping matches these rules", with the rule summary and an action opening its editor; nothing can be dropped into a non-assignable smart grid, so telling the user to would be a dead end.

The rules screen's live match count is what should stop most of these from being created in the first place: a rule that matches nothing says so before the CTA is pressed.

## The pruning hazard

`pruneFilter` drops state for facets no longer on offer, so the ad-hoc filter's badge cannot claim a narrowing that `matchesFilter` is not applying. That behaviour is correct for a filter and wrong for a rule: silently dropping a facet from a smart grid's rules **widens** it, and a grid that quietly starts showing three times as much is worse than one that admits it is broken.

So rules are never pruned. A smart grid whose rules name a property no longer in `filterProperties` keeps them, still evaluates the facets it can, and is marked in the manage sheet with what it can no longer apply. Re-adding the property in settings restores it.

## Not in this change

- **Negation.** `status is not archived` needs a per-facet negate flag on `FilterState` and a way to express it in the menu. It is the most likely next step and is deliberately separate: it changes a tested core that everything else here depends on being stable.
- **Hybrid grids.** A grid that is both a `grid:` key and a rule. No evidence anyone wants it, and it doubles the number of states every screen above has to describe.
- **Nested grids.** Rejected in conversation: it re-imports the folder hierarchy the vault's own rules turned down for `Clippings/`, and starts competing with categories for the same job.
- **Manual stacks.** Durable hand-picked membership needs a new frontmatter key, which `CLAUDE.md` explicitly warns off as its own decision rather than a precedent already set.

## Testing

Pure, so unit tested:

- `isSmartGrid` and `assignableValue`, including each of the three rejections (derived facet, date facet, more than one value or facet).
- Name conflicts resolved across both kinds.
- Membership: a tile matching the rules is admitted, one that does not is not, and an ad-hoc filter stacked on top narrows the result further rather than replacing it.
- Rules survive a facet leaving `filterProperties`, where an ad-hoc filter is pruned.

- The rules screen's match count, which is `matchesFilter` over all tiles and is pure.

Not unit tested, per the repo's rule that a module importing `obsidian` cannot be: the `paint()` branch and the sheet screens. The defs ordering above is the part of that untested half most worth checking by hand against a real vault, since getting it wrong produces a wall that is subtly wrong rather than one that is obviously broken.
