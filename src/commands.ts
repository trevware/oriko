import type { FacetDef, FacetValue, FilterState } from "./filter";
import { hotkeyPosition } from "./spaces";
import type { GridSpace } from "./spaces";

/**
 * Everything the palette can do, built fresh from the wall's current state.
 *
 * Deliberately its own list rather than a rendering of the context menus.
 * The two surfaces want different things: a menu wants submenus, inert rows
 * that keep the set legible, and an anchor point, while the palette wants
 * stable ids, words to search on that it never shows, and no dead rows at
 * all, because a row you cannot pick is a row that should not have survived
 * your query. What they share is the work itself: every run() below calls
 * the same view method its menu row calls.
 */

export type PaletteSection = "Actions" | "Grids" | "Filters" | "Capture";

export interface PaletteStage {
  /** Shown as a chip in the input while the stage is open. */
  title: string;
  placeholder: string;
  /**
   * Rebuilt on each render rather than captured, so a keepOpen row shows the
   * state its own last click produced instead of the state it opened in.
   */
  items: () => PaletteCommand[];
}

export interface PaletteCommand {
  id: string;
  label: string;
  icon: string;
  section: PaletteSection;
  /** Right-hand text: a shortcut hint, a count, or a tally. */
  detail?: string;
  /**
   * Right-hand icon, shown in place of `detail`. A row whose state is worth
   * marking says so where its count was, rather than in a left-hand gutter
   * every other row then reserves while saying nothing.
   */
  detailIcon?: string;
  /** Extra words to match on that the row never displays. */
  keywords?: string;
  destructive?: boolean;
  /** Leaves the palette open after running, for rows used several at a time. */
  keepOpen?: boolean;
  /** Opens a second stage instead of running. */
  stage?: PaletteStage;
  run?: () => void;
}

/** The work behind the rows, all of it already implemented by the view. */
export interface PaletteActions {
  openNote(id: string): void;
  exportSelection(ids: string[]): void;
  reveal(id: string): void;
  move(ids: string[], grid: string): void;
  remove(ids: string[]): void;
  switchGrid(name: string): void;
  newGrid(): void;
  editGrid(): void;
  deleteGrid(): void;
  manageGrids(): void;
  toggleFacet(id: string, value: string): void;
  clearFilters(): void;
  clipLink(): void;
  clipImage(): void;
  archiveAll(): void;
  selectAll(): void;
  resetZoom(): void;
}

export interface PaletteContext {
  /** Note paths currently selected on the wall. */
  selection: string[];
  /** Every grid, home first, in switcher order. */
  grids: GridSpace[];
  activeGrid: string;
  homeGrid: string;
  /** The facets on offer, in menu order. */
  facetDefs: FacetDef[];
  facets: Record<string, FacetValue[]>;
  filter: FilterState;
  /** False off desktop, where there is no Finder and no Downloads folder. */
  hasSystem: boolean;
  actions: PaletteActions;
}

/** Grid hotkeys are ⌘1..⌘9 by position, so only the first nine have one. */
function gridHotkey(position: number): string | undefined {
  return hotkeyPosition(String(position + 1)) === position ? `⌘${position + 1}` : undefined;
}

function selectionCommands(context: PaletteContext): PaletteCommand[] {
  const { selection, actions } = context;
  if (selection.length === 0) return [];

  const count = `${selection.length} selected`;
  const one = selection.length === 1;
  const items: PaletteCommand[] = [];

  if (one) {
    items.push({
      id: "selection:open-note",
      label: "Open note",
      icon: "file-text",
      section: "Actions",
      keywords: "markdown edit source text",
      run: () => actions.openNote(selection[0]),
    });
  }

  if (context.hasSystem) {
    items.push({
      id: "selection:export",
      label: "Export to Downloads",
      icon: "download",
      section: "Actions",
      detail: one ? "⌘E" : count,
      keywords: "save copy download file",
      run: () => actions.exportSelection(selection),
    });

    // Revealing picks one file, so a selection of many has no single answer.
    if (one) {
      items.push({
        id: "selection:reveal",
        label: "Reveal in Finder",
        icon: "folder",
        section: "Actions",
        keywords: "finder show file folder disk",
        run: () => actions.reveal(selection[0]),
      });
    }
  }

  // Moving to the grid you are already in does nothing, and every selected
  // tile is in it by definition, so a single-grid vault has no target.
  const targets = context.grids.filter((grid) => grid.name !== context.activeGrid);
  if (targets.length > 0) {
    items.push({
      id: "selection:move",
      label: "Move to grid",
      icon: "corner-up-right",
      section: "Actions",
      detail: one ? undefined : count,
      keywords: "file assign wall board send",
      stage: {
        title: "Move to grid",
        placeholder: "Move to…",
        items: () =>
          targets.map((grid) => ({
            id: `selection:move:${grid.name}`,
            label: grid.name,
            icon: grid.icon,
            section: "Actions" as const,
            run: () => actions.move(selection, grid.name),
          })),
      },
    });
  }

  items.push({
    id: "selection:delete",
    label: "Delete",
    icon: "trash-2",
    section: "Actions",
    detail: count,
    destructive: true,
    keywords: "remove trash bin",
    run: () => actions.remove(selection),
  });

  return items;
}

