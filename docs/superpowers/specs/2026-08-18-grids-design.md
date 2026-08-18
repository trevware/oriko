# Power Grid: Grids

## Why

Today the plugin shows one wall: every clipping in `Clippings/`, always. There is no way to keep a working set apart from an archive, or a research pile apart from a reference pile. Grids add named collections that each hold their own clippings, with a switcher and a create menu in the bottom right and a management panel in the bottom left.

## The model

A clipping belongs to a grid by a **frontmatter key**:

```yaml
grid: Playground
```

**A missing key means the home grid.** Home is a real grid with a name (`Clippings` by default) that simply needs no key to belong to. This is what keeps the feature free of a migration: nothing in an existing vault is touched until a clipping is explicitly moved somewhere else, and only that note is written.

**An unknown value falls back to home.** If `grid: Demo` survives the deletion of the Demo grid, the clipping reappears at home rather than vanishing into a collection that no longer exists. Deleting a grid therefore needs no cleanup pass, and a hand-typed value never strands a note.

The effective grid of a record is:

```
effectiveGrid(record, home, registered) =
  record.grid is empty            -> home
  record.grid not in registered   -> home
  otherwise                       -> record.grid
```

Membership is exclusive: one key, one grid.

### Why the key stores the name

The alternative is an opaque id, which survives renaming for free. It was rejected because the whole reason for choosing frontmatter over a plugin-side membership list was that the vault stays readable and portable on its own: `grid: Playground` means something to a person reading the note in six months, and to a Base, and to any other tool. `grid: g_7f3a91` does not. The cost is that renaming a grid is a bulk rewrite, specified below.

## Data shapes

```ts
// settings.ts
export interface GridSpace {
  name: string;   // identity and display; what `grid:` stores
  icon: string;   // lucide icon id, e.g. "star", "flask-conical", "heart"
}

export interface PowerGridSettings {
  // ... existing fields
  grids: GridSpace[];      // ordered; position drives the hotkey
  homeGridName: string;    // default "Clippings"
  homeGridIcon: string;    // default "layout-grid"
  activeGrid: string;      // grid name; persisted so a restart reopens where you were
}
```

Home is not stored in `grids`. It is always present, always first, and always index 0 for hotkey purposes. `grids` holds only the grids the user created.

`ClippingRecord` gains one field:

```ts
grid: string;   // "" when the note carries no key
```

`scanClipping` reads it with the same `str(frontmatter.grid)` treatment as `status` and `cover`. It stays a raw value: normalization to an effective grid is a separate pure step, because it needs the registry, which `scan` has no business knowing about.

## Behaviour

### Switching

The active grid is a name held in settings. `view.refresh()` filters records to the active grid before `buildTiles`. Everything downstream, layout, virtualization, selection, playback, is unchanged: it simply receives fewer tiles.

Switching writes `activeGrid` to settings, clears the selection, resets the camera to the top, and refreshes. The camera reset matters because tile positions are meaningless across a change of contents.

### Creating

`New grid` in the `+` menu prompts for a name and an icon. Validation: non-empty after trimming, not a duplicate of an existing grid or of the home name, case-insensitively. A new grid starts empty and becomes active immediately, so the user sees what they made rather than having to go find it.

### Moving

Right-click a selection, `Move to grid`, pick a destination. The write is:

```ts
await app.fileManager.processFrontMatter(file, (fm) => {
  if (target === home) delete fm.grid;
  else fm.grid = target;
});
```

Moving to home **deletes** the key rather than writing the home name. Two reasons: it keeps a clean vault clean, and it means the common case of "put this back" leaves no trace.

`processFrontMatter` rewrites only the frontmatter block. The clipped body is untouched, which is what keeps this compatible with the vault rule against rewriting clipped content.

Each write fires `vault.on("modify")`, which the existing handler already turns into a reindex and an emit. Moving needs no refresh plumbing of its own. A bulk move awaits the writes in sequence and lets the resulting refreshes coalesce.

### Renaming

Renaming is a bulk rewrite, because the key stores the name.

1. Count the members carrying the old name explicitly. Notes at home carry no key, so renaming home rewrites only those notes that happen to carry the home name spelled out.
2. Confirm, naming the count: "Rename Playground to Archive? 34 clippings will be updated."
3. Rewrite each member's key through `processFrontMatter`, reporting progress through the existing progress bar for anything above a handful.
4. Update the registry entry and `activeGrid` if it pointed at the old name.

Validation matches creation: non-empty, no case-insensitive collision.

If the rewrite fails partway, the notes already written carry the new name and the rest carry the old. Both names then exist, only one is registered, and the unregistered half falls back to home rather than disappearing. The failure is reported with a count, and re-running the rename finishes the job. This is why the unknown-value fallback exists.

