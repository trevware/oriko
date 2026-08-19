import { describe, expect, it } from "vitest";
import { fuzzyMatch, rank } from "../src/palette-search";

interface Row {
  label: string;
  keywords?: string;
}

const rows: Row[] = [
  { label: "Move to grid" },
  { label: "manga-downloader" },
  { label: "elboletaire/manga-downloader" },
  { label: "Clear filters", keywords: "reset narrow" },
];

const fields = (row: Row) => ({ primary: row.label, secondary: row.keywords });

const labels = (query: string): string[] =>
  rank(query, rows, fields).map((result) => result.item.label);

describe("fuzzyMatch", () => {
  it("returns null when the text does not contain the query's letters in order", () => {
    expect(fuzzyMatch("zebra", "Move to grid")).toBeNull();
  });

  it("matches regardless of case", () => {
    expect(fuzzyMatch("MOVE", "Move to grid")).not.toBeNull();
  });

  it("reports the matched substring so it can be highlighted", () => {
    expect(fuzzyMatch("to", "Move to grid")?.ranges).toEqual([{ start: 5, end: 7 }]);
  });

  it("merges a scattered subsequence into its contiguous runs", () => {
    // "mdl" lands on m(0), d(6) and l(10): three separate runs.
    expect(fuzzyMatch("mdl", "manga-downloader")?.ranges).toEqual([
      { start: 0, end: 1 },
      { start: 6, end: 7 },
      { start: 10, end: 11 },
    ]);
  });

  it("scores a whole-word substring above a scattered subsequence", () => {
    const substring = fuzzyMatch("manga", "manga-downloader")!.score;
    const scattered = fuzzyMatch("mngdl", "manga-downloader")!.score;
    expect(substring).toBeGreaterThan(scattered);
  });

  it("scores a prefix above the same substring found later", () => {
    const prefix = fuzzyMatch("manga", "manga-downloader")!.score;
    const later = fuzzyMatch("manga", "elboletaire/manga-downloader")!.score;
    expect(prefix).toBeGreaterThan(later);
  });

  it("scores a word-boundary start above a mid-word one", () => {
    const boundary = fuzzyMatch("down", "manga-downloader")!.score;
    const midWord = fuzzyMatch("down", "shutdown-timer")!.score;
    expect(boundary).toBeGreaterThan(midWord);
  });
});

describe("rank", () => {
  it("keeps every item, in the order given, when the query is empty", () => {
    expect(labels("")).toEqual([
      "Move to grid",
      "manga-downloader",
      "elboletaire/manga-downloader",
      "Clear filters",
    ]);
  });

  it("reports no highlight ranges for an empty query", () => {
    expect(rank("", rows, fields)[0].ranges).toEqual([]);
  });

  it("drops items that do not match at all", () => {
    expect(labels("manga")).toEqual(["manga-downloader", "elboletaire/manga-downloader"]);
  });

  it("finds an item by a keyword it does not display", () => {
    expect(labels("reset")).toEqual(["Clear filters"]);
  });

  it("highlights nothing when the match came from a keyword", () => {
    expect(rank("reset", rows, fields)[0].ranges).toEqual([]);
  });

  it("ranks a label match above a keyword match of the same word", () => {
    const items = [
      { label: "Export to Downloads", keywords: "reveal" },
      { label: "Reveal in Finder", keywords: "" },
    ];
    const ranked = rank("reveal", items, (i) => ({ primary: i.label, secondary: i.keywords }));
    expect(ranked.map((r) => r.item.label)).toEqual([
      "Reveal in Finder",
      "Export to Downloads",
    ]);
  });

  it("leaves equally scored items in the order they were given", () => {
    const items = [{ label: "Filter by status" }, { label: "Filter by source" }];
    const ranked = rank("filter by s", items, (i) => ({ primary: i.label }));
    expect(ranked.map((r) => r.item.label)).toEqual([
      "Filter by status",
      "Filter by source",
    ]);
  });
});

describe("rank with a third tier", () => {
  const items = [
    { label: "Nook - Write mode", keywords: "spottedinprod.com design", text: "" },
    { label: "Pasted image 2026-08-18", keywords: "", text: "Focus your map by category" },
  ];
  const fields = (item: (typeof items)[number]) => ({
    primary: item.label,
    secondary: item.keywords,
    tertiary: item.text,
  });

  it("finds an item only by words read out of its picture", () => {
    expect(rank("focus your map", items, fields).map((r) => r.item.label)).toEqual([
      "Pasted image 2026-08-18",
    ]);
  });

  it("ranks a picture's words below anything written about the clipping", () => {
    // "design" is a category on the first; the second only has it in its
    // screenshot. What someone typed outranks what a screen happened to say.
    const both = [
      { label: "A", keywords: "design", text: "" },
      { label: "B", keywords: "", text: "design" },
    ];
    const ranked = rank("design", both, (i) => ({
      primary: i.label,
      secondary: i.keywords,
      tertiary: i.text,
    }));
    expect(ranked.map((r) => r.item.label)).toEqual(["A", "B"]);
  });

  it("highlights nothing for a match inside a picture", () => {
    expect(rank("focus", items, fields)[0].ranges).toEqual([]);
  });
});