function gridCommands(context: PaletteContext): PaletteCommand[] {
  const { actions } = context;
  const items: PaletteCommand[] = [];

  context.grids.forEach((grid, position) => {
    // Switching to where you already are is not an action.
    if (grid.name === context.activeGrid) return;
    items.push({
      id: `grid:switch:${grid.name}`,
      label: grid.name,
      icon: grid.icon,
      section: "Grids",
      detail: gridHotkey(position),
      keywords: "switch go to grid wall open",
      run: () => actions.switchGrid(grid.name),
    });
  });

  items.push({
    id: "grid:new",
    label: "New grid",
    icon: "layers",
    section: "Grids",
    keywords: "create add wall board",
    run: () => actions.newGrid(),
  });

  items.push({
    id: "grid:edit",
    label: "Edit this grid",
    icon: "pencil",
    section: "Grids",
    detail: context.activeGrid,
    keywords: "rename icon name",
    run: () => actions.editGrid(),
  });

  // Home is where an unknown grid falls back to, so it always has to exist.
  if (context.activeGrid !== context.homeGrid) {
    items.push({
      id: "grid:delete",
      label: "Delete this grid",
      icon: "trash-2",
      section: "Grids",
      detail: context.activeGrid,
      destructive: true,
      keywords: "remove wall board",
      run: () => actions.deleteGrid(),
    });
  }

  items.push({
    id: "grid:manage",
    label: "Manage grids",
    icon: "layers",
    section: "Grids",
    detail: `${context.grids.length} grids`,
    keywords: "reorder rename panel all",
    run: () => actions.manageGrids(),
  });

  return items;
}

function filterCommands(context: PaletteContext): PaletteCommand[] {
  const { actions } = context;
  const items: PaletteCommand[] = [];

  for (const def of context.facetDefs) {
    const values = context.facets[def.id] ?? [];
    // A facet nothing on the wall carries has nothing to offer. The menu
    // shows it disabled so its set reads whole; a search result cannot.
    if (values.length === 0) continue;

    const chosen = context.filter[def.id] ?? [];
    // Built from the label rather than stored alongside it, so a property the
    // user adds reads the same as one the plugin ships knowing about.
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
            // No left icon at all, so the list drops the gutter. A chosen
            // value marks itself where its count was: the count of a value
            // you have already picked is not what you read that row for.
            icon: "",
            section: "Filters" as const,
            detail: String(entry.count),
            detailIcon: (context.filter[def.id] ?? []).includes(entry.value)
              ? "check"
              : undefined,
            keepOpen: true,
            run: () => actions.toggleFacet(def.id, entry.value),
          })),
      },
    });
  }

  const active = Object.values(context.filter).reduce((total, values) => total + values.length, 0);
  if (active > 0) {
    items.push({
      id: "filter:clear",
      label: "Clear filters",
      icon: "circle-slash",
      section: "Filters",
      detail: `${active} active`,
      keywords: "reset show all remove narrow",
      run: () => actions.clearFilters(),
    });
  }

  return items;
}

function captureCommands(context: PaletteContext): PaletteCommand[] {
  const { actions } = context;

  return [
    {
      id: "capture:link",
      label: "Clip link from clipboard",
      icon: "link",
      section: "Capture",
      detail: "⌘N",
      keywords: "paste url add new save web",
      run: () => actions.clipLink(),
    },
    {
      id: "capture:image",
      label: "Clip image from clipboard",
      icon: "image",
      section: "Capture",
      detail: "⇧⌘N",
      keywords: "paste picture add new save screenshot",
      run: () => actions.clipImage(),
    },
    {
      id: "capture:archive-all",
      label: "Archive all clipping media",
      icon: "hard-drive-download",
      section: "Capture",
      keywords: "download local backup repair missing",
      run: () => actions.archiveAll(),
    },
    {
      id: "view:select-all",
      label: "Select all",
      icon: "box-select",
      section: "Capture",
      detail: "⌘A",
      keywords: "everything whole wall",
      run: () => actions.selectAll(),
    },
    {
      id: "view:reset-zoom",
      label: "Reset zoom",
      icon: "maximize",
      section: "Capture",
      detail: "⌘0",
      keywords: "fit zoom out home view camera",
      run: () => actions.resetZoom(),
    },
  ];
}

/** In section order, which is the order the palette shows them in. */
export function buildCommands(context: PaletteContext): PaletteCommand[] {
  return [
    ...selectionCommands(context),
    ...gridCommands(context),
    ...filterCommands(context),
    ...captureCommands(context),
  ];
}
