import { Notice } from "obsidian";
import { tokenLabel } from "./dates";
import { isFilterEmpty, toggleFacet } from "./filter";
import type { FacetDef, FacetValue, FilterState } from "./filter";
import type { Sheet, SheetRow, SheetScreen } from "./sheet";
import { isAutoGrid, reorderTarget, validateGridName } from "./spaces";
import type { GridSpace } from "./spaces";

/**
 * Icons offered when naming a grid. A fixed palette rather than a free-text
 * lucide id: a mistyped id renders nothing at all, and the user would have no
 * way to tell that from an icon that simply looks blank. Sheet's swatch
 * painter now refuses to draw an empty one, so a bad name here shows up as a
 * missing swatch during review rather than shipping as a hole in the grid.
 *
 * Six a row, grouped by what they suggest: marks, containers, media, making,
 * ideas. Order is presentation only, since a grid stores the icon's name.
 * Nothing may be removed, though: a grid already carrying an icon that left
 * the list would find no match, and be silently resaved as the first one.
 */
export const GRID_ICONS = [
  // Marks
  "layout-grid",
  "star",
  "heart",
  "bookmark",
  "pin",
  "tag",
  // Containers
  "folder",
  "archive",
  "package-open",
  "layers",
  "library",
  "sticky-note",
  // Media
  "image",
  "camera",
  "film",
  "music",
  "palette",
  "paintbrush",
  // Making
  "code",
  "terminal",
  "monitor",
  "flask-conical",
  "wrench",
  "scissors",
  // Ideas
  "lightbulb",
  "sparkles",
  "zap",
  "flame",
  "compass",
  "book-open",
];

/** Everything the grid UI needs from the view that owns the settings. */
/**
 * The wall as a rule editor sees it: every tile, typed and tallied together.
 *
 * Deliberately not the active grid's facets. A rule is written against the
 * whole vault, so offering it whichever wall happened to be open would let a
 * grid be defined from values that wall has and show a count it will not
 * honour once it is switched to.
 *
 * Gathered once per screen rather than per render: the vault does not change
 * while values are being ticked, so only `matches` needs recomputing, and it
 * is a pure pass over tiles already in hand.
 */
export interface RuleWorld {
  defs: FacetDef[];
  facets: Record<string, FacetValue[]>;
  matches(rules: FilterState): number;
}

export interface GridsController {
  home(): GridSpace;
  grids(): GridSpace[];
  /** Clippings carrying this name outright, which is what a rename rewrites. */
  memberCount(name: string): number;
  ruleWorld(): RuleWorld;
  create(space: GridSpace): Promise<void>;
  rename(from: string, next: GridSpace): Promise<void>;
  reorder(index: number, delta: number): Promise<void>;
  remove(index: number): Promise<void>;
}

/**
 * Naming, ordering and deleting grids, on the plugin's own surface.
 *
 * These were Obsidian modals, which are forms: a heading, some fields, a pair
 * of buttons. Everything else the plugin draws is a floating panel over the
 * wall, so the modals were the one place that looked borrowed from elsewhere.
 */

/** Must match the grid-template-columns in styles.css: the keyboard steps a
    whole row vertically, so it has to know how wide a row is. */
const SWATCH_COLUMNS = 6;

const PICK_HINTS: Array<[string, string]> = [
  ["↑↓", "navigate"],
  ["↵", "select"],
  ["esc", "back"],
];

/** The manager list, where a row can also be carried up and down the order. */
const MANAGE_HINTS: Array<[string, string]> = [
  ["↑↓", "navigate"],
  ["⌥↑↓ / drag", "move"],
  ["⌫", "delete"],
  ["↵", "select"],
  ["esc", "close"],
];

const EDIT_HINTS: Array<[string, string]> = [
  ["↑↓←→", "icon"],
  ["↵", "save"],
  ["esc", "back"],
];

/** A yes/no that has to say what it will do first. Two rows rather than a
    sentence and two buttons, so it is driven by the same keys as everything
    else on this surface. */
