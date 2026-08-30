import { describe, expect, it } from "vitest";
import { fuzzyMatch, rank } from "../src/core/palette-search";

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

describe("matching text the reader never sees", () => {
  // A description runs long, and the letters of "coffees on shelf" appear
  // in order inside this one, so a subsequence match would return a bag of
  // coffee as a hit for a weather widget. Once the haystack is a paragraph,
  // words have to be words.
  const unrelated =
    "MILD • •••• WILD ADV WASHED CO-FERMENT NET WT 13 OZ (369 G) OF AWESOME COFFEE " +
    "Coffee Cups Origin Colombia Process Co-Fermented ° Tastes like Orange Cake, " +
    "Bubblegum Freshness Peak Resting Peak Roasted Jul 15, 2026 • day 32 Still Good " +
    "Character Roast level Light • Tvpe Single Oriain y for Filter & Esp";
  const real = "9:41 Good Afternoon 10 coffees on shelf tropical weather ONYX Onyx Coffee Lab";

  const items = [
    { label: "Bag of coffee", text: unrelated },
    { label: "Post by @luoyyisvic on X", text: real },
  ];
  const fields = (i: (typeof items)[number]) => ({ primary: i.label, secondary: i.text });

  it("finds only the picture that actually says it", () => {
    expect(rank("coffees on shelf", items, fields).map((r) => r.item.label)).toEqual([
      "Post by @luoyyisvic on X",
    ]);
  });

  it("still matches words that are all present but not together", () => {
    expect(rank("onyx afternoon", items, fields).map((r) => r.item.label)).toEqual([
      "Post by @luoyyisvic on X",
    ]);
  });

  it("wants every word, not just one of them", () => {
    expect(rank("coffees on submarine", items, fields)).toEqual([]);
  });

  it("scores a whole phrase above the same words scattered", () => {
    const together = [{ label: "A", text: "10 coffees on shelf" }];
    const apart = [{ label: "B", text: "coffees are on the top shelf" }];
    const score = (list: typeof together) =>
      rank("coffees on shelf", list, (i) => ({ primary: i.label, secondary: i.text }))[0].score;
    expect(score(together)).toBeGreaterThan(score(apart));
  });
});
