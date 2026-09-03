import { describe, expect, it } from "vitest";
import { fileableGrid, sharedClipGrid } from "../src/core/spaces";
import type { GridSpace } from "../src/core/spaces";

const HOME = "Clippings";
const GRIDS: GridSpace[] = [
  { name: "Playground", icon: "star" },
  { name: "Unread", icon: "eye", rules: { status: ["unread"] } },
];

describe("fileableGrid", () => {
  it("names a manual grid as itself", () => {
    expect(fileableGrid("Playground", HOME, GRIDS)).toBe("Playground");
  });

  it("is empty for home, which is what an absent grid key means", () => {
    expect(fileableGrid(HOME, HOME, GRIDS)).toBe("");
  });

  it("is empty for a smart grid, which nothing is filed into", () => {
    expect(fileableGrid("Unread", HOME, GRIDS)).toBe("");
  });

  it("is empty for a grid that no longer exists", () => {
    expect(fileableGrid("Deleted", HOME, GRIDS)).toBe("");
  });
});

describe("sharedClipGrid", () => {
  it("follows the open grid when set to last-opened", () => {
    expect(sharedClipGrid("last-opened", "Playground", HOME, GRIDS)).toBe("Playground");
  });

  it("ignores the open grid when set to home", () => {
    expect(sharedClipGrid("home", "Playground", HOME, GRIDS)).toBe("");
  });

  it("is null when the user is to be asked", () => {
    expect(sharedClipGrid("ask", "Playground", HOME, GRIDS)).toBeNull();
  });
});
