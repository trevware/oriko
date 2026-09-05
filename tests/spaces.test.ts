import { describe, expect, it } from "vitest";
import {
  assignableValue,
  effectiveGrid,
  groupedGrids,
  isSmartGrid,
  filterByGrid,
  hotkeyPosition,
  membersOf,
  reorderTarget,
  orderedGrids,
  validateGridName,
} from "../src/core/spaces";
import type { ClippingRecord } from "../src/core/scan";
import type { GridSpace } from "../src/core/spaces";
import { facetDefs, typedFacets } from "../src/core/filter";
import type { FilterState } from "../src/core/filter";

const HOME = { name: "Clippings", icon: "layout-grid" };
const GRIDS = [
  { name: "Playground", icon: "star" },
  { name: "Demo", icon: "heart" },
];

function record(path: string, grid = ""): ClippingRecord {
  return {
    path,
    title: path,
    source: "",
    description: "",
    categories: [],
    status: "unread",
    created: "",
    cover: "",
    grid,
    folder: "",
    media: [],
    haystack: "",
    properties: {},
  };
}

const registered = new Set(GRIDS.map((g) => g.name));

describe("effectiveGrid", () => {
  it("sends a clipping with no key home", () => {
    expect(effectiveGrid(record("a"), HOME.name, registered)).toBe("Clippings");
  });

  it("honours a key naming a registered grid", () => {
    expect(effectiveGrid(record("a", "Demo"), HOME.name, registered)).toBe("Demo");
  });

  it("sends an unknown grid home rather than stranding it", () => {
    expect(effectiveGrid(record("a", "Deleted"), HOME.name, registered)).toBe("Clippings");
  });

  it("honours a key naming home itself", () => {
    expect(effectiveGrid(record("a", "Clippings"), HOME.name, registered)).toBe("Clippings");
  });

  it("ignores surrounding whitespace in the key", () => {
    expect(effectiveGrid(record("a", "  Demo  "), HOME.name, registered)).toBe("Demo");
  });
});

