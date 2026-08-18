import { describe, expect, it } from "vitest";
import {
  effectiveGrid,
  filterByGrid,
  hotkeyPosition,
  membersOf,
  orderedGrids,
  validateGridName,
} from "../src/spaces";
import type { ClippingRecord } from "../src/scan";

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
    media: [],
    haystack: "",
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