function confirm(
  sheet: Sheet,
  opts: { title: string; note: string; cta: string; destructive?: boolean; onConfirm: () => void }
): void {
  const screen: SheetScreen = {
    title: opts.title,
    note: opts.note,
    filters: false,
    // Cancel starts active. The confirmation exists because the other row is
    // worth a second thought, so it should not be one Enter away.
    active: 0,
    hints: PICK_HINTS,
    rows: () => [
      { label: "Cancel", icon: "x", onChoose: () => sheet.close() },
      {
        label: opts.cta,
        icon: opts.destructive ? "trash-2" : "check",
        destructive: opts.destructive,
        onChoose: () => {
          sheet.close();
          opts.onConfirm();
        },
      },
    ],
  };

  // Pushed onto a sheet that is already up so Escape returns to whatever asked
  // the question, and opened outright when there is none. push refuses on a
  // closed sheet and refuses silently, which is how a confirmation reached
  // straight from a menu came to do nothing at all.
  if (sheet.isOpen) sheet.push(screen);
  else sheet.open(screen);
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/**
 * Names a grid and picks its icon at once: the field is the name, the rows are
 * the icons. The rows are a choice beside the field rather than a list to
 * search, so typing goes to the name and Enter saves both.
 */
/** How a facet's chosen values read on the rules screen's row for it. */
function chosenLabel(def: FacetDef, values: readonly string[]): string {
  if (values.length === 0) return "Any";
  const shown = def.shape === "date" ? values.map(tokenLabel) : values;
  return shown.join(", ");
}

const RULE_HINTS: Array<[string, string]> = [
  ["\u2191\u2193", "navigate"],
  ["\u21b5", "choose"],
  ["esc", "back"],
];

const VALUE_HINTS: Array<[string, string]> = [
  ["\u2191\u2193", "navigate"],
  ["\u21b5", "toggle"],
  ["esc", "back"],
];

/**
 * Ticking the values of one facet, which is the whole of what a rule is.
 *
 * The same list the filter menu's submenu and the palette's stage draw, for
 * the same reason: a rule is a set of chosen values, so the thing that chooses
 * them should look like the thing that chooses them everywhere else.
 */
function ruleValuesScreen(
  sheet: Sheet,
  world: RuleWorld,
  def: FacetDef,
  read: () => FilterState,
  write: (next: FilterState) => void
): SheetScreen {
  return {
    title: def.label,
    placeholder: `${def.label}\u2026`,
    filters: true,
    hints: VALUE_HINTS,
    rows: () => {
      const chosen = read()[def.id] ?? [];
      return (world.facets[def.id] ?? []).map((entry) => ({
        // No left icon at all, so the list drops the gutter. A chosen value
        // marks itself where its count was: the count of a value you have
        // already picked is not what you read that row for.
        icon: "",
        label: def.shape === "date" ? tokenLabel(entry.value) : entry.value,
        value: entry.value,
        detail: String(entry.count),
        detailIcon: chosen.includes(entry.value) ? "check" : undefined,
        onChoose: () => {
          write(toggleFacet(read(), def.id, entry.value));
          // In place, so the tick and the count above it both move without
          // the screen being replaced under the cursor.
          sheet.refresh();
        },
      }));
    },
  };
}

/**
 * What picks the grid up: a row per facet, and a running count of what the
 * rules as they stand would hold.
 *
 * The count is the affordance that makes this a rule editor rather than a form
 * filled in blind, which is why the sheet's note had to learn to recompute.
 */
/**
 * @param grid the grid as the screen before this one left it, which on the
 * edit path already carries any new name and icon.
 * @param from the name it had before that screen, and so the one the registry
 * still knows it by. Kept apart from `grid.name` because renaming and
 * redefining happen on two screens of one flow, and `rename` needs both ends.
 */
function rulesScreen(
  sheet: Sheet,
  grids: GridsController,
  grid: GridSpace,
  index: number | undefined,
  after: () => void,
  from?: string
): SheetScreen {
  const world = grids.ruleWorld();
  const creating = index === undefined;
  let current: FilterState = { ...(grid.rules ?? {}) };

  return {
    title: "Rules",
    filters: true,
    hints: RULE_HINTS,
    cta: creating ? "Create grid" : "Save",
    note: () => {
      const n = world.matches(current);
      return `Matches ${n} ${plural(n, "clipping", "clippings")}`;
    },
    rows: () =>
      world.defs.map((def) => ({
        icon: def.icon,
        label: def.label,
        detail: chosenLabel(def, current[def.id] ?? []),
        onChoose: () =>
          sheet.push(
            ruleValuesScreen(
              sheet,
              world,
              def,
              () => current,
              (next) => {
                current = next;
              }
            )
          ),
      })),
    // onCommit, not onSubmit: Enter belongs to the facet rows, which are
    // stepped into rather than answered, and the button is what finishes.
    onCommit: () => {
      if (isFilterEmpty(current)) {
        // Without a rule it would hold the whole wall, which is home under a
        // second name. Refused here rather than hidden, so the reason is said.
        new Notice("Power Grid: an auto-grid needs at least one rule");
        return;
      }

      const next: GridSpace = { ...grid, rules: current };
      sheet.close();
      // No rename confirmation to make: an auto-grid has no members, because
      // nothing carries its name in frontmatter, so renaming one rewrites no
      // note and has nothing to warn about.
      if (creating) void grids.create(next).then(after);
      else void grids.rename(from ?? grid.name, next).then(after);
    },
  };
}

function gridEditorScreen(
  sheet: Sheet,
  grids: GridsController,
  grid: GridSpace,
  index: number | undefined,
  after: () => void
): SheetScreen {
  const others = grids
    .grids()
    .filter((_, i) => i !== index)
    .map((g) => g.name);
  // Home is not in the registry and cannot collide with itself.
  const home = index === undefined ? "" : grids.home().name;

  const creating = index === undefined && grid.name === "";
  /**
   * Whether this editor is making or editing an auto-grid.
   *
   * Deliberately not isAutoGrid, which asks whether a grid computes its
   * membership and is therefore false for the empty rules a new auto-grid
   * starts life with. The question here is which editor this is, and a
   * present-but-empty rules object is exactly how that is carried in.
   */
  const auto = grid.rules !== undefined;

  return {
    title: creating ? (auto ? "New auto-grid" : "New grid") : `Edit ${grid.name}`,
    placeholder: "Grid name",
    value: grid.name,
    filters: false,
    active: Math.max(0, GRID_ICONS.indexOf(grid.icon)),
    hints: EDIT_HINTS,
    // A grid of swatches, not a list: the icons are one value being chosen,
    // and as rows the chosen one had nowhere to show itself.
    layout: "swatches",
    columns: SWATCH_COLUMNS,
    cta: auto ? "Next: rules" : creating ? "Create grid" : "Save",
    rows: () =>
      GRID_ICONS.map((name) => ({
        label: name.replace(/-/g, " "),
        value: name,
        icon: name,
      })),
    onSubmit: (name, active) => {
      const reason = validateGridName(name, others, home, creating ? undefined : grid.name);
      if (reason) {
        // A Notice rather than an inline line: this surface has no room for
        // one that does not push the rows about as it appears and goes.
        new Notice(`Power Grid: ${reason}`);
        return;
      }

      const next: GridSpace = {
        ...grid,
        name: name.trim(),
        icon: active?.value ?? grid.icon,
      };

      // An auto-grid is not finished until it says what picks it up, so the
      // name screen hands on rather than committing, whether it is being made
      // or edited. Editing carries the old name along, since the registry
      // still knows it by that and this screen may just have changed it.
      if (auto) {
        sheet.push(rulesScreen(sheet, grids, next, index, after, grid.name));
        return;
      }

      if (creating) {
        sheet.close();
        void grids.create(next).then(after);
        return;
      }

      const renamed = next.name !== grid.name;
      const members = renamed ? grids.memberCount(grid.name) : 0;
      const apply = (): void => void grids.rename(grid.name, next).then(after);

      // Only a rename touches notes. Changing an icon is settings alone, so it
      // should not stop to ask.
      if (renamed && members > 0) {
        confirm(sheet, {
          title: `Rename to ${next.name}?`,
          note: `${members} ${plural(members, "clipping carries", "clippings carry")} this grid and will be updated.`,
          cta: "Rename",
          onConfirm: apply,
        });
        return;
      }

      sheet.close();
      apply();
    },
  };
}

/** Pushed onto whatever is already showing, for editing from the manager. */
export function openGridEditor(
  sheet: Sheet,
  grids: GridsController,
  grid: GridSpace,
  index: number | undefined,
  after: () => void = () => undefined
): void {
  const screen = gridEditorScreen(sheet, grids, grid, index, after);
  // Pushed onto a sheet that is already up, so Escape backs out to whatever
  // opened this rather than throwing the whole stack away; opened outright
  // when there is none, which is how the wall's settings menu arrives. Pushing
  // unconditionally is what made that route do nothing at all: push refuses on
  // a closed sheet, and refuses silently.
  if (sheet.isOpen) sheet.push(screen);
  else sheet.open(screen);
}

function confirmDelete(
  sheet: Sheet,
  grids: GridsController,
  grid: GridSpace,
  index: number,
  after: () => void
): void {
  const auto = isAutoGrid(grid);
  const members = auto ? 0 : grids.memberCount(grid.name);
  const home = grids.home().name;

  confirm(sheet, {
    title: `Delete ${grid.name}?`,
    note: auto
      ? // Not "the grid is empty, so nothing moves", which memberCount would
        // have produced and which reads as a fact about its contents. An
        // auto-grid holds plenty; what it does not hold is membership, so
        // there is nothing to move whatever is on screen.
        "Its rules are removed. No clipping is changed."
      : members === 0
        ? "The grid is empty, so nothing moves."
        : `${members} ${plural(members, "clipping", "clippings")} will return to ${home}. No notes are deleted and nothing is rewritten.`,
    cta: "Delete grid",
    destructive: true,
    onConfirm: () => void grids.remove(index).then(after),
  });
}

/** Deleting one directly, for a caller that already knows which. */
export function openDeleteGrid(
  sheet: Sheet,
  grids: GridsController,
  grid: GridSpace,
  index: number,
  after: () => void = () => undefined
): void {
  confirmDelete(sheet, grids, grid, index, after);
}

/** The whole set: pick a grid, then pick what to do with it. */
export function openGridsManager(
  sheet: Sheet,
  grids: GridsController,
  after: () => void = () => undefined
): void {
  /**
   * The grid whose row is asking to be deleted, by name.
   *
   * Held here rather than by the sheet because it is this screen's idea: the
   * row it belongs to is rebuilt on every render, so anything kept on the
   * element itself would not survive the repaint that shows the question.
   */
  let armed: string | null = null;

  const disarm = (): boolean => {
    if (armed === null) return false;
    armed = null;
    sheet.refresh();
    return true;
  };

  /** The label an armed row wears, which is also how the cursor is recognised
      as still being on it. */
  const armedLabel = (name: string): string => `Delete ${name}?`;

  const list = (_query: string, activeLabel: string): SheetRow[] => {
    const home = grids.home();
    const registry = grids.grids();

    // A cursor that has moved on has left the question behind, so the row
    // stops asking. Otherwise an armed row sits there in red while Enter does
    // something else entirely, several rows away. Matched by label, since a
    // narrowed list renumbers everything.
    if (armed !== null && activeLabel !== armedLabel(armed)) armed = null;

    const rows: SheetRow[] = [
      {
        label: home.name,
        icon: home.icon,
        detail: String(grids.memberCount(home.name)),
        // Home has no position in the registry, so it can be renamed and
        // re-iconed but never moved or removed.
        onChoose: () => actions(home, undefined),
      },
    ];

    registry.forEach((grid, index) => {
      if (grid.name === armed) {
        const members = grids.memberCount(grid.name);
        rows.push({
          label: armedLabel(grid.name),
          icon: "trash-2",
          destructive: true,
          // Says where the clippings go, because that is the part worth
          // knowing before answering and there is no room for a sentence.
          detail: members === 0 ? "empty" : `${members} → ${home.name}`,
          onChoose: () => {
            armed = null;
            void grids.remove(index).then(() => {
              after();
              sheet.refresh();
            });
          },
        });
        return;
      }

      rows.push({
        label: grid.name,
        icon: grid.icon,
        detail: String(grids.memberCount(grid.name)),
        onChoose: () => actions(grid, index),
      });
    });

    return rows;
  };

  const reopen = (): void => {
    after();
    openGridsManager(sheet, grids, after);
  };

  const actions = (grid: GridSpace, index: number | undefined): void => {
    // Read on every repaint rather than captured once. Moving the grid changes
    // where it sits, and a captured index would have the next press move
    // whatever had slid into the place this one just left.
    const positionOf = (): number =>
      grids.grids().findIndex((entry) => entry.name === grid.name);

    const move = (delta: number): void => {
      const target = reorderTarget(positionOf() + 1, delta, grids.grids().length);
      if (!target) return;
      void grids.reorder(target.from, delta);
      // Repainted where it stands. Returning to the list after every move is
      // what made rearranging cost a round trip per position, and cost you
      // your place in the list on each one.
      sheet.refresh();
    };

    const build = (): SheetRow[] => {
      const at = positionOf();
      const count = grids.grids().length;
      const rows: SheetRow[] = [
        {
          label: "Rename or re-icon",
          icon: "pencil",
          onChoose: () =>
            openGridEditor(
              sheet,
              grids,
              grid,
              index === undefined ? undefined : at,
              reopen
            ),
        },
      ];

      if (index !== undefined && at >= 0) {
        rows.push({
          label: "Move up",
          icon: "arrow-up",
          detail: at === 0 ? "first" : undefined,
          onChoose: () => move(-1),
        });
        rows.push({
          label: "Move down",
          icon: "arrow-down",
          detail: at === count - 1 ? "last" : undefined,
          onChoose: () => move(1),
        });
        rows.push({
          label: "Delete",
          icon: "trash-2",
          destructive: true,
          onChoose: () => confirmDelete(sheet, grids, grid, at, after),
        });
      }

      return rows;
    };

    sheet.push({
      title: grid.name,
      placeholder: "Search actions…",
      filters: true,
      hints: PICK_HINTS,
      rows: build,
    });
  };

  sheet.open({
    title: "Manage grids",
    placeholder: "Search grids…",
    filters: true,
    hints: MANAGE_HINTS,
    rows: list,
    // Backspace asks, Enter answers, both on the row itself. A grid is cheap
    // to remake and nothing it held is deleted, so a question in place beats
    // a screen of its own for something reached this often.
    onDelete: (row) => {
      // Found by the name on the row rather than by where it sits, because a
      // narrowed list renumbers. Home is excluded by not being in the
      // registry at all: it is where every clipping whose grid no longer
      // resolves is shown, so it always has to exist.
      const grid = grids.grids().find((entry) => entry.name === row.label);
      if (!grid) return;
      armed = grid.name;
      sheet.refresh();
    },
    // Takes the question back before it takes the screen.
    onEscape: disarm,
    // Rearranged where the whole order is visible, rather than one grid at a
    // time through a screen that threw you back to the top after every move.
    onReorder: (row, delta) => {
      const move = reorderTarget(row, delta, grids.grids().length);
      if (!move) return false;
      // reorder splices synchronously and only the save it does afterwards is
      // async, so the list can repaint at once and the write can catch up. A
      // run of presses stays in order because the mutation is not the slow
      // part.
      // Deliberately no refresh. Nothing painted depends on the order:
      // allGrids and hotkeyPosition both read the settings live, and the
      // space bar shows only the active grid's icon. Repainting here rebuilt
      // every tile on the wall on each row crossed, which is the whole of why
      // dragging stuttered.
      void grids.reorder(move.from, delta);
      return true;
    },
  });
}

/** Creating one, from the wall's plus button. The first screen rather than a
    pushed one, so Escape closes instead of backing into nothing. */
export function openNewGrid(
  sheet: Sheet,
  grids: GridsController,
  after: () => void = () => undefined
): void {
  sheet.open(
    gridEditorScreen(sheet, grids, { name: "", icon: GRID_ICONS[0] }, undefined, after)
  );
}

/**
 * The same editor, making the other kind of grid.
 *
 * `rules` seeds it: empty from the create menu, and already filled in when the
 * filter menu's Save as grid hands over what is currently narrowing the wall.
 * An empty rules object is what tells the editor which kind it is making, so
 * it is passed even when there is nothing in it.
 */
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
