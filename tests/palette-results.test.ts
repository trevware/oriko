import { describe, expect, it } from "vitest";
import { resumeIndex, searchPalette } from "../src/core/palette-results";
import type { PaletteCommand } from "../src/core/commands";
import type { ClippingRecord } from "../src/core/scan";

const command = (id: string, label: string, section: PaletteCommand["section"]): PaletteCommand => ({
  id,
  label,
  icon: "star",
  section,
});

const commands: PaletteCommand[] = [
  command("selection:delete", "Delete", "Actions"),
  command("grid:switch:Demo", "Demo", "Grids"),
  command("capture:link", "Clip link from clipboard", "Capture"),
];

function clipping(title: string, grid = "", extra = ""): ClippingRecord {
  return {
    path: `Clippings/${title}.md`,
    title,
    source: "",
    description: extra,
    categories: [],
    status: "unread",
    created: "2026-08-17",
    cover: "",
    grid,
    media: [],
    haystack: `${title} ${extra}`.toLowerCase(),
    properties: {},
  };
}

const clippings = [
  clipping("manga-downloader", "", "download comics"),
  clipping("Nook - Write mode", "Demo"),
  clipping("Rachel How"),
];

const value = (id: string, label: string, matchOn: string): PaletteCommand => ({
  id,
  label,
  matchOn,
  icon: "tag",
  section: "Filters",
  keepOpen: true,
});

const values: PaletteCommand[] = [
  value("filter:categories:ios", "Categories: ios", "ios"),
  value("filter:categories:design", "Categories: design", "design"),
  value("filter:domain:youtube.com", "Source: youtube.com", "youtube.com"),
];

const options = {
  limit: 8,
  activeGrid: "Clippings",
  homeGrid: "Clippings",
  registered: new Set(["Demo"]),
};

const sections = (query: string): string[] =>
  searchPalette(query, commands, values, clippings, options).map((group) => group.section);

const rowsOf = (query: string, section: string) =>
  searchPalette(query, commands, values, clippings, options).find((g) => g.section === section)?.rows ?? [];

describe("searchPalette", () => {
  it("opens on the commands, in section order, with clippings last", () => {
    expect(sections("")).toEqual(["Actions", "Grids", "Capture", "Clippings"]);
  });

  it("leads with the section holding the best match", () => {
    expect(sections("manga")[0]).toBe("Clippings");
    expect(sections("delete")[0]).toBe("Actions");
  });

  it("drops sections nothing in them matches", () => {
    expect(sections("manga")).toEqual(["Clippings"]);
  });

  it("finds a clipping by text it does not display", () => {
    expect(rowsOf("comics", "Clippings").map((row) => row.label)).toEqual(["manga-downloader"]);
  });

  it("carries the ranges that highlight the match", () => {
    expect(rowsOf("manga", "Clippings")[0].ranges).toEqual([{ start: 0, end: 5 }]);
  });

  it("labels a clipping that lives in another grid", () => {
    expect(rowsOf("nook", "Clippings")[0].detail).toBe("Demo");
  });

  it("says nothing about the grid you are already in", () => {
    expect(rowsOf("rachel", "Clippings")[0].detail).toBeUndefined();
  });

  it("caps the clippings so the commands stay in view", () => {
    const many = Array.from({ length: 30 }, (_, i) => clipping(`clip ${i}`));
    const groups = searchPalette("", commands, values, many, options);
    expect(groups.find((g) => g.section === "Clippings")?.rows).toHaveLength(8);
  });

  it("caps after ranking, so the best matches are the ones kept", () => {
    const many = [
      ...Array.from({ length: 30 }, (_, i) => clipping(`clip ${i}`)),
      clipping("manga-downloader"),
    ];
    const groups = searchPalette("manga", commands, values, many, { ...options, limit: 2 });
    expect(groups[0].rows[0].label).toBe("manga-downloader");
  });

  it("holds the values back until something has been typed", () => {
    expect(rowsOf("", "Filters")).toEqual([]);
  });

  it("holds them back for one character, which names far too much", () => {
    expect(rowsOf("i", "Filters")).toEqual([]);
  });

  it("offers a value once two characters name it", () => {
    expect(rowsOf("io", "Filters").map((row) => row.label)).toContain("Categories: ios");
  });

  it("leads with the filter when what was typed is a value", () => {
    expect(sections("ios")[0]).toBe("Filters");
  });

  it("does not offer every value when the facet itself is named", () => {
    expect(rowsOf("categories", "Filters")).toEqual([]);
  });

  it("highlights the value, not the facet name that prefixes it", () => {
    expect(rowsOf("ios", "Filters")[0].ranges).toEqual([{ start: 12, end: 15 }]);
  });

  it("caps the values so the clippings stay in view", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      value(`filter:categories:v${i}`, `Categories: value ${i}`, `value ${i}`)
    );
    const groups = searchPalette("value", commands, many, clippings, options);
    expect(groups.find((g) => g.section === "Filters")?.rows).toHaveLength(8);
  });

  it("returns nothing at all when nothing matches", () => {
    expect(searchPalette("zzzz", commands, values, clippings, options)).toEqual([]);
  });
});

describe("resumeIndex", () => {
  const keys = ["a", "b", "c", "d"];

  it("returns to the row it was left on", () => {
    expect(resumeIndex(keys, "c", 0)).toBe(2);
  });

  it("follows the row when the list has shifted under it", () => {
    // A stage can tick a facet or change a count, and rows are ordered by
    // what they hold, so the index it was at may now be someone else.
    expect(resumeIndex(["d", "c", "b", "a"], "c", 2)).toBe(1);
  });

  it("falls back to the index when the row has gone", () => {
    expect(resumeIndex(keys, "gone", 2)).toBe(2);
  });

  it("clamps a fallback index that no longer fits", () => {
    expect(resumeIndex(["a", "b"], "gone", 9)).toBe(1);
  });

  it("has nowhere to go in an empty list", () => {
    expect(resumeIndex([], "a", 3)).toBe(0);
  });

  it("treats an unremembered key as no key at all", () => {
    expect(resumeIndex(keys, "", 1)).toBe(1);
  });
});
