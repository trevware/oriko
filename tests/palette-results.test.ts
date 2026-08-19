import { describe, expect, it } from "vitest";
import { searchPalette } from "../src/palette-results";
import type { PaletteCommand } from "../src/commands";
import type { ClippingRecord } from "../src/scan";

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

const options = {
  limit: 8,
  activeGrid: "Clippings",
  homeGrid: "Clippings",
  registered: new Set(["Demo"]),
};

const sections = (query: string): string[] =>
  searchPalette(query, commands, clippings, options).map((group) => group.section);

const rowsOf = (query: string, section: string) =>
  searchPalette(query, commands, clippings, options).find((g) => g.section === section)?.rows ?? [];

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
    const groups = searchPalette("", commands, many, options);
    expect(groups.find((g) => g.section === "Clippings")?.rows).toHaveLength(8);
  });

  it("caps after ranking, so the best matches are the ones kept", () => {
    const many = [
      ...Array.from({ length: 30 }, (_, i) => clipping(`clip ${i}`)),
      clipping("manga-downloader"),
    ];
    const groups = searchPalette("manga", commands, many, { ...options, limit: 2 });
    expect(groups[0].rows[0].label).toBe("manga-downloader");
  });

  it("returns nothing at all when nothing matches", () => {
    expect(searchPalette("zzzz", commands, clippings, options)).toEqual([]);
  });
});
