import { describe, expect, it } from "vitest";
import { MAX_TEXT, chooseEngine, cleanText, describeOcr, textForRecord } from "../src/ocr";
import type { CacheEntry } from "../src/cache";
import type { ClippingRecord } from "../src/scan";

describe("chooseEngine", () => {
  it("prefers Vision, which needs no install and reads screenshots best", () => {
    expect(chooseEngine({ vision: true, tesseract: true })).toBe("vision");
  });

  it("falls back to tesseract where Vision is not available", () => {
    expect(chooseEngine({ vision: false, tesseract: true })).toBe("tesseract");
  });

  it("has nothing to offer when neither is installed", () => {
    expect(chooseEngine({ vision: false, tesseract: false })).toBeNull();
  });
});

describe("cleanText", () => {
  it("flattens the engine's lines into one searchable run", () => {
    expect(cleanText("Focus your map\nFilter your map by category")).toBe(
      "Focus your map Filter your map by category"
    );
  });

  it("collapses the whitespace an engine leaves behind", () => {
    expect(cleanText("  Good    Afternoon \n\n  10 coffees on shelf ")).toBe(
      "Good Afternoon 10 coffees on shelf"
    );
  });

  it("drops lines that carry no letters or digits", () => {
    // Vision emits these constantly from borders, icons and dividers.
    expect(cleanText("Star History\n---\n|||\n2026")).toBe("Star History 2026");
  });

  it("keeps a line that is only a number, since a date or version is worth finding", () => {
    expect(cleanText("2026")).toBe("2026");
  });

  it("returns nothing for a frame with no text at all", () => {
    expect(cleanText("\n  \n||\n")).toBe("");
  });

  it("caps what it stores, so one dense page cannot bloat the cache", () => {
    const long = "supercalifragilistic ".repeat(500);
    expect(cleanText(long).length).toBeLessThanOrEqual(MAX_TEXT);
  });

  it("cuts the cap at a word boundary rather than mid-word", () => {
    const long = "hello world ".repeat(1000);
    expect(cleanText(long).endsWith("hello") || cleanText(long).endsWith("world")).toBe(true);
  });
});

function entry(key: string, text?: string): CacheEntry {
  return { key, file: `f-${key}.jpg`, thumb: "", kind: "image", width: 0, height: 0, bytes: 0, text };
}

function clipping(over: Partial<ClippingRecord> = {}): ClippingRecord {
  return {
    path: "Clippings/A.md",
    title: "A",
    source: "",
    description: "",
    categories: [],
    status: "unread",
    created: "2026-08-19",
    cover: "",
    grid: "",
    media: [],
    haystack: "",
    ...over,
  };
}

describe("textForRecord", () => {
  const media = [{ url: "https://cdn.example.com/one.jpg", kind: "image" as const, alt: "" }];

  it("finds the text read out of a clipping's own media", () => {
    const record = clipping({ media });
    const cache = new Map([["https://cdn.example.com/one.jpg", entry("k", "Focus your map")]]);
    expect(textForRecord(record, (key) => cache.get(key)?.text)).toBe("Focus your map");
  });

  it("joins what several images contributed", () => {
    const record = clipping({
      media: [...media, { url: "https://cdn.example.com/two.jpg", kind: "image" as const, alt: "" }],
    });
    const texts = new Map([
      ["https://cdn.example.com/one.jpg", "first"],
      ["https://cdn.example.com/two.jpg", "second"],
    ]);
    expect(textForRecord(record, (key) => texts.get(key))).toBe("first second");
  });

  it("includes text read from a video's poster frame", () => {
    const record = clipping({ source: "https://x.com/a/status/1" });
    expect(
      textForRecord(record, (key) => (key.startsWith("ytdlp:") ? "from the video" : undefined))
    ).toBe("from the video");
  });

  it("says nothing when none of the media has been read yet", () => {
    expect(textForRecord(clipping({ media }), () => undefined)).toBe("");
  });
});

describe("describeOcr", () => {
  const base = { engine: "vision" as const, pending: 0, attempted: 0, read: 0, failed: 0 };

  it("says so plainly when the machine has no engine", () => {
    expect(describeOcr({ ...base, engine: null })).toMatch(/no OCR engine/i);
  });

  it("distinguishes nothing left to do from nothing working", () => {
    expect(describeOcr(base)).toMatch(/already been read/i);
  });

  it("reports what it read", () => {
    expect(describeOcr({ ...base, pending: 9, attempted: 9, read: 9 })).toBe(
      "read text from 9 pictures"
    );
  });

  it("counts a picture with no words in it as read, because it was", () => {
    expect(describeOcr({ ...base, pending: 1, attempted: 1, read: 1 })).toBe(
      "read text from 1 picture"
    );
  });

  it("does not hide failures behind a success count", () => {
    expect(describeOcr({ ...base, pending: 10, attempted: 10, read: 7, failed: 3 })).toBe(
      "read text from 7 pictures, 3 could not be read"
    );
  });

  it("names the engine as the problem when every read failed", () => {
    // The difference that matters: an engine that is present but refusing.
    expect(describeOcr({ ...base, pending: 5, attempted: 5, failed: 5 })).toMatch(
      /vision failed on all 5/i
    );
  });

  it("blames the files when none of them resolved on disk", () => {
    expect(describeOcr({ ...base, pending: 5 })).toMatch(/could not be found on disk/i);
  });
});
