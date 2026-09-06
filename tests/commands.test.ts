import { describe, expect, it } from "vitest";
import { buildCommands, facetValueCommands } from "../src/core/commands";
import type { PaletteContext } from "../src/core/commands";
import { emptyFilter, facetDefs } from "../src/core/filter";

const DEFS = facetDefs(["categories", "status"]);

const noop = (): void => {};

const actions = {
  openNote: noop,
  exportSelection: noop,
  reveal: noop,
  move: noop,
  remove: noop,
  switchGrid: noop,
  newGrid: noop,
  moveToFolder: noop,
  newFolder: noop,
  openFolder: noop,
  undo: noop,
  redo: noop,
  editGrid: noop,
  deleteGrid: noop,
  manageGrids: noop,
  toggleFacet: noop,
  clearFilters: noop,
  clip: noop,
  archiveAll: noop,
  selectAll: noop,
  resetZoom: noop,
};

function context(over: Partial<PaletteContext> = {}): PaletteContext {
  return {
    selection: [],
    grids: [
      { name: "Clippings", icon: "layout-grid" },
      { name: "Demo", icon: "star" },
    ],
    activeGrid: "Clippings",
    homeGrid: "Clippings",
    folders: [],
    canFile: true,
    undoLabel: null,
    redoLabel: null,
    facetDefs: DEFS,
    facets: { categories: [], status: [], kind: [], domain: [] },
    filter: emptyFilter(),
    hasSystem: true,
    actions,
    ...over,
  };
}

const ids = (ctx: PaletteContext): string[] => buildCommands(ctx).map((c) => c.id);

const find = (ctx: PaletteContext, id: string) =>
  buildCommands(ctx).find((c) => c.id === id);

