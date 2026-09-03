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
  it("puts a date in the top-right as a relative time and each tag bottom-left", () => {
    expect(tileBadges(record(), ["created", "categories"], NOW)).toEqual([
      { corner: "top-right", text: "2d ago" },
      { corner: "bottom-left", text: "tools" },
      { corner: "bottom-left", text: "cli" },
    ]);
  });

  it("keeps the order of the chosen keys", () => {
    expect(tileBadges(record(), ["status", "categories"], NOW).map((b) => b.text)).toEqual([
      "unread",
      "tools",
      "cli",
    ]);
  });

  it("renders source as its domain", () => {
    expect(tileBadges(record(), ["source"], NOW)).toEqual([
      { corner: "bottom-left", text: "example.com" },
    ]);
  });

  it("skips a key the clipping does not carry", () => {
    expect(tileBadges(record(), ["missing", "author"], NOW)).toEqual([
      { corner: "bottom-left", text: "Someone" },
    ]);
  });

  it("treats a date-looking value under any key as a date", () => {
    const r = record({ properties: { ...record().properties, published: ["2026-08-30"] } });
    expect(tileBadges(r, ["published"], NOW)).toEqual([{ corner: "top-right", text: "4d ago" }]);
  });

  it("returns nothing when no keys are chosen", () => {
    expect(tileBadges(record(), [], NOW)).toEqual([]);
  });
});
