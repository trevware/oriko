import { describe, expect, it } from "vitest";
import {
  EMPTY_VALUE,
  activeCount,
  smartMembers,
  emptyFilter,
  facetDefs,
  facetLabel,
  facetsOf,
  isEmptyValue,
  isFilterEmpty,
  matchesFilter,
  propertyVocabulary,
  pruneFilter,
  toggleFacet,
  typedFacets,
  valueLabel,
} from "../src/core/filter";
import type { FilterState } from "../src/core/filter";
import type { TileModel } from "../src/core/tile";

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
      folder: "",
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

// A Wednesday, built locally: the windows are measured from local midnight,
// so a UTC clock would move the weekday and make these pass by timezone.
const NOW = new Date(2026, 7, 19, 12, 0, 0).getTime();
const daysAgo = (n: number): string => {
  const d = new Date(NOW - n * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function dated(id: string, created: string): TileModel {
  const t = tile(id);
  t.record.properties.created = [created];
  return t;
}

describe("typedFacets", () => {
  it("marks a property holding dates as a date facet", () => {
    const tiles = [dated("a", daysAgo(1)), dated("b", daysAgo(40))];
    const defs = typedFacets(facetDefs(["created"]), tiles, NOW);
    expect(defs.find((d) => d.id === "created")).toMatchObject({ shape: "date", now: NOW });
  });

  it("leaves a property holding words alone", () => {
    const tiles = [tile("a", { categories: ["design"] })];
    const defs = typedFacets(facetDefs(["categories"]), tiles, NOW);
    expect(defs.find((d) => d.id === "categories")?.shape).toBe("text");
  });

  it("never types the derived facets as dates", () => {
    const defs = typedFacets(facetDefs([]), [dated("a", daysAgo(1))], NOW);
    expect(defs.every((d) => d.shape !== "date")).toBe(true);
  });
});

describe("date facets", () => {
  const tiles = [
    dated("recent", daysAgo(2)),
    dated("month", daysAgo(45)),
    dated("ancient", daysAgo(500)),
  ];
  const defs = typedFacets(facetDefs(["created"]), tiles, NOW);

  it("offers windows newest first, not the raw dates and not by count", () => {
    // Monday is two days back from this Wednesday, so the newest clipping is
    // inside the calendar week as well as the rolling seven days.
    expect(facetsOf(tiles, defs).created.map((v) => v.value)).toEqual([
      "This week",
      "Last 7 days",
      "Last 30 days",
      "Last 90 days",
      "Last year",
      "Older",
    ]);
  });

  it("reports absence as a value of its own, so it can be offered and counted", () => {
    const withNone = [...tiles, tile("none")];
    const counts = Object.fromEntries(
      facetsOf(withNone, defs).created.map((v) => [v.value, v.count])
    );
    expect(counts["empty"]).toBe(1);
  });

  it("offers no row for the opposite, which would name nearly the whole wall", () => {
    const labels = facetsOf(tiles, defs).created.map((v) => v.value);
    expect(labels).not.toContain("present");
  });

  it("narrows to the clippings a comparison covers", () => {
    const f = toggleFacet(emptyFilter(), "created", `before:${daysAgo(100)}`);
    expect(tiles.filter((t) => matchesFilter(t, f, defs)).map((t) => t.id)).toEqual([
      "ancient",
    ]);
  });

  it("takes on or after as inclusive of the day named", () => {
    const f = toggleFacet(emptyFilter(), "created", `since:${daysAgo(45)}`);
    expect(tiles.filter((t) => matchesFilter(t, f, defs)).map((t) => t.id)).toEqual([
      "recent",
      "month",
    ]);
  });

  it("offers the built-in windows, narrowest first", () => {
    const defs = typedFacets(facetDefs(["created"]), tiles, NOW);
    const labels = facetsOf(tiles, defs).created.map((v) => v.value);
    expect(labels.slice(0, 4)).toEqual([
      "This week",
      "Last 7 days",
      "Last 30 days",
      "Last 90 days",
    ]);
  });

  it("counts cumulatively, because the buckets nest", () => {
    const counts = Object.fromEntries(
      facetsOf(tiles, defs).created.map((v) => [v.value, v.count])
    );
    expect(counts["Last 7 days"]).toBe(1);
    expect(counts["Last 90 days"]).toBe(2);
    expect(counts["Older"]).toBe(1);
  });

  it("narrows to the clippings inside a chosen bucket", () => {
    const f = toggleFacet(emptyFilter(), "created", "Last 90 days");
    expect(tiles.filter((t) => matchesFilter(t, f, defs)).map((t) => t.id)).toEqual([
      "recent",
      "month",
    ]);
  });

  it("widens when two nested buckets are picked, rather than narrowing to nothing", () => {
    let f = toggleFacet(emptyFilter(), "created", "Last 7 days");
    f = toggleFacet(f, "created", "Older");
    expect(tiles.filter((t) => matchesFilter(t, f, defs)).map((t) => t.id)).toEqual([
      "recent",
      "ancient",
    ]);
  });

  it("still narrows across facets", () => {
    const withCategory = typedFacets(facetDefs(["categories", "created"]), tiles, NOW);
    tiles[0].record.properties.categories = ["design"];
    let f = toggleFacet(emptyFilter(), "created", "Last year");
    f = toggleFacet(f, "categories", "design");
    expect(tiles.filter((t) => matchesFilter(t, f, withCategory)).map((t) => t.id)).toEqual([
      "recent",
    ]);
    tiles[0].record.properties.categories = [];
  });
});

describe("propertyVocabulary", () => {
  function holding(id: string, key: string, values: string[]): TileModel {
    const t = tile(id);
    t.record.properties[key] = values;
    return t;
  }

  it("lists the raw values, most used first", () => {
    const tiles = [
      holding("a", "medium", ["photo", "video"]),
      holding("b", "medium", ["photo"]),
    ];
    expect(propertyVocabulary(tiles, "medium").values).toEqual([
      { value: "photo", count: 2 },
      { value: "video", count: 1 },
    ]);
  });

  it("reads as a set when any clipping holds more than one", () => {
    const tiles = [holding("a", "medium", ["photo", "video"])];
    expect(propertyVocabulary(tiles, "medium").single).toBe(false);
  });

  it("reads as a choice when no clipping holds more than one", () => {
    const tiles = [holding("a", "status", ["unread"]), holding("b", "status", ["read"])];
    expect(propertyVocabulary(tiles, "status").single).toBe(true);
  });

  it("gives raw dates, not the buckets a date facet would offer", () => {
    // Editing sets a value, so the vocabulary has to be values you could
    // actually write, not the groups they happen to fall into.
    const tiles = [holding("a", "reviewed", ["2026-08-19"])];
    expect(propertyVocabulary(tiles, "reviewed").values).toEqual([
      { value: "2026-08-19", count: 1 },
    ]);
  });

  it("offers nothing for a key no clipping carries", () => {
    expect(propertyVocabulary([tile("a")], "nothing")).toEqual({ values: [], single: true });
  });
});

describe("smartMembers", () => {
  it("admits the tiles the rules name", () => {
    expect(smartMembers(tiles, { categories: ["design"] }, DEFS).map((t) => t.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("narrows across facets, as the filter does", () => {
    const held = smartMembers(tiles, { categories: ["design"], status: ["unread"] }, DEFS);
    expect(held.map((t) => t.id)).toEqual(["a"]);
  });

  it("admits everything when the rules are empty, leaving the wall to the filter", () => {
    expect(smartMembers(tiles, {}, DEFS)).toHaveLength(tiles.length);
  });

  it("stacks: an ad-hoc filter narrows the members rather than replacing them", () => {
    // The point of running the same matcher twice. The filter sees only what
    // the rules admitted, so design+read cannot bring back a manga clipping.
    const members = smartMembers(tiles, { categories: ["design"] }, DEFS);
    const shown = members.filter((t) => matchesFilter(t, { status: ["read"] }, DEFS));
    expect(shown.map((t) => t.id)).toEqual(["b"]);
  });
});

describe("is empty on a property facet", () => {
  const categories = DEFS.find((def) => def.id === "categories")!;

  it("matches a tile that holds no value for the key", () => {
    const filter = { categories: [EMPTY_VALUE] };
    expect(matchesFilter(tiles[3], filter, DEFS)).toBe(true);
    expect(matchesFilter(tiles[0], filter, DEFS)).toBe(false);
  });

  it("is counted alongside the values, and listed after them", () => {
    const values = facetsOf(tiles, DEFS).categories;
    expect(values[values.length - 1]).toEqual({ value: EMPTY_VALUE, count: 1 });
  });

  it("is not offered when every tile holds a value", () => {
    const values = facetsOf(tiles.slice(0, 3), DEFS).categories;
    expect(values.some((entry) => entry.value === EMPTY_VALUE)).toBe(false);
  });

  it("reads as Is empty, on a date facet too, and leaves real values alone", () => {
    expect(valueLabel(categories, EMPTY_VALUE)).toBe("Is empty");
    expect(valueLabel(categories, "design")).toBe("design");
    const published = { ...facetDefs(["published"])[0], shape: "date" as const, now: 0 };
    expect(valueLabel(published, "empty")).toBe("Is empty");
    expect(valueLabel(published, "before:2026-01-01")).toBe("Before 2026-01-01");
  });

  it("does not leak into the editing vocabulary", () => {
    const { values } = propertyVocabulary(tiles, "categories");
    expect(values.some((entry) => entry.value === EMPTY_VALUE)).toBe(false);
  });
});

describe("isEmptyValue", () => {
  it("knows each shape's spelling of empty, and nothing else", () => {
    const [categories] = facetDefs(["categories"]);
    const published = { ...facetDefs(["published"])[0], shape: "date" as const, now: 0 };
    expect(isEmptyValue(categories, EMPTY_VALUE)).toBe(true);
    expect(isEmptyValue(categories, "empty")).toBe(false);
    expect(isEmptyValue(published, "empty")).toBe(true);
    expect(isEmptyValue(published, EMPTY_VALUE)).toBe(false);
  });
});
