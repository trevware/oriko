import { describe, expect, it } from "vitest";
import { buildCommands } from "../src/commands";
import type { PaletteContext } from "../src/commands";
import { emptyFilter } from "../src/filter";

const noop = (): void => {};

const actions = {
  openNote: noop,
  exportSelection: noop,
  reveal: noop,
  move: noop,
  remove: noop,
  switchGrid: noop,
  newGrid: noop,
  editGrid: noop,
  deleteGrid: noop,
  manageGrids: noop,
  toggleFacet: noop,
  clearFilters: noop,
  clipLink: noop,
  clipImage: noop,
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
    facets: { categories: [], statuses: [], kinds: [], domains: [] },
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
        statuses: [],
        kinds: [],
        domains: [],
      },
    });
    const list = ids(ctx);
    expect(list).toContain("filter:categories");
    expect(list).not.toContain("filter:statuses");
  });

  it("lists a facet's values with their counts, and keeps the palette open", () => {
    const ctx = context({
      facets: {
        categories: [
          { value: "design", count: 2 },
          { value: "ios", count: 1 },
        ],
        statuses: [],
        kinds: [],
        domains: [],
      },
    });
    const values = find(ctx, "filter:categories")?.stage?.items() ?? [];
    expect(values.map((v) => [v.label, v.detail])).toEqual([
      ["design", "2"],
      ["ios", "1"],
    ]);
    expect(values.every((v) => v.keepOpen)).toBe(true);
  });

  it("ticks the facet values that are already filtering the wall", () => {
    const ctx = context({
      facets: {
        categories: [
          { value: "design", count: 2 },
          { value: "ios", count: 1 },
        ],
        statuses: [],
        kinds: [],
        domains: [],
      },
      filter: { ...emptyFilter(), categories: ["ios"] },
    });
    const values = find(ctx, "filter:categories")?.stage?.items() ?? [];
    expect(values.map((v) => v.icon)).toEqual(["", "check"]);
  });

  it("offers to clear filters only while something is filtered", () => {
    expect(ids(context())).not.toContain("filter:clear");
    expect(
      ids(context({ filter: { ...emptyFilter(), categories: ["design"] } }))
    ).toContain("filter:clear");
  });

  it("always offers the capture commands", () => {
    const list = ids(context());
    expect(list).toContain("capture:link");
    expect(list).toContain("capture:image");
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