describe("buildCommands", () => {
  it("offers no selection actions while nothing is selected", () => {
    expect(ids(context())).not.toContain("selection:delete");
  });

  it("offers the selection actions once something is selected", () => {
    const list = ids(context({ selection: ["a.md"] }));
    expect(list).toContain("selection:open-note");
    expect(list).toContain("selection:export");
    expect(list).toContain("selection:reveal");
    expect(list).toContain("selection:delete");
  });

  it("says how many clippings an action will act on", () => {
    expect(find(context({ selection: ["a.md", "b.md", "c.md"] }), "selection:delete")?.detail).toBe(
      "3 selected"
    );
  });

  it("drops Reveal in Finder for a multiple selection, which reveals one file", () => {
    expect(ids(context({ selection: ["a.md", "b.md"] }))).not.toContain("selection:reveal");
  });

  it("drops the Finder and Downloads actions when the platform has neither", () => {
    const list = ids(context({ selection: ["a.md"], hasSystem: false }));
    expect(list).not.toContain("selection:export");
    expect(list).not.toContain("selection:reveal");
  });

  it("marks deletion destructive", () => {
    expect(find(context({ selection: ["a.md"] }), "selection:delete")?.destructive).toBe(true);
  });

  it("offers every grid but the one you are in as a move target", () => {
    const move = find(context({ selection: ["a.md"] }), "selection:move");
    expect(move?.stage?.items().map((item) => item.label)).toEqual(["Demo"]);
  });

  it("drops the move action when there is nowhere else to move to", () => {
    const only = context({ selection: ["a.md"], grids: [{ name: "Clippings", icon: "layout-grid" }] });
    expect(ids(only)).not.toContain("selection:move");
  });

  it("offers every grid but the one you are in as a switch target", () => {
    expect(ids(context())).toContain("grid:switch:Demo");
    expect(ids(context())).not.toContain("grid:switch:Clippings");
  });

  it("hints the grid's own hotkey, counting from the home grid", () => {
    expect(find(context(), "grid:switch:Demo")?.detail).toBe("⌘2");
  });

  it("will not offer to delete the home grid, which everything falls back to", () => {
    expect(ids(context())).not.toContain("grid:delete");
  });

  it("offers to delete a grid that is not home", () => {
    expect(ids(context({ activeGrid: "Demo" }))).toContain("grid:delete");
  });

  it("offers a filter command only for facets that have values", () => {
    const ctx = context({
      facets: {
        categories: [{ value: "design", count: 2 }],
        status: [],
        kind: [],
        domain: [],
      },
    });
    const list = ids(ctx);
    expect(list).toContain("filter:categories");
    expect(list).not.toContain("filter:status");
  });

  it("lists a facet's values with their counts, and keeps the palette open", () => {
    const ctx = context({
      facets: {
        categories: [
          { value: "design", count: 2 },
          { value: "ios", count: 1 },
        ],
        status: [],
        kind: [],
        domain: [],
      },
    });
    const values = find(ctx, "filter:categories")?.stage?.items() ?? [];
    expect(values.map((v) => [v.label, v.detail])).toEqual([
      ["design", "2"],
      ["ios", "1"],
    ]);
    expect(values.every((v) => v.keepOpen)).toBe(true);
  });

  it("reads an empty value as Is empty in the facet stage, as the menu does", () => {
    const ctx = context({
      facets: {
        categories: [
          { value: "design", count: 2 },
          { value: "", count: 13 },
        ],
        status: [],
        kind: [],
        domain: [],
      },
    });
    const values = find(ctx, "filter:categories")?.stage?.items() ?? [];
    expect(values.map((v) => v.label)).toEqual(["design", "Is empty"]);
    expect(values.map((v) => v.divider ?? false)).toEqual([false, true]);
  });

  it("marks the facet values already filtering the wall, in the count's slot", () => {
    const ctx = context({
      facets: {
        categories: [
          { value: "design", count: 2 },
          { value: "ios", count: 1 },
        ],
        status: [],
        kind: [],
        domain: [],
      },
      filter: { ...emptyFilter(), categories: ["ios"] },
    });
    const values = find(ctx, "filter:categories")?.stage?.items() ?? [];
    expect(values.map((v) => v.detailIcon)).toEqual([undefined, "check"]);
  });

  it("leaves every facet value without a left icon, so the gutter goes", () => {
    const ctx = context({
      facets: {
        categories: [
          { value: "design", count: 2 },
          { value: "ios", count: 1 },
        ],
        status: [],
        kind: [],
        domain: [],
      },
      filter: { ...emptyFilter(), categories: ["ios"] },
    });
    const values = find(ctx, "filter:categories")?.stage?.items() ?? [];
    expect(values.map((v) => v.icon)).toEqual(["", ""]);
  });

  it("keeps the count on a value that is not chosen", () => {
    const ctx = context({
      facets: {
        categories: [{ value: "design", count: 2 }],
        status: [],
        kind: [],
        domain: [],
      },
    });
    const values = find(ctx, "filter:categories")?.stage?.items() ?? [];
    expect(values[0]).toMatchObject({ detail: "2", detailIcon: undefined });
  });

  it("offers to clear filters only while something is filtered", () => {
    expect(ids(context())).not.toContain("filter:clear");
    expect(
      ids(context({ filter: { ...emptyFilter(), categories: ["design"] } }))
    ).toContain("filter:clear");
  });

  it("always offers the capture commands", () => {
    const list = ids(context());
    expect(list).toContain("capture:clip");
    expect(list).toContain("capture:archive-all");
  });

  it("gives every command a unique id", () => {
    const list = ids(context({ selection: ["a.md"] }));
    expect(new Set(list).size).toBe(list.length);
  });

  it("runs the action it was built with", () => {
    let moved: [string[], string] | null = null;
    const ctx = context({
      selection: ["a.md"],
      actions: { ...actions, move: (paths: string[], grid: string) => (moved = [paths, grid]) },
    });
    find(ctx, "selection:move")?.stage?.items()[0].run?.();
    expect(moved).toEqual([["a.md"], "Demo"]);
  });
});

describe("folder commands", () => {
  const KITCHEN = { name: "Kitchen", icon: "folder", grid: "Clippings", width: 1 as const };

  it("offers the active grid's folders as places to move a selection", () => {
    const ctx = context({ selection: ["a.md"], folders: [KITCHEN] });
    const stage = find(ctx, "selection:folder")?.stage?.items() ?? [];
    expect(stage.map((c) => c.id)).toEqual(["selection:folder:Kitchen", "selection:folder:new"]);
  });

  it("still offers New folder when the grid has none yet", () => {
    const ctx = context({ selection: ["a.md"] });
    const stage = find(ctx, "selection:folder")?.stage?.items() ?? [];
    expect(stage.map((c) => c.id)).toEqual(["selection:folder:new"]);
  });

  it("moves the selection into the chosen folder", () => {
    let moved: [string[], string] | null = null;
    const ctx = context({
      selection: ["a.md"],
      folders: [KITCHEN],
      actions: { ...actions, moveToFolder: (paths, folder) => (moved = [paths, folder]) },
    });
    find(ctx, "selection:folder")?.stage?.items()[0].run?.();
    expect(moved).toEqual([["a.md"], "Kitchen"]);
  });

  it("hands the selection to New folder so it lands inside on save", () => {
    let seeded: string[] | null = null;
    const ctx = context({
      selection: ["a.md"],
      actions: { ...actions, newFolder: (paths) => (seeded = paths) },
    });
    find(ctx, "selection:folder")?.stage?.items()[0].run?.();
    expect(seeded).toEqual(["a.md"]);
  });

  it("offers New folder beside New grid and opens each folder", () => {
    const list = ids(context({ folders: [KITCHEN] }));
    expect(list).toContain("folder:new");
    expect(list).toContain("folder:open:Kitchen");
  });

  it("offers nothing folder-shaped on a grid that cannot be filed into", () => {
    const list = ids(context({ selection: ["a.md"], canFile: false }));
    expect(list).not.toContain("selection:folder");
    expect(list).not.toContain("folder:new");
  });
});

