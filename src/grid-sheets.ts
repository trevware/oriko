import { Notice } from "obsidian";
import type { Sheet, SheetRow, SheetScreen } from "./sheet";
import { validateGridName } from "./spaces";
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
export interface GridsController {
  home(): GridSpace;
  grids(): GridSpace[];
  /** Clippings carrying this name outright, which is what a rename rewrites. */
  memberCount(name: string): number;
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
  sheet.push({
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
  });
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/**
 * Names a grid and picks its icon at once: the field is the name, the rows are
 * the icons. The rows are a choice beside the field rather than a list to
 * search, so typing goes to the name and Enter saves both.
 */
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

  return {
    title: creating ? "New grid" : `Edit ${grid.name}`,
    placeholder: "Grid name",
    value: grid.name,
    filters: false,
    active: Math.max(0, GRID_ICONS.indexOf(grid.icon)),
    hints: EDIT_HINTS,
    // A grid of swatches, not a list: the icons are one value being chosen,
    // and as rows the chosen one had nowhere to show itself.
    layout: "swatches",
    columns: SWATCH_COLUMNS,
    cta: creating ? "Create grid" : "Save",
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

      const next: GridSpace = { name: name.trim(), icon: active?.value ?? grid.icon };

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
  const members = grids.memberCount(grid.name);
  const home = grids.home().name;

  confirm(sheet, {
    title: `Delete ${grid.name}?`,
    note:
      members === 0
        ? "The grid is empty, so nothing moves."
        : `${members} ${plural(members, "clipping", "clippings")} will return to ${home}. No notes are deleted and nothing is rewritten.`,
    cta: "Delete grid",
    destructive: true,
    onConfirm: () => void grids.remove(index).then(after),
  });
}

/** The whole set: pick a grid, then pick what to do with it. */
export function openGridsManager(
  sheet: Sheet,
  grids: GridsController,
  after: () => void = () => undefined
): void {
  const list = (): SheetRow[] => {
    const home = grids.home();
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

    grids.grids().forEach((grid, index) => {
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
    const count = grids.grids().length;
    const rows: SheetRow[] = [
      {
        label: "Rename or re-icon",
        icon: "pencil",
        onChoose: () => openGridEditor(sheet, grids, grid, index, reopen),
      },
    ];

    if (index !== undefined) {
      rows.push({
        label: "Move up",
        icon: "arrow-up",
        detail: index === 0 ? "first" : undefined,
        onChoose: () => {
          if (index === 0) return;
          void grids.reorder(index, -1).then(reopen);
        },
      });
      rows.push({
        label: "Move down",
        icon: "arrow-down",
        detail: index === count - 1 ? "last" : undefined,
        onChoose: () => {
          if (index === count - 1) return;
          void grids.reorder(index, 1).then(reopen);
        },
      });
      rows.push({
        label: "Delete",
        icon: "trash-2",
        destructive: true,
        onChoose: () => confirmDelete(sheet, grids, grid, index, after),
      });
    }

    sheet.push({
      title: grid.name,
      placeholder: "Search actions…",
      filters: true,
      hints: PICK_HINTS,
      rows: () => rows,
    });
  };

  sheet.open({
    title: "Manage grids",
    placeholder: "Search grids…",
    filters: true,
    hints: PICK_HINTS,
    rows: list,
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
