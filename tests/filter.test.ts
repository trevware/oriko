import { describe, expect, it } from "vitest";
import {
  activeCount,
  emptyFilter,
  facetsOf,
  isFilterEmpty,
  matchesFilter,
  toggleFacet,
} from "../src/filter";
import type { FilterState } from "../src/filter";
import type { TileModel } from "../src/tile";

function tile(
  id: string,
  opts: {
    categories?: string[];
    status?: string;
    kind?: "image" | "video";
    source?: string;
  } = {}
): TileModel {
  return {
    id,
    signature: id,
    kind: opts.kind ?? "image",
    filePath: `${id}.jpg`,
    remote: false,
    width: 100,
    height: 100,
    record: {
      path: id,
      title: id,
      source: opts.source ?? "",
      description: "",
      categories: opts.categories ?? [],
      status: opts.status ?? "unread",
      created: "",
      cover: "",
      grid: "",
      media: [],
      haystack: "",
    },
    posterPath: "",
    animated: false,
    provisional: false,
  };
}

const tiles = [
  tile("a", { categories: ["design", "ios"], status: "unread", source: "https://www.apple.com/x" }),
  tile("b", { categories: ["design"], status: "read", kind: "video", source: "https://vimeo.com/1" }),
  tile("c", { categories: ["manga"], status: "unread", source: "https://apple.com/y" }),
  tile("d", { categories: [], status: "archived" }),
];

describe("emptyFilter", () => {
  it("matches everything", () => {
    const empty = emptyFilter();
    expect(tiles.every((t) => matchesFilter(t, empty))).toBe(true);
    expect(isFilterEmpty(empty)).toBe(true);
    expect(activeCount(empty)).toBe(0);
  });
});

describe("matchesFilter within a facet", () => {
  it("takes either value, not both", () => {
    const f = toggleFacet(toggleFacet(emptyFilter(), "categories", "design"), "categories", "manga");
    expect(tiles.filter((t) => matchesFilter(t, f)).map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("matches a clipping carrying any one of its categories", () => {
    const f = toggleFacet(emptyFilter(), "categories", "ios");
    expect(tiles.filter((t) => matchesFilter(t, f)).map((t) => t.id)).toEqual(["a"]);
  });

  it("filters by status", () => {
    const f = toggleFacet(emptyFilter(), "statuses", "unread");
    expect(tiles.filter((t) => matchesFilter(t, f)).map((t) => t.id)).toEqual(["a", "c"]);
  });

  it("filters by media kind", () => {
    const f = toggleFacet(emptyFilter(), "kinds", "video");
    expect(tiles.filter((t) => matchesFilter(t, f)).map((t) => t.id)).toEqual(["b"]);
  });

  it("filters by source domain, ignoring www", () => {
    const f = toggleFacet(emptyFilter(), "domains", "apple.com");
    expect(tiles.filter((t) => matchesFilter(t, f)).map((t) => t.id)).toEqual(["a", "c"]);
  });
});

describe("matchesFilter across facets", () => {
  it("requires every active facet to match", () => {
    const f = toggleFacet(toggleFacet(emptyFilter(), "categories", "design"), "statuses", "unread");
    // b carries design but is read; a carries both.
    expect(tiles.filter((t) => matchesFilter(t, f)).map((t) => t.id)).toEqual(["a"]);
  });

  it("can select down to nothing", () => {
    const f = toggleFacet(toggleFacet(emptyFilter(), "categories", "manga"), "kinds", "video");
    expect(tiles.filter((t) => matchesFilter(t, f))).toEqual([]);
  });
});

describe("toggleFacet", () => {
  it("adds then removes the same value", () => {
    const on = toggleFacet(emptyFilter(), "categories", "design");
    expect(on.categories).toEqual(["design"]);
    expect(toggleFacet(on, "categories", "design").categories).toEqual([]);
  });

  it("does not mutate the state it was given", () => {
    const before = emptyFilter();
    toggleFacet(before, "categories", "design");
    expect(before.categories).toEqual([]);
  });

  it("counts every selected value across facets", () => {
    let f: FilterState = emptyFilter();
    f = toggleFacet(f, "categories", "design");
    f = toggleFacet(f, "categories", "ios");
    f = toggleFacet(f, "statuses", "unread");
    expect(activeCount(f)).toBe(3);
    expect(isFilterEmpty(f)).toBe(false);
  });
});

describe("facetsOf", () => {
  const facets = facetsOf(tiles);

  it("counts categories, most used first", () => {
    expect(facets.categories.slice(0, 2)).toEqual([
      { value: "design", count: 2 },
      { value: "ios", count: 1 },
    ]);
  });

  it("counts statuses", () => {
    expect(facets.statuses).toEqual([
      { value: "unread", count: 2 },
      { value: "archived", count: 1 },
      { value: "read", count: 1 },
    ]);
  });

  it("counts media kinds", () => {
    expect(facets.kinds).toEqual([
      { value: "image", count: 3 },
      { value: "video", count: 1 },
    ]);
  });

  it("collapses www onto the bare domain and skips sourceless clippings", () => {
    expect(facets.domains).toEqual([
      { value: "apple.com", count: 2 },
      { value: "vimeo.com", count: 1 },
    ]);
  });

  it("offers nothing at all for an empty wall", () => {
    expect(facetsOf([])).toEqual({ categories: [], statuses: [], kinds: [], domains: [] });
  });
});