describe("history commands", () => {
  it("offers nothing while there is nothing to undo or redo", () => {
    const list = ids(context());
    expect(list).not.toContain("history:undo");
    expect(list).not.toContain("history:redo");
  });

  it("names the action it would undo", () => {
    const ctx = context({ undoLabel: "Move to Kitchen" });
    expect(find(ctx, "history:undo")?.label).toBe("Undo Move to Kitchen");
    expect(find(ctx, "history:undo")?.detail).toBe("⌘Z");
  });

  it("names the action it would redo", () => {
    const ctx = context({ redoLabel: "Edit status" });
    expect(find(ctx, "history:redo")?.label).toBe("Redo Edit status");
    expect(find(ctx, "history:redo")?.detail).toBe("⌘⇧Z");
  });

  it("runs undo and redo", () => {
    const ran: string[] = [];
    const ctx = context({
      undoLabel: "A",
      redoLabel: "B",
      actions: { ...actions, undo: () => ran.push("undo"), redo: () => ran.push("redo") },
    });
    find(ctx, "history:undo")?.run?.();
    find(ctx, "history:redo")?.run?.();
    expect(ran).toEqual(["undo", "redo"]);
  });
});

describe("filters over user-defined properties", () => {
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
});

describe("facetValueCommands", () => {
  const populated = (over: Partial<PaletteContext> = {}): PaletteContext =>
    context({
      facets: {
        categories: [
          { value: "ios", count: 12 },
          { value: "design", count: 31 },
        ],
        status: [{ value: "unread", count: 4 }],
        kind: [],
        domain: [],
      },
      ...over,
    });

  const values = (ctx: PaletteContext) => facetValueCommands(ctx);

  it("offers one row per value, named by the facet it belongs to", () => {
    expect(values(populated()).map((c) => c.label)).toEqual([
      "Categories: ios",
      "Categories: design",
      "Status: unread",
    ]);
  });

  it("searches on the value alone, so the facet name cannot match every row", () => {
    expect(values(populated()).map((c) => c.matchOn)).toEqual(["ios", "design", "unread"]);
  });

  it("carries the same id as the row inside the stage, being the same action", () => {
    const ctx = populated();
    const staged = buildCommands(ctx).find((c) => c.id === "filter:categories")?.stage?.items();
    expect(values(ctx)[0].id).toBe(staged?.[0].id);
  });

  it("counts a value that is not chosen", () => {
    expect(values(populated())[0]).toMatchObject({ detail: "12", detailIcon: undefined });
  });

  it("ticks a value that is already filtered", () => {
    const ctx = populated({ filter: { ...emptyFilter(), categories: ["ios"] } });
    expect(values(ctx)[0].detailIcon).toBe("check");
  });

  it("stays open after a pick, so several values can be toggled", () => {
    expect(values(populated())[0].keepOpen).toBe(true);
  });

  it("toggles the facet it was built from", () => {
    let toggled: [string, string] | null = null;
    const ctx = populated({
      actions: { ...actions, toggleFacet: (id: string, value: string) => (toggled = [id, value]) },
    });
    values(ctx)[0].run?.();
    expect(toggled).toEqual(["categories", "ios"]);
  });

  it("reads a date bucket back as words, in the label and in what it matches", () => {
    const ctx = context({
      facetDefs: [
        { id: "created", label: "Created", icon: "calendar", keywords: "", source: "property", key: "created", shape: "date", now: 0 },
      ],
      facets: { created: [{ value: "empty", count: 3 }] },
    });
    expect(values(ctx)[0]).toMatchObject({ label: "Created: Is empty", matchOn: "Is empty" });
  });

  it("offers nothing for a facet the wall carries no values for", () => {
    expect(values(context())).toEqual([]);
  });
});
