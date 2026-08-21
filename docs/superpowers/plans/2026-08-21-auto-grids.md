# Auto-grids Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A grid whose membership is a stored `FilterState` rather than a `grid:` key, created from the create menu and defined with a Smart Folders style rule editor.

**Architecture:** An auto-grid is a `GridSpace` carrying `rules?: FilterState`. Membership is `matchesFilter` over tiles, evaluated in `paint()` after `buildTiles` and before the ad-hoc filter, so rules and filter are the same type run through the same matcher at two stages. Nothing is written to a note to belong to one, and home keeps its meaning as the remainder.

**Tech Stack:** TypeScript, esbuild, vitest, Obsidian plugin API.

**Spec:** `docs/superpowers/specs/2026-08-21-auto-grids-design.md`

## Global Constraints

- **A module importing `obsidian` cannot be unit tested.** Pure logic goes in modules with zero Obsidian imports: `spaces`, `filter`, `tile`, `dates`. `view.ts`, `grid-sheets.ts`, `space-bar.ts` are the untestable shell.
- **Never write to a note outside the two licensed writers.** `view.assign` for `grid`, `view.setProperty` for the user's own properties. Auto-grid membership writes nothing.
- **Verification is `npm test` and `npx tsc --noEmit`, both exit 0.** Piping to `head` masks a non-zero status.
- **Commit as you go, push to `origin`.** No AI attribution anywhere in repository information.
- **Rules are never pruned.** `pruneFilter` applies to the ad-hoc filter only.
- **Home cannot be an auto-grid.** It is implicit and is the remainder.

---

### Task 1: `GridSpace.rules` and `isAutoGrid`

**Files:**
- Modify: `src/spaces.ts`
- Test: `tests/spaces.test.ts`

**Interfaces:**
- Consumes: `FilterState` from `src/filter.ts` (both modules are pure, so the import is safe).
- Produces: `GridSpace.rules?: FilterState`, `isAutoGrid(space: GridSpace): boolean`.

- [ ] **Step 1: Write the failing test**

```ts
describe("isAutoGrid", () => {
  it("is an auto-grid once it carries rules", () => {
    expect(isAutoGrid({ name: "Unread", icon: "star", rules: { status: ["unread"] } })).toBe(true);
  });

  it("is a manual grid with no rules at all", () => {
    expect(isAutoGrid({ name: "Manga", icon: "archive" })).toBe(false);
  });

  it("treats an empty rule set as manual, since it would name the whole wall", () => {
    expect(isAutoGrid({ name: "Empty", icon: "star", rules: {} })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/spaces.test.ts`
Expected: FAIL, `isAutoGrid is not a function`.

- [ ] **Step 3: Write minimal implementation**

```ts
import { isFilterEmpty } from "./filter";
import type { FilterState } from "./filter";

export interface GridSpace {
  name: string;
  icon: string;
  /** Present on an auto-grid: the rules its membership is computed from.
      Absent on a manual grid, whose membership is the `grid:` key. */
  rules?: FilterState;
}

/**
 * Empty rules are manual, not an auto-grid matching everything. A grid that
 * named the whole wall would be a second copy of home, and the editor refuses
 * to create one; treating it as manual here means a hand-edited data.json
 * cannot produce one either.
 */
export function isAutoGrid(space: GridSpace): boolean {
  return space.rules !== undefined && !isFilterEmpty(space.rules);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/spaces.test.ts && npx tsc --noEmit`
