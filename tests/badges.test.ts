import { describe, expect, it } from "vitest";
import { tileBadges } from "../src/core/badges";
import type { ClippingRecord } from "../src/core/scan";

const NOW = new Date(2026, 8, 3, 12, 0, 0).getTime();

function record(over: Partial<ClippingRecord> = {}): ClippingRecord {
  return {
    path: "Clippings/A.md",
    title: "A page",
    source: "https://www.example.com/post/1",
    description: "",
    categories: ["tools", "cli"],
    status: "unread",
    created: "2026-09-01",
    cover: "",
    grid: "",
    folder: "",
    media: [],
    haystack: "",
    properties: {
      title: ["A page"],
      source: ["https://www.example.com/post/1"],
      categories: ["tools", "cli"],
      status: ["unread"],
      created: ["2026-09-01"],
      author: ["Someone"],
    },
    ...over,
  };
}

describe("tileBadges", () => {
  it("puts the date in the top-right as a relative time and the tags in one bottom-left pill", () => {
    expect(tileBadges(record(), { date: "created", property: "categories" }, NOW)).toEqual([
      { corner: "top-right", text: "2d ago" },
      { corner: "bottom-left", text: "tools \u00b7 cli" },
    ]);
  });

  it("shows only the first value of the date property", () => {
    const r = record({ properties: { ...record().properties, created: ["2026-09-01", "2026-08-01"] } });
    expect(tileBadges(r, { date: "created", property: "" }, NOW)).toEqual([
      { corner: "top-right", text: "2d ago" },
    ]);
  });

  it("skips a date property whose value is not a date", () => {
    const r = record({ properties: { ...record().properties, created: ["soon"] } });
    expect(tileBadges(r, { date: "created", property: "" }, NOW)).toEqual([]);
  });

  it("renders source as its domain", () => {
    expect(tileBadges(record(), { date: "", property: "source" }, NOW)).toEqual([
      { corner: "bottom-left", text: "example.com" },
    ]);
  });

  it("skips a property the clipping does not carry", () => {
    expect(tileBadges(record(), { date: "missing", property: "missing" }, NOW)).toEqual([]);
  });

  it("returns nothing when nothing is chosen", () => {
    expect(tileBadges(record(), { date: "", property: "" }, NOW)).toEqual([]);
  });
});
