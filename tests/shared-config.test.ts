import { describe, expect, it } from "vitest";
import {
  defaultShared,
  extractShared,
  isDefaultShared,
  parseShared,
  serializeShared,
  sharedOf,
  withShared,
} from "../src/core/shared-config";
import { DEFAULT_SETTINGS } from "../src/core/settings";

const fallback = {
  grids: [{ name: "Manga", icon: "archive" }],
  homeGridName: "Clippings",
  homeGridIcon: "archive",
  filterProperties: ["categories", "status"],
};

describe("sharedOf and withShared", () => {
  it("carries the vault's half and nothing else", () => {
    const settings = { ...DEFAULT_SETTINGS, grids: fallback.grids, tileSize: "s" as const };
    const shared = sharedOf(settings);
    expect(shared.grids).toEqual(fallback.grids);
    expect(Object.keys(shared).sort()).toEqual([
      "filterProperties",
      "grids",
      "homeGridIcon",
      "homeGridName",
    ]);
  });

  it("leaves the device's half alone when merging", () => {
    // The whole point of the split: a phone keeps its own density and its own
    // open grid even as the desktop's grids arrive.
    const local = { ...DEFAULT_SETTINGS, tileSize: "s" as const, autoplayVideo: false, activeGrid: "Manga" };
    const merged = withShared(local, fallback);
    expect(merged.grids).toEqual(fallback.grids);
    expect(merged.tileSize).toBe("s");
    expect(merged.autoplayVideo).toBe(false);
    expect(merged.activeGrid).toBe("Manga");
  });
});

describe("parseShared", () => {
  it("reads a well-formed file", () => {
    const raw = {
      grids: [{ name: "Sites", icon: "bookmark" }],
      homeGridName: "Home",
      homeGridIcon: "layout-grid",
      filterProperties: ["categories"],
    };
    expect(parseShared(raw, fallback)).toEqual(raw);
  });

  it("keeps smart grid rules", () => {
    const rules = { kind: ["image"], categories: ["ios"] };
    const parsed = parseShared({ grids: [{ name: "Shots", icon: "image", rules }] }, fallback);
    expect(parsed.grids[0].rules).toEqual(rules);
  });

  it("falls back on anything that is not an object", () => {
    for (const raw of [null, undefined, 7, "grids", []]) {
      expect(parseShared(raw, fallback)).toEqual(fallback);
    }
  });

  it("keeps the fields it can read and falls back per field", () => {
    // A file synced half-written must not cost the grids beside the bad key.
    const parsed = parseShared(
      { grids: [{ name: "Sites", icon: "bookmark" }], homeGridName: 42 },
      fallback
    );
    expect(parsed.grids).toEqual([{ name: "Sites", icon: "bookmark" }]);
    expect(parsed.homeGridName).toBe(fallback.homeGridName);
  });

  it("drops individual grids that are not grids, keeping the rest", () => {
    const parsed = parseShared(
      { grids: [{ name: "Sites", icon: "bookmark" }, null, { icon: "no-name" }, { name: "", icon: "x" }] },
      fallback
    );
    expect(parsed.grids).toEqual([{ name: "Sites", icon: "bookmark" }]);
  });

  it("turns a grid with unusable rules manual rather than losing it", () => {
    const parsed = parseShared({ grids: [{ name: "Odd", icon: "star", rules: "everything" }] }, fallback);
    expect(parsed.grids).toEqual([]);
  });

  it("refuses a filter property list with a non-string in it", () => {
    const parsed = parseShared({ filterProperties: ["categories", 3] }, fallback);
    expect(parsed.filterProperties).toEqual(fallback.filterProperties);
  });

  it("refuses an empty home grid name, which would leave it unnameable", () => {
    expect(parseShared({ homeGridName: "" }, fallback).homeGridName).toBe(fallback.homeGridName);
  });

});

describe("isDefaultShared", () => {
  // Whoever writes the file first wins it: every other device reads that file
  // and adopts it. A phone upgraded before the desktop it was configured on
  // must not publish an empty list and take the desktop's grids with it.
  it("is true for a device holding nothing but the defaults", () => {
    expect(isDefaultShared(defaultShared())).toBe(true);
  });

  it("is false as soon as there is a grid to publish", () => {
    expect(isDefaultShared({ ...defaultShared(), grids: fallback.grids })).toBe(false);
  });

  it("is false for a renamed or re-iconed home grid", () => {
    expect(isDefaultShared({ ...defaultShared(), homeGridName: "Shelf" })).toBe(false);
    expect(isDefaultShared({ ...defaultShared(), homeGridIcon: "star" })).toBe(false);
  });

  it("is false for reordered filter properties, which is a real choice", () => {
    const base = defaultShared();
    expect(
      isDefaultShared({ ...base, filterProperties: [...base.filterProperties].reverse() })
    ).toBe(false);
  });
});

describe("sharedOf copies", () => {
  it("does not hand out the array inside the defaults", () => {
    const shared = sharedOf(DEFAULT_SETTINGS);
    shared.grids.push({ name: "Scratch", icon: "star" });
    expect(DEFAULT_SETTINGS.grids).toHaveLength(0);
  });
});

describe("extractShared", () => {
  const shared = {
    ...fallback,
    grids: [{ name: "Shots", icon: "image", rules: { kind: ["image"] } }],
  };

  it("round-trips through the markdown it is written as", () => {
    const written = serializeShared(shared);
    expect(parseShared(extractShared(written), defaultShared())).toEqual(shared);
  });

  it("writes a note, not a blob, so every sync carries it", () => {
    const written = serializeShared(shared);
    expect(written.startsWith("# Power Grid")).toBe(true);
    expect(written).toContain("```json");
  });

  it("reads the bare JSON of the file this replaced", () => {
    expect(extractShared(JSON.stringify(shared))).toEqual(shared);
  });

  it("ignores prose around the block", () => {
    const written = `# Power Grid\n\nSome note someone added.\n\n\`\`\`json\n${JSON.stringify(shared)}\n\`\`\`\n\nAnd more after it.\n`;
    expect(extractShared(written)).toEqual(shared);
  });

  it("is null for a file with no configuration in it", () => {
    expect(extractShared("# Power Grid\n\nnothing here\n")).toBeNull();
    expect(extractShared("")).toBeNull();
  });

  it("is null for a block that is not valid JSON, rather than throwing", () => {
    expect(extractShared("```json\n{ nope\n```")).toBeNull();
  });
});