Expected: PASS, tsc exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/spaces.ts tests/spaces.test.ts
git commit -m "Let a grid carry rules, which is what makes it an auto-grid"
```

---

### Task 2: `assignableValue`

**Files:**
- Modify: `src/spaces.ts`
- Test: `tests/spaces.test.ts`

**Interfaces:**
- Consumes: `isAutoGrid` from Task 1, `FacetDef` from `src/filter.ts`.
- Produces: `assignableValue(space: GridSpace, defs: FacetDef[]): { key: string; value: string } | null`.

The single property write that would make a clipping match, or null when there isn't one. Used by Task 7 to decide whether an auto-grid can be a move target.

- [ ] **Step 1: Write the failing test**

```ts
describe("assignableValue", () => {
  const defs = facetDefs(["categories", "created"]);
  const auto = (rules: FilterState): GridSpace => ({ name: "G", icon: "star", rules });

  it("names the one write that would make a clipping match", () => {
    expect(assignableValue(auto({ categories: ["design"] }), defs)).toEqual({
      key: "categories",
      value: "design",
    });
  });

  it("refuses a manual grid, which is moved into rather than matched", () => {
    expect(assignableValue({ name: "Manga", icon: "archive" }, defs)).toBeNull();
  });

  it("refuses more than one facet, there being no single write", () => {
    expect(assignableValue(auto({ categories: ["design"], status: ["unread"] }), defs)).toBeNull();
  });

  it("refuses more than one value, for the same reason", () => {
    expect(assignableValue(auto({ categories: ["design", "ios"] }), defs)).toBeNull();
  });

  it("refuses a derived facet, which no note can carry", () => {
    expect(assignableValue(auto({ domain: ["youtube.com"] }), defs)).toBeNull();
    expect(assignableValue(auto({ kind: ["video"] }), defs)).toBeNull();
  });

  it("refuses a date facet, whose values are buckets rather than literals", () => {
    const dated = typedFacets(defs, [], 0).map((d) =>
      d.id === "created" ? { ...d, shape: "date" as const } : d
    );
    expect(assignableValue(auto({ created: ["empty"] }), dated)).toBeNull();
  });

  it("refuses a facet no longer on offer, whose shape cannot be read", () => {
    expect(assignableValue(auto({ medium: ["photo"] }), defs)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/spaces.test.ts`
Expected: FAIL, `assignableValue is not a function`.

- [ ] **Step 3: Write minimal implementation**

```ts
/**
 * The single property write that would make a clipping match, or null when
 * there is not exactly one.
 *
 * This is what decides whether an auto-grid can be a move target. A target
 * that cannot act is worse than an absent one, which is why every ambiguous
 * case refuses rather than picking a value out of the rule and hoping.
 */
export function assignableValue(
  space: GridSpace,
  defs: FacetDef[]
): { key: string; value: string } | null {
  if (!isAutoGrid(space) || !space.rules) return null;

  const entries = Object.entries(space.rules);
  if (entries.length !== 1) return null;

  const [id, values] = entries[0];
  if (values.length !== 1) return null;

  // A facet switched off in settings has no def, so its shape cannot be read
  // and its writability cannot be judged. Rules are never pruned, so this is
  // a state the wall can genuinely be in.
  const def = defs.find((candidate) => candidate.id === id);
  if (!def || def.source !== "property" || !def.key) return null;
  // A date facet's values are buckets and comparisons, not anything a note
  // could be given.
  if (def.shape === "date") return null;

  return { key: def.key, value: values[0] };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/spaces.test.ts && npx tsc --noEmit`
Expected: PASS, tsc exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/spaces.ts tests/spaces.test.ts
git commit -m "Work out whether an auto-grid names a write that would join it"
```

---

### Task 3: `autoMembers`

**Files:**
- Modify: `src/filter.ts`
- Test: `tests/filter.test.ts`

**Interfaces:**
- Consumes: `matchesFilter`, `FilterState`, `FacetDef` (all already in `src/filter.ts`).
- Produces: `autoMembers(tiles: TileModel[], rules: FilterState, defs: FacetDef[]): TileModel[]`.

A named home for the first of the two matcher stages, so the untestable `paint()` branch is one call rather than a filter expression nobody can test.

- [ ] **Step 1: Write the failing test**

```ts
describe("autoMembers", () => {
  const defs = facetDefs(["categories", "status"]);
  const tiles = [
    tileWith({ categories: ["design"], status: ["unread"] }),
    tileWith({ categories: ["design"], status: ["read"] }),
    tileWith({ categories: ["manga"], status: ["unread"] }),
  ];

  it("admits the tiles the rules name", () => {
    expect(autoMembers(tiles, { categories: ["design"] }, defs)).toHaveLength(2);
  });

  it("narrows across facets, as the filter does", () => {
    expect(autoMembers(tiles, { categories: ["design"], status: ["unread"] }, defs)).toHaveLength(1);
  });

  it("admits everything when the rules are empty, leaving the wall to the filter", () => {
    expect(autoMembers(tiles, {}, defs)).toHaveLength(3);
  });

  it("stacks: an ad-hoc filter narrows the members further rather than replacing them", () => {
    const members = autoMembers(tiles, { categories: ["design"] }, defs);
    const shown = members.filter((tile) => matchesFilter(tile, { status: ["unread"] }, defs));
    expect(shown).toHaveLength(1);
  });
});
```

Reuse whatever tile factory `tests/filter.test.ts` already has; if it has none, add:

```ts
const tileWith = (properties: Record<string, string[]>): TileModel =>
  ({ record: { properties, source: "" }, kind: "image" } as unknown as TileModel);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/filter.test.ts`
Expected: FAIL, `autoMembers is not a function`.

- [ ] **Step 3: Write minimal implementation**

```ts
/**
 * The tiles an auto-grid holds: the first of the two stages the same matcher
 * runs at.
 *
 * The rules decide what the grid contains; the ad-hoc filter then narrows what
 * of it is on screen. Keeping them the same type run by the same function is
 * what makes stacking a filter on an auto-grid need no new code at all.
 */
export function autoMembers(
  tiles: TileModel[],
  rules: FilterState,
  defs: FacetDef[]
): TileModel[] {
  if (isFilterEmpty(rules)) return tiles;
  return tiles.filter((tile) => matchesFilter(tile, rules, defs));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, tsc exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/filter.ts tests/filter.test.ts
git commit -m "Name the first matcher stage, where an auto-grid's members are decided"
```

---

### Task 4: The `paint()` branch, and defs that are not circular

**Files:**
- Modify: `src/view.ts` (`paint`, `defs`, add `allDefs`)

**Interfaces:**
- Consumes: `autoMembers` (Task 3), `isAutoGrid` (Task 1).
- Produces: an auto-grid renders its members; nothing else changes.

No unit tests: `view.ts` imports `obsidian`. Verified by hand against the vault in Step 4.

- [ ] **Step 1: Add the rule-evaluation defs**

`defs()` reads `this.facets`, and for an auto-grid `this.facets` is the rules' *result*, so it cannot be what the rules are evaluated against. Add a sibling that types the facets from every tile:

```ts
/**
 * Defs for evaluating an auto-grid's rules, typed from every tile rather than
 * from the grid's own.
 *
 * defs() samples this.facets to decide whether a property holds dates, and for
 * an auto-grid this.facets is what the rules produced. Using it here would ask
 * the rules to be evaluated against a typing that only exists once they have
 * been. Circular, and it fails quietly: a date facet types as text and its
 * buckets stop matching, so the grid is wrong rather than broken.
 */
private allDefs(tiles: TileModel[]): FacetDef[] {
  return typedFacets(facetDefs(this.plugin.settings.filterProperties), tiles, Date.now());
}
```

- [ ] **Step 2: Branch `paint()`**

Replace the body of `paint()` up to `this.facets = tiles;` with:

```ts
private paint(options: { replace?: boolean }): void {
  if (!this.grid) return;

  const space = this.activeGrid();
  const auto = isAutoGrid(space);

  // An auto-grid's rules run over the whole vault, so its tiles are built from
  // every record rather than from one wall's slice. Home stays everything, so
  // a clipping filed in Manga is still eligible for an auto-grid.
  const tiles = buildTiles(
    auto
      ? this.plugin.index.records()
      : filterByGrid(
          this.plugin.index.records(),
          space.name,
          this.plugin.settings.homeGridName,
          this.registered()
        ),
    this.plugin.archiver.cache,
    this.unloadable
  );

  // Facets are counted from the whole grid, not from what survives the
  // filter: counting the result would make options disappear the moment
  // you used one, leaving no way back.
  this.facets =
    auto && space.rules ? autoMembers(tiles, space.rules, this.allDefs(tiles)) : tiles;
  this.applyFilter(options);
  this.flyToPending();
}
```

- [ ] **Step 3: Build into the vault**

Run: `npx tsc --noEmit && node esbuild.config.mjs`
Expected: tsc exit 0, bundle written to the vault plugin folder.

- [ ] **Step 4: Verify by hand**

There is no editor yet, so hand-write one into `data.json` in the vault plugin folder, reload Obsidian, and switch to it:

```json
{ "name": "Unread", "icon": "circle-dot", "rules": { "status": ["unread"] } }
```

Expected: the grid shows only unread clippings, drawn from every grid rather than home alone; the filter button still narrows further; ⌘1..9 still selects by position. Then add a `created` facet rule and confirm a date bucket matches, which is what proves Step 1 did its job.

- [ ] **Step 5: Commit**

```bash
git add src/view.ts
git commit -m "Render an auto-grid from its rules, typed against the whole wall"
```

---

### Task 5: The rule editor

**Files:**
- Modify: `src/grid-sheets.ts`, `src/view.ts` (`openCreate`, `promptNewGrid`)

**Interfaces:**
- Consumes: `assignableValue` is not needed here; `FacetDef`, `FacetValue`, `FilterState`, `toggleFacet`, `facetsOf`, `isFilterEmpty` from `src/filter.ts`; `autoMembers` from Task 3.
- Produces: `openNewAutoGrid(sheet, grids, rules, after)`, and `GridsController` gains the two readers the editor needs.

`GridsController` gains:

```ts
export interface GridsController {
  // ... existing members
  /** Facets typed against every tile, which is what a vault-wide rule is
      written in. The active grid's own vocabulary would be the wrong one. */
  ruleDefs(): FacetDef[];
  ruleFacets(): Record<string, FacetValue[]>;
  /** How many clippings the given rules would hold, for the live count. */
  ruleMatches(rules: FilterState): number;
}
```

Implemented in `view.ts` from `buildTiles(this.plugin.index.records(), ...)`, `this.allDefs(tiles)`, `facetsOf(tiles, defs)` and `autoMembers(tiles, rules, defs).length`.

- [ ] **Step 1: Add "New auto-grid" to the create menu**

In `view.openCreate`, beneath the existing New grid row (which keeps the divider):

```ts
{
  icon: "wand-2",
  label: "New auto-grid",
  onSelect: () => this.promptNewAutoGrid(),
},
```

and beside `promptNewGrid`:

```ts
private promptNewAutoGrid(): void {
  if (!this.sheet) return;
  openNewAutoGrid(this.sheet, this.gridsController(), {}, () => this.refresh());
}
```

- [ ] **Step 2: Teach the editor screen about rules**

`gridEditorScreen` gains two parameters: the rules being built (`FilterState | null`, null for a manual grid) and the controller readers above. When rules are present:

- `title` is `New auto-grid` when creating, `Edit ${grid.name}` otherwise
- `cta` is `Next: rules` when creating, `Save` otherwise
- `onSubmit` validates the name exactly as now, then **pushes the rules screen** instead of calling `create`

The manual path is untouched: same title, same CTA, same `create`.

- [ ] **Step 3: Add the rules screen**

```ts
function rulesScreen(
  sheet: Sheet,
  grids: GridsController,
  grid: GridSpace,
  rules: FilterState,
  index: number | undefined,
  after: () => void
): SheetScreen
```

- `title`: `Rules`
- `note`: `` `Matches ${grids.ruleMatches(rules)} ${plural(n, "clipping", "clippings")}` ``, rebuilt whenever the screen is repainted so ticking a value moves it
- `filters: true`, `layout: "list"`
- `rows`: one per def from `grids.ruleDefs()`, `label` the def's label, `icon` the def's icon, `detail` the chosen values joined with `, ` or `Any` when unset. `onChoose` pushes the values screen for that def.
- `cta`: `Create grid` when creating, `Save` otherwise. `onSubmit` refuses with a `Notice` reading `Power Grid: an auto-grid needs at least one rule` while `isFilterEmpty(rules)`, otherwise calls `grids.create({ ...grid, rules })` or `grids.rename(grid.name, { ...grid, rules })` and closes.
- `hints`: `[["↑↓", "navigate"], ["↵", "choose"], ["esc", "back"]]`

- [ ] **Step 4: Add the values screen**

```ts
function ruleValuesScreen(
  sheet: Sheet,
  grids: GridsController,
  def: FacetDef,
  rules: FilterState,
  onToggle: (next: FilterState) => void
): SheetScreen
```

The tick list the plugin already draws twice. Rows come from `grids.ruleFacets()[def.id]`: `label` is the value (`tokenLabel(value)` when `def.shape === "date"`), `detail` is `String(count)`, `detailIcon` is `"check"` when chosen. `onChoose` calls `onToggle(toggleFacet(rules, def.id, value))` and repaints in place so the tick and the count above both move. `filters: true`. No `cta`; Escape returns.

- [ ] **Step 5: Export the entry point**

```ts
export function openNewAutoGrid(
  sheet: Sheet,
  grids: GridsController,
  rules: FilterState,
  after: () => void = () => undefined
): void {
  sheet.open(
    gridEditorScreen(sheet, grids, { name: "", icon: GRID_ICONS[0], rules }, undefined, after)
  );
}
```

- [ ] **Step 6: Build and verify by hand**

Run: `npx tsc --noEmit && node esbuild.config.mjs`

In Obsidian: create button, New auto-grid, name it, pick an icon, `Next: rules`, tick two categories, watch the count move, `Create grid`. Expected: the grid appears in the switcher and holds what the count promised. Then delete the hand-written entry from Task 4's `data.json` check.

- [ ] **Step 7: Commit**

```bash
git add src/grid-sheets.ts src/view.ts
git commit -m "Ask what picks an auto-grid up, and say how much it would pick up"
```

---

### Task 6: Editing, renaming, deleting, and the badge

**Files:**
- Modify: `src/grid-sheets.ts` (`openGridsManager`, `gridEditorScreen`, `confirmDelete`), `src/space-bar.ts`, `src/view.ts` (`openSwitcher`), `styles.css`

**Interfaces:**
- Consumes: `isAutoGrid` (Task 1), the screens from Task 5.
- Produces: no new exports.

- [ ] **Step 1: Route editing through the rules screen**

In `gridEditorScreen`, when the grid `isAutoGrid` and is **not** being created, add a `Rules` row above the icon swatches that pushes `rulesScreen`. The swatch layout cannot hold a row, so this screen becomes `layout: "list"` for an auto-grid, with the icon chosen from a pushed swatch screen instead. Manual grids keep today's single-screen swatch editor untouched.

- [ ] **Step 2: Stop rename and delete lying about notes**

`gridEditorScreen`'s rename branch calls `grids.memberCount(grid.name)`, which counts notes carrying the name. An auto-grid has none, so guard it:

```ts
const members = renamed && !isAutoGrid(grid) ? grids.memberCount(grid.name) : 0;
```

In `confirmDelete`, an auto-grid's note reads `Its rules are removed. No clipping is changed.` rather than the manual grid's copy about clippings returning home.

- [ ] **Step 3: Mark a rule the wall can no longer apply**

Rules are never pruned, which is true by construction: `pruneFilter` is called in `activeFilter()` on the ad-hoc filter alone and rules are never passed to it. But a rule naming a property since removed from `filterProperties` silently stops narrowing, which **widens** the grid. So the manager's row for such a grid carries a warning detail reading `${n} rules not in use`, counting rule keys with no matching def in `grids.ruleDefs()`. Re-adding the property in settings restores it with no further action.

- [ ] **Step 4: Badge the switcher and the manager**

Add a `pg-auto-badge` element to the space bar's active-grid chip and to each auto-grid row in the manager and the switcher menu. `space-bar.ts` `setActive(grid)` toggles it from `isAutoGrid(grid)`.

```css
.pg-auto-badge { /* small corner mark over the grid icon */ }
```

- [ ] **Step 5: Build and verify by hand**

Run: `npx tsc --noEmit && node esbuild.config.mjs`

Expected: renaming an auto-grid does not ask about clippings and rewrites no note; deleting one says so; the badge distinguishes the two kinds in all three places; removing `status` from the filter properties in settings marks a grid whose rules use it. Confirm with `git status` in the vault that no clipping was touched.

- [ ] **Step 6: Commit**

```bash
git add src/grid-sheets.ts src/space-bar.ts src/view.ts styles.css
git commit -m "Edit, rename and delete an auto-grid without lying about notes"
```

---

### Task 7: Move targets honour assignability

**Files:**
- Modify: `src/commands.ts` (`selectionCommands`), `src/view.ts` (`moveTo`, the context menu's move submenu)
- Test: `tests/commands.test.ts`

**Interfaces:**
- Consumes: `assignableValue` (Task 2).
- Produces: `PaletteContext` gains `assignable: (grid: GridSpace) => { key: string; value: string } | null`.

There is no tile-onto-chip drag gesture in the plugin today, so "dropping onto an auto-grid" means the **move targets**: the palette's `Move to grid` stage and the context menu's move submenu.

- [ ] **Step 1: Write the failing test**

```ts
it("offers an assignable auto-grid as a move target", () => {
  const ctx = context({
    selection: ["a.md"],
    grids: [
      { name: "Clippings", icon: "layout-grid" },
      { name: "Design", icon: "star", rules: { categories: ["design"] } },
    ],
    assignable: () => ({ key: "categories", value: "design" }),
  });
  const targets = find(ctx, "selection:move")?.stage?.items() ?? [];
  expect(targets.map((t) => t.label)).toContain("Design");
});

it("drops an auto-grid that names no single write", () => {
  const ctx = context({
    selection: ["a.md"],
    grids: [
      { name: "Clippings", icon: "layout-grid" },
      { name: "Mixed", icon: "star", rules: { categories: ["a"], status: ["unread"] } },
    ],
    assignable: () => null,
  });
  const targets = find(ctx, "selection:move")?.stage?.items() ?? [];
  expect(targets.map((t) => t.label)).not.toContain("Mixed");
});
```

Add `assignable: () => null` to the shared `context()` factory's defaults.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/commands.test.ts`
Expected: FAIL, the Mixed target is still offered.

- [ ] **Step 3: Write minimal implementation**

In `selectionCommands`, replace the targets line:

```ts
// Moving to the grid you are already in does nothing, and an auto-grid can
// only be a target when its rules name one write that would join it: a
// target that cannot act is worse than an absent one.
const targets = context.grids.filter(
  (grid) =>
    grid.name !== context.activeGrid &&
    (!isAutoGrid(grid) || context.assignable(grid) !== null)
);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, tsc exit 0.

- [ ] **Step 5: Make the move write the property**

In `view.moveTo`, before the `assign` path:

```ts
// Joining an auto-grid is not a move: the clipping keeps whatever grid key
// it had, because home stays everything and an auto-grid is not a place.
const space = this.allGrids().find((grid) => grid.name === name);
const write = space ? assignableValue(space, this.defs()) : null;
if (write) {
  for (const path of ids) await this.setProperty(path, write.key, [write.value]);
  return;
}
```

Note `setProperty` replaces the value here rather than appending. That matches the single-value picker in `view.ts:1314` for a `single` property; for a multi-valued property like `categories` it should append instead, so reuse the `withValue` helper that line already uses.

- [ ] **Step 6: Build and verify by hand**

Run: `npx tsc --noEmit && node esbuild.config.mjs`

Expected: `Move to grid` on a selection offers `Design`; choosing it adds `categories: design` to each note's frontmatter, leaves `grid:` alone, and the tiles appear in the Design auto-grid without leaving the grid they were in.

- [ ] **Step 7: Commit**

```bash
git add src/commands.ts src/view.ts tests/commands.test.ts
git commit -m "Join an auto-grid by making its rule true, which is not a move"
```

---

### Task 8: The filter menu shows the rules, and offers a shortcut into the editor

**Files:**
- Modify: `src/view.ts` (`openFilter`)

**Interfaces:**
- Consumes: `openNewAutoGrid` (Task 5), `isAutoGrid` (Task 1).
- Produces: no new exports.

- [ ] **Step 1: Show the rules inertly while an auto-grid is on screen**

At the top of the items `openFilter` builds, when the active grid `isAutoGrid`, prepend a section: one `disabled` row per rule reading `${def.label}: ${values.join(", ")}`, followed by a `divider` on the first facet row beneath. They explain why the wall looks like this, so the facets below are read as narrowing something rather than as the whole story.

- [ ] **Step 2: Add the Save as grid row**

At the end of the items, when the ad-hoc filter is non-empty:

```ts
{
  icon: "wand-2",
  label: "Save as grid…",
  divider: true,
  alwaysShow: true,
  onSelect: () => {
    const rules = this.activeFilter();
    if (this.sheet) openNewAutoGrid(this.sheet, this.gridsController(), rules, () => this.refresh());
  },
},
```

`alwaysShow` so it survives the menu's type-to-filter, which is what that flag is for.

- [ ] **Step 3: Build and verify by hand**

Run: `npx tsc --noEmit && node esbuild.config.mjs`

Expected: narrowing the wall and choosing Save as grid opens the editor with the rules already filled in; pressing through to Create grid produces a grid holding exactly what was on screen. Opening the filter inside that grid lists its rules inertly at the top.

- [ ] **Step 4: Commit**

```bash
git add src/view.ts
git commit -m "Show an auto-grid its rules, and let a narrowing become one"
```

---

### Task 9: Empty state

**Files:**
- Modify: `src/grid.ts` (`setTiles`), `styles.css`
- Test: none; `grid.ts` draws DOM.

**Interfaces:**
- Consumes: `isAutoGrid` (Task 1).
- Produces: `GridHandlers` gains `emptyState: () => { title: string; note: string; action?: { label: string; run: () => void } }`.

**This is new work, not a modification.** There is no empty state in the plugin today: an empty grid is a blank wall. Confirmed by `grep -rn "pg-empty|No clippings" src/ styles.css`, which finds nothing. That is survivable for a manual grid and confusing for an auto-grid, where a blank wall reads as a bug.

- [ ] **Step 1: Draw an empty state when there are no tiles**

In `grid.setTiles`, when the tile list is empty, render a centred `pg-empty` block holding a title, a note, and an optional action button, from the new `emptyState` handler. Remove it as soon as tiles arrive.

- [ ] **Step 2: Supply the two variants from the view**

```ts
emptyState: () => {
  const space = this.activeGrid();
  if (!isAutoGrid(space) || !space.rules) {
    return { title: "Nothing in this grid yet", note: "Clip something, or move a clipping here." };
  }
  return {
    title: "No clipping matches these rules",
    note: summariseRules(space.rules, this.defs()),
    action: { label: "Edit rules", run: () => this.editActiveGrid() },
  };
},
```

where `summariseRules` joins each facet as `${def.label}: ${values.join(", ")}` with `; ` between facets, and is the same helper Task 8 Step 1 uses for the inert rows. Put it in `src/filter.ts`, which is pure, and unit test it there.

- [ ] **Step 3: Style it**

```css
.pg-empty { /* centred over the wall, no pointer events except the action */ }
```

- [ ] **Step 4: Build and verify by hand**

Run: `npm test && npx tsc --noEmit && node esbuild.config.mjs`

Create an auto-grid whose rules match nothing. Expected: the rule copy and an Edit rules button, not the drop invitation. Then check an empty manual grid gets the other copy. Note the rules screen's live count should make the first case rare, since a rule matching nothing says `Matches 0 clippings` before the CTA is pressed.

- [ ] **Step 5: Commit**

```bash
git add src/view.ts src/grid.ts styles.css
git commit -m "Say why an auto-grid is empty, rather than inviting a drop it cannot take"
```

---

## Final verification

- [ ] `npm test` exits 0
- [ ] `npx tsc --noEmit` exits 0
- [ ] `node esbuild.config.mjs` writes the bundle into the vault
- [ ] In Obsidian: create an auto-grid, edit its rules, rename it, delete it, and confirm with `git status` in the vault that no clipping's frontmatter changed by any of it
- [ ] `git push`