describe("filterByGrid", () => {
  const records = [
    record("home-implicit"),
    record("home-explicit", "Clippings"),
    record("demo", "Demo"),
    record("orphan", "Deleted"),
  ];

  it("collects the unkeyed and the orphaned at home", () => {
    expect(filterByGrid(records, "Clippings", HOME.name, registered).map((r) => r.path)).toEqual([
      "home-implicit",
      "home-explicit",
      "orphan",
    ]);
  });

  it("collects only its own members for a named grid", () => {
    expect(filterByGrid(records, "Demo", HOME.name, registered).map((r) => r.path)).toEqual([
      "demo",
    ]);
  });

  it("returns nothing for an empty grid", () => {
    expect(filterByGrid(records, "Playground", HOME.name, registered)).toEqual([]);
  });

  it("preserves the incoming order", () => {
    const many = [record("c", "Demo"), record("a", "Demo"), record("b", "Demo")];
    expect(filterByGrid(many, "Demo", HOME.name, registered).map((r) => r.path)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });
});

describe("orderedGrids", () => {
  it("puts home first, then the registry in order", () => {
    expect(orderedGrids(HOME, GRIDS).map((g) => g.name)).toEqual([
      "Clippings",
      "Playground",
      "Demo",
    ]);
  });

  it("is just home when nothing has been created", () => {
    expect(orderedGrids(HOME, []).map((g) => g.name)).toEqual(["Clippings"]);
  });
});

describe("hotkeyPosition", () => {
  it("maps 1 to the first grid, which is home", () => {
    expect(hotkeyPosition("1")).toBe(0);
  });

  it("maps 9 to the ninth", () => {
    expect(hotkeyPosition("9")).toBe(8);
  });

  it("rejects 0, which is the zoom reset", () => {
    expect(hotkeyPosition("0")).toBeNull();
  });

  it("rejects anything that is not a digit", () => {
    expect(hotkeyPosition("a")).toBeNull();
    expect(hotkeyPosition("")).toBeNull();
  });
});

describe("validateGridName", () => {
  const existing = ["Playground", "Demo"];

  it("accepts a fresh name", () => {
    expect(validateGridName("Archive", existing, HOME.name)).toBeNull();
  });

  it("rejects an empty name", () => {
    expect(validateGridName("   ", existing, HOME.name)).toMatch(/name/i);
  });

  it("rejects a duplicate", () => {
    expect(validateGridName("Demo", existing, HOME.name)).toMatch(/already/i);
  });

  it("rejects a duplicate differing only in case", () => {
    expect(validateGridName("demo", existing, HOME.name)).toMatch(/already/i);
  });

  it("rejects a collision with the home grid", () => {
    expect(validateGridName("clippings", existing, HOME.name)).toMatch(/already/i);
  });

  it("allows renaming a grid to itself, so an icon edit can be saved", () => {
    expect(validateGridName("Demo", existing, HOME.name, "Demo")).toBeNull();
  });
});

describe("membersOf", () => {
  const records = [
    record("a", "Demo"),
    record("b"),
    record("c", "Demo"),
    record("d", "Playground"),
  ];

  it("counts only notes carrying the name explicitly", () => {
    expect(membersOf(records, "Demo").map((r) => r.path)).toEqual(["a", "c"]);
  });

  it("does not count the unkeyed as members of home", () => {
    // They belong to home, but renaming home must not rewrite what has no key.
    expect(membersOf(records, "Clippings")).toEqual([]);
  });
});

describe("reorderTarget", () => {
  it("maps a list row onto the registry entry behind it", () => {
    // Row 0 is home, so row 1 is the first stored grid.
    expect(reorderTarget(2, 1, 4)).toEqual({ from: 1, to: 2 });
    expect(reorderTarget(2, -1, 4)).toEqual({ from: 1, to: 0 });
  });

  it("refuses to move home, which has no position to change", () => {
    expect(reorderTarget(0, 1, 4)).toBeNull();
    expect(reorderTarget(0, -1, 4)).toBeNull();
  });

  it("refuses to move a grid above home", () => {
    expect(reorderTarget(1, -1, 4)).toBeNull();
  });

  it("refuses to move the last grid past the end", () => {
    expect(reorderTarget(4, 1, 4)).toBeNull();
  });

  it("refuses a row that is not a grid at all", () => {
    expect(reorderTarget(9, -1, 4)).toBeNull();
  });

  it("has nothing to move in an empty registry", () => {
    expect(reorderTarget(1, 1, 0)).toBeNull();
    expect(reorderTarget(0, 1, 0)).toBeNull();
  });
});

describe("isSmartGrid", () => {
  it("is a smart grid once it carries rules", () => {
    expect(isSmartGrid({ name: "Unread", icon: "star", rules: { status: ["unread"] } })).toBe(true);
  });

  it("is a manual grid with no rules at all", () => {
    expect(isSmartGrid({ name: "Manga", icon: "archive" })).toBe(false);
  });

  it("treats an empty rule set as manual, since it would name the whole wall", () => {
    const space: GridSpace = { name: "Empty", icon: "star", rules: {} };
    expect(isSmartGrid(space)).toBe(false);
  });
});

describe("assignableValue", () => {
  const defs = facetDefs(["categories", "created"]);
  const smart = (rules: FilterState): GridSpace => ({ name: "G", icon: "star", rules });

  it("names the one write that would make a clipping match", () => {
    expect(assignableValue(smart({ categories: ["design"] }), defs)).toEqual({
      key: "categories",
      value: "design",
    });
  });

  it("refuses an is-empty rule, which is the absence of a value rather than one to write", () => {
    expect(assignableValue(smart({ categories: [""] }), defs)).toBeNull();
  });

  it("refuses a manual grid, which is moved into rather than matched", () => {
    expect(assignableValue({ name: "Manga", icon: "archive" }, defs)).toBeNull();
  });

  it("refuses more than one facet, there being no single write", () => {
    expect(assignableValue(smart({ categories: ["design"], status: ["unread"] }), defs)).toBeNull();
  });

  it("refuses more than one value, for the same reason", () => {
    expect(assignableValue(smart({ categories: ["design", "ios"] }), defs)).toBeNull();
  });

  it("refuses a derived facet, which no note can carry", () => {
    expect(assignableValue(smart({ domain: ["youtube.com"] }), defs)).toBeNull();
    expect(assignableValue(smart({ kind: ["video"] }), defs)).toBeNull();
  });

  it("refuses a date facet, whose values are buckets rather than literals", () => {
    const dated = typedFacets(defs, [], 0).map((d) =>
      d.id === "created" ? { ...d, shape: "date" as const } : d
    );
    expect(assignableValue(smart({ created: ["empty"] }), dated)).toBeNull();
  });

  it("refuses a facet no longer on offer, whose shape cannot be read", () => {
    expect(assignableValue(smart({ medium: ["photo"] }), defs)).toBeNull();
  });
});

describe("groupedGrids", () => {
  const smart = (name: string): GridSpace => ({
    name,
    icon: "star",
    rules: { status: ["unread"] },
  });
  const manual = (name: string): GridSpace => ({ name, icon: "star" });

  it("puts the manual grids first and the smart grids after", () => {
    const grouped = groupedGrids([manual("Home"), smart("Unread"), manual("Manga")]);
    expect(grouped.manual.map((p) => p.grid.name)).toEqual(["Home", "Manga"]);
    expect(grouped.smart.map((p) => p.grid.name)).toEqual(["Unread"]);
  });

  it("remembers where each really sits, which is what the hotkey follows", () => {
    // Manga is shown second but is third in the switcher order, so its hint
    // has to read the position rather than the place in the grouped list.
    const grouped = groupedGrids([manual("Home"), smart("Unread"), manual("Manga")]);
    expect(grouped.manual.map((p) => p.position)).toEqual([0, 2]);
    expect(grouped.smart.map((p) => p.position)).toEqual([1]);
  });

  it("keeps the stored order inside each group", () => {
    const grouped = groupedGrids([smart("B"), smart("A")]);
    expect(grouped.smart.map((p) => p.grid.name)).toEqual(["B", "A"]);
  });

  it("has no smart group at all when nothing computes its membership", () => {
    expect(groupedGrids([manual("Home"), manual("Manga")]).smart).toEqual([]);
  });
});
