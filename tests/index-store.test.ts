import { describe, expect, it } from "vitest";
import { isInFolder, sortRecords } from "../src/index-store";
import type { ClippingRecord } from "../src/scan";

function rec(path: string, created: string, title: string): ClippingRecord {
  return {
    path,
    created,
    title,
    source: "",
    description: "",
    categories: [],
    status: "unread",
    cover: "",
    media: [],
    haystack: title.toLowerCase(),
  };
}

describe("isInFolder", () => {
  it("accepts markdown files directly inside the folder", () => {
    expect(isInFolder("Clippings/A.md", "Clippings")).toBe(true);
  });

  it("accepts nested markdown files", () => {
    expect(isInFolder("Clippings/sub/A.md", "Clippings")).toBe(true);
  });

  it("rejects other folders", () => {
    expect(isInFolder("Work/A.md", "Clippings")).toBe(false);
  });

  it("rejects files whose name starts with an underscore", () => {
    expect(isInFolder("Clippings/_Categories.md", "Clippings")).toBe(false);
  });

  it("rejects non-markdown files", () => {
    expect(isInFolder("Clippings/Clippings.base", "Clippings")).toBe(false);
  });

  it("is not fooled by a folder with a shared prefix", () => {
    expect(isInFolder("ClippingsOld/A.md", "Clippings")).toBe(false);
  });

  it("tolerates a folder setting with a trailing slash", () => {
    expect(isInFolder("Clippings/A.md", "Clippings/")).toBe(true);
  });
});

describe("sortRecords", () => {
  it("orders newest created first", () => {
    const sorted = sortRecords([
      rec("a.md", "2026-01-01", "A"),
      rec("b.md", "2026-08-01", "B"),
    ]);
    expect(sorted[0].path).toBe("b.md");
  });

  it("falls back to title when created dates match", () => {
    const sorted = sortRecords([
      rec("b.md", "2026-01-01", "Beta"),
      rec("a.md", "2026-01-01", "Alpha"),
    ]);
    expect(sorted[0].title).toBe("Alpha");
  });

  it("puts records with no created date last", () => {
    const sorted = sortRecords([rec("a.md", "", "A"), rec("b.md", "2026-01-01", "B")]);
    expect(sorted[0].path).toBe("b.md");
  });

  it("does not mutate its input", () => {
    const input = [rec("a.md", "2026-01-01", "A"), rec("b.md", "2026-08-01", "B")];
    sortRecords(input);
    expect(input[0].path).toBe("a.md");
  });
});
