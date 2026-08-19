import { describe, expect, it } from "vitest";
import {
  activeCount,
  emptyFilter,
  facetDefs,
  facetLabel,
  facetsOf,
  isFilterEmpty,
  matchesFilter,
  pruneFilter,
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
      properties: {
        categories: opts.categories ?? [],
        status: [opts.status ?? "unread"],
      },
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

const DEFS = facetDefs(["categories", "status"]);

describe("emptyFilter", () => {
  it("matches everything", () => {
    const empty = emptyFilter();
    expect(tiles.every((t) => matchesFilter(t, empty, DEFS))).toBe(true);
    expect(isFilterEmpty(empty)).toBe(true);
    expect(activeCount(empty)).toBe(0);
  });
});

describe("matchesFilter within a facet", () => {
  it("takes either value, not both", () => {
    const f = toggleFacet(toggleFacet(emptyFilter(), "categories", "design"), "categories", "manga");
    expect(tiles.filter((t) => matchesFilter(t, f, DEFS)).map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("matches a clipping carrying any one of its categories", () => {
    const f = toggleFacet(emptyFilter(), "categories", "ios");
    expect(tiles.filter((t) => matchesFilter(t, f, DEFS)).map((t) => t.id)).toEqual(["a"]);
  });

  it("filters by status", () => {
    const f = toggleFacet(emptyFilter(), "status", "unread");
    expect(tiles.filter((t) => matchesFilter(t, f, DEFS)).map((t) => t.id)).toEqual(["a", "c"]);
  });

  it("filters by media kind", () => {
    const f = toggleFacet(emptyFilter(), "kind", "video");
    expect(tiles.filter((t) => matchesFilter(t, f, DEFS)).map((t) => t.id)).toEqual(["b"]);
  });

  it("filters by source domain, ignoring www", () => {
    const f = toggleFacet(emptyFilter(), "domain", "apple.com");
    expect(tiles.filter((t) => matchesFilter(t, f, DEFS)).map((t) => t.id)).toEqual(["a", "c"]);
  });
});

describe("matchesFilter across facets", () => {
  it("requires every active facet to match", () => {
    const f = toggleFacet(toggleFacet(emptyFilter(), "categories", "design"), "status", "unread");
    // b carries design but is read; a carries both.
    expect(tiles.filter((t) => matchesFilter(t, f, DEFS)).map((t) => t.id)).toEqual(["a"]);
  });

  it("can select down to nothing", () => {
    const f = toggleFacet(toggleFacet(emptyFilter(), "categories", "manga"), "kind", "video");
    expect(tiles.filter((t) => matchesFilter(t, f, DEFS))).toEqual([]);
  });
});

describe("toggleFacet", () => {
  it("adds then removes the same value", () => {
    const on = toggleFacet(emptyFilter(), "categories", "design");
    expect(on.categories).toEqual(["design"]);
    expect(toggleFacet(on, "categories", "design").categories).toBeUndefined();
  });

  it("does not mutate the state it was given", () => {
    const before = emptyFilter();
    toggleFacet(before, "categories", "design");
    expect(before).toEqual({});
  });

  it("counts every selected value across facets", () => {
    let f: FilterState = emptyFilter();
    f = toggleFacet(f, "categories", "design");
    f = toggleFacet(f, "categories", "ios");
    f = toggleFacet(f, "status", "unread");
    expect(activeCount(f)).toBe(3);
    expect(isFilterEmpty(f)).toBe(false);
  });
});

describe("facetsOf", () => {
  const facets = facetsOf(tiles, DEFS);

  it("counts categories, most used first", () => {
    expect(facets.categories.slice(0, 2)).toEqual([
      { value: "design", count: 2 },
      { value: "ios", count: 1 },
    ]);
  });

  it("counts statuses", () => {
    expect(facets.status).toEqual([
      { value: "unread", count: 2 },
      { value: "archived", count: 1 },
      { value: "read", count: 1 },
    ]);
  });

  it("counts media kinds", () => {
    expect(facets.kind).toEqual([
      { value: "image", count: 3 },
      { value: "video", count: 1 },
    ]);
  });

  it("collapses www onto the bare domain and skips sourceless clippings", () => {
    expect(facets.domain).toEqual([
      { value: "apple.com", count: 2 },
      { value: "vimeo.com", count: 1 },
    ]);
  });

  it("offers nothing at all for an empty wall", () => {
    expect(facetsOf([], DEFS)).toEqual({ categories: [], status: [], kind: [], domain: [] });
  });
});

describe("facetDefs", () => {
  it("puts configured properties first, then the derived facets", () => {
    expect(facetDefs(["categories", "status"]).map((d) => d.id)).toEqual([
      "categories",
      "status",
      "kind",
      "domain",
    ]);
  });

  it("gives a property facet the property's own name as its id", () => {
    const def = facetDefs(["medium"]).find((d) => d.id === "medium");
    expect(def).toMatchObject({ source: "property", key: "medium", label: "Medium" });
  });

  it("always offers the derived facets, even with no properties configured", () => {
    expect(facetDefs([]).map((d) => d.id)).toEqual(["kind", "domain"]);
  });
});

describe("facetLabel", () => {
  it("reads a key as a sentence", () => {
    expect(facetLabel("categories")).toBe("Categories");
    expect(facetLabel("publish_date")).toBe("Publish date");
    expect(facetLabel("publish-date")).toBe("Publish date");
  });
});

describe("matchesFilter with property facets", () => {
  it("filters on a property no built-in facet knows about", () => {
    const defs = facetDefs(["medium"]);
    const photo = tile("a");
    photo.record.properties.medium = ["photo"];
    const video = tile("b");
    video.record.properties.medium = ["video"];
    const filter: FilterState = { medium: ["photo"] };

    expect(matchesFilter(photo, filter, defs)).toBe(true);
    expect(matchesFilter(video, filter, defs)).toBe(false);
  });

  it("ignores a chosen value whose facet is no longer configured", () => {
    // Switching a property off in settings must not empty the wall.
    const only = tile("a", { categories: ["design"] });
    expect(matchesFilter(only, { medium: ["photo"] }, DEFS)).toBe(true);
  });
});

describe("pruneFilter", () => {
  it("drops state for facets that are no longer configured", () => {
    const filter: FilterState = { categories: ["design"], medium: ["photo"] };
    expect(pruneFilter(filter, DEFS)).toEqual({ categories: ["design"] });
  });

  it("returns the same object when nothing is stale, so callers can skip work", () => {
    const filter: FilterState = { categories: ["design"] };
    expect(pruneFilter(filter, DEFS)).toBe(filter);
  });
});