### Deleting

Removing a grid removes its registry entry and nothing else. Members keep a key that no longer resolves, so they fall back to home. Confirmed first, naming the count of clippings that will return home.

### Where new clips land

Captures go to the active grid. `buildNote` stamps `grid:` when the active grid is not home. These are notes the plugin creates, written complete in one pass, so the no-edit rule is not involved.

## UI

### The space bar, bottom right

Two controls in a row, matching the reference:

- A **switcher pill**: the active grid's icon, then a chevron. Opens the grid list.
- A **`+` circle**. Opens the create menu.

The grid list shows every grid, home first, each with its icon, name, and `⌘1` through `⌘9` in the right-hand column. The active one is dimmed, since it is the one thing selecting cannot do anything.

The create menu:

```
 Clip link            ⌘N
 Clip image          ⇧⌘N
 ────────────────────────
 New grid              ↗
```

Both clip actions already exist as commands. This surfaces them.

### The grids panel, bottom left

A gear button opens a panel for managing grids: rename, change icon, reorder, delete. Reorder matters because position drives the hotkey. Home appears in the list and can be renamed and re-iconed but not deleted or reordered out of first place.

### Menus reuse ContextMenu

`ContextMenu` already renders an icon, a label, a right-aligned `detail`, a destructive variant, a dimming backdrop and placement via `placeMenu`. Both new menus are `ContextMenu.open(items, x, y)` calls. It needs one addition: an optional `divider?: boolean` on `MenuItem`, for the rule above `New grid`.

`Move to grid` reopens the menu at the same point with the grid list as its items. That is a submenu in effect, without building submenu support.

### Hotkeys

`⌘1` through `⌘9` select the grid at that position, home being `⌘1`.

**These collide with Obsidian's own tab switching.** They are handled in the grid view's keydown with `preventDefault` and `stopPropagation`, so they switch grids while the grid view has focus and switch tabs everywhere else. This is the same treatment `⌘0`, `⌘=` and `⌘-` already get for zoom, so it is consistent rather than a new exception. The detail view, which registers in the capture phase, keeps its own keys ahead of these.

## Constraints and rule changes

**This narrows a rule in the repo's `CLAUDE.md`.** It currently reads "The plugin never edits an existing note." That becomes: the plugin never edits a note's **content**; it may write the `grid` key of an existing note's frontmatter, and only that key, and only through `processFrontMatter`. The rule's purpose, that clipped content is never rewritten, is unchanged. `CLAUDE.md` is updated as part of this work, not after it.

**The vault's own `CLAUDE.md` §9 lists the properties the filing routine adds** (`type`, `categories`, `status`, `updated`). If grids are used against that vault, `grid` belongs on that list. That is a change in the vault tree, not this repo, and is flagged for the user rather than made here.

**`Clippings.base` is unaffected.** Adding a property is additive; the Base filters on the `clippings` tag, which is never touched.

## Architecture

Per the repo's load-bearing rule, pure logic lives where vitest can reach it.

**`src/spaces.ts`**, zero Obsidian imports:

- `effectiveGrid(record, home, registered)` as specified above.
- `filterByGrid(records, grid, home, registered)`.
- `hotkeyIndex(key)` and the position-to-grid mapping.
- `validateGridName(name, existing, home)` returning ok or a reason.
- `membersOf(records, name)` for the rename and delete counts.

**`src/scan.ts`** gains the `grid` field on `ClippingRecord`.

**Obsidian-facing shell**: a new `src/space-bar.ts` for the two bottom-right controls and a `src/grids-panel.ts` for the bottom-left management panel, plus wiring in `view.ts`, and the stamp in `capture.ts` and `resolve.ts`. The frontmatter write is injected into the pure-facing code as a plain function, matching how `archive.ts` takes its dependencies.

## Testing

Pure and tested: effective-grid normalization including both fallbacks, filtering, name validation including case-insensitive collision and collision with the home name, hotkey mapping past nine grids, member counting, and `scanClipping` reading and omitting the key.

Not unit testable, and called out as needing checking inside Obsidian: that `processFrontMatter` leaves a real clipped body byte-identical, that a move triggers exactly one visible refresh, that `⌘1`–`⌘9` reach the grid rather than Obsidian's tab switcher, and that a rename of thirty notes reports progress rather than freezing.

## Out of scope

- Nested grids. Grids are a flat list.
- A clipping in more than one grid. The key is a single value.
- Per-grid settings such as its own archive folder or autoplay preference.
- Moving by drag onto the switcher. The context menu is the only route.
- Reconciling grids with the vault's `Clippings.base` views.
