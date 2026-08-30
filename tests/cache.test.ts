import { describe, expect, it } from "vitest";
import { MediaCache } from "../src/core/cache";

describe("MediaCache", () => {
  it("stores and retrieves entries by key", () => {
    const cache = new MediaCache();
    cache.set({
      key: "k",
      file: "f.jpg",
      thumb: "f.thumb.webp",
      kind: "image",
      width: 10,
      height: 20,
      bytes: 100,
    });
    expect(cache.get("k")?.file).toBe("f.jpg");
    expect(cache.has("k")).toBe(true);
  });

  it("round-trips through JSON", () => {
    const cache = new MediaCache();
    cache.set({
      key: "k",
      file: "f.jpg",
      thumb: "t.webp",
      kind: "image",
      width: 10,
      height: 20,
      bytes: 100,
    });
    const restored = MediaCache.fromJSON(JSON.parse(JSON.stringify(cache.toJSON())));
    expect(restored.get("k")).toEqual(cache.get("k"));
  });

  it("survives malformed JSON by starting empty", () => {
    expect(MediaCache.fromJSON(null).entries()).toHaveLength(0);
    expect(MediaCache.fromJSON({ garbage: true }).entries()).toHaveLength(0);
    expect(MediaCache.fromJSON({ entries: "nope" }).entries()).toHaveLength(0);
    expect(MediaCache.fromJSON({ entries: [null, 5, { noKey: 1 }] }).entries()).toHaveLength(0);
  });

  it("merges a successful outcome into an entry", () => {
    const cache = new MediaCache();
    cache.mergeOutcome({
      key: "k",
      kind: "image",
      file: "f.jpg",
      width: 800,
      height: 600,
      bytes: 50,
    });
    expect(cache.get("k")).toMatchObject({ file: "f.jpg", width: 800, height: 600 });
    expect(cache.get("k")?.failed).toBeUndefined();
  });

  it("records a failure without inventing a file path", () => {
    const cache = new MediaCache();
    cache.mergeOutcome({ key: "k", kind: "image", failed: "HTTP 404" });
    expect(cache.get("k")?.failed).toBe("HTTP 404");
    expect(cache.get("k")?.file).toBe("");
  });

  it("clears a previous failure when a later attempt succeeds", () => {
    const cache = new MediaCache();
    cache.mergeOutcome({ key: "k", kind: "image", failed: "HTTP 403" });
    cache.mergeOutcome({ key: "k", kind: "image", file: "f.jpg", width: 1, height: 1, bytes: 1 });
    expect(cache.get("k")?.failed).toBeUndefined();
  });

  it("keeps an existing thumbnail when re-merging the original", () => {
    const cache = new MediaCache();
    cache.mergeOutcome({ key: "k", kind: "image", file: "f.jpg", width: 1, height: 1, bytes: 1 });
    cache.setThumb("k", "f.thumb.webp", 800, 600);
    cache.mergeOutcome({ key: "k", kind: "image", file: "f.jpg", width: 1, height: 1, bytes: 1 });
    expect(cache.get("k")?.thumb).toBe("f.thumb.webp");
  });

  it("defaults dimensions to zero when the header did not parse", () => {
    const cache = new MediaCache();
    cache.mergeOutcome({ key: "k", kind: "image", file: "f.jpg", bytes: 10 });
    expect(cache.get("k")?.width).toBe(0);
    expect(cache.get("k")?.height).toBe(0);
  });

  it("setThumb on an unknown key is a no-op rather than a crash", () => {
    const cache = new MediaCache();
    expect(() => cache.setThumb("missing", "t.webp", 1, 1)).not.toThrow();
    expect(cache.entries()).toHaveLength(0);
  });

  it("setThumb fills in dimensions the header could not provide", () => {
    const cache = new MediaCache();
    cache.mergeOutcome({ key: "k", kind: "video", file: "c.mp4", bytes: 10 });
    cache.setThumb("k", "c.poster.webp", 886, 1920);
    expect(cache.get("k")).toMatchObject({ width: 886, height: 1920 });
  });
});

describe("delete", () => {
  it("forgets an entry, so the URL is downloaded again next time", () => {
    const cache = new MediaCache();
    cache.set({
      key: "https://cdn.example.com/one.jpg",
      file: "Attachments/Clippings/aaaaaaaaaaaa-one.jpg",
      thumb: "",
      kind: "image",
      width: 0,
      height: 0,
      bytes: 0,
    });

    cache.delete("https://cdn.example.com/one.jpg");

    expect(cache.has("https://cdn.example.com/one.jpg")).toBe(false);
  });

  it("shrugs at a key it never held", () => {
    const cache = new MediaCache();
    expect(() => cache.delete("https://cdn.example.com/nothing.jpg")).not.toThrow();
  });
});

describe("byFile", () => {
  it("finds the entry an archived file belongs to, and forgets it when it goes", () => {
    const cache = new MediaCache();
    cache.set({ key: "https://a/x.jpg", file: "Attachments/x.jpg", thumb: "", kind: "image", width: 3, height: 4, bytes: 1 });
    expect(cache.byFile("Attachments/x.jpg")?.key).toBe("https://a/x.jpg");
    cache.mergeOutcome({ key: "https://a/x.jpg", kind: "image", file: "Attachments/y.jpg" });
    expect(cache.byFile("Attachments/x.jpg")).toBeUndefined();
    expect(cache.byFile("Attachments/y.jpg")?.key).toBe("https://a/x.jpg");
    cache.delete("https://a/x.jpg");
    expect(cache.byFile("Attachments/y.jpg")).toBeUndefined();
  });

  it("survives a round trip through JSON", () => {
    const cache = new MediaCache();
    cache.set({ key: "k", file: "Attachments/z.jpg", thumb: "", kind: "image", width: 1, height: 1, bytes: 1 });
    expect(MediaCache.fromJSON(JSON.parse(JSON.stringify(cache))).byFile("Attachments/z.jpg")?.key).toBe("k");
  });
});

describe("thumbFailed", () => {
  const entry = () => ({
    key: "k",
    file: "Attachments/v.mp4",
    thumb: "",
    kind: "video" as const,
    width: 0,
    height: 0,
    bytes: 1,
  });

  it("marks an entry whose render failed and clears it when a thumb lands", () => {
    const cache = new MediaCache();
    cache.set(entry());
    cache.setThumbFailed("k", "no frame");
    expect(cache.get("k")?.thumbFailed).toBe("no frame");
    cache.setThumb("k", "Attachments/v.poster.webp", 100, 50);
    expect(cache.get("k")?.thumbFailed).toBeUndefined();
  });

  it("is reset by a fresh download outcome", () => {
    const cache = new MediaCache();
    cache.set(entry());
    cache.setThumbFailed("k", "no frame");
    cache.mergeOutcome({ key: "k", kind: "video", file: "Attachments/v.mp4", bytes: 2 });
    expect(cache.get("k")?.thumbFailed).toBeUndefined();
  });

  it("clears every mark at once for an explicit retry", () => {
    const cache = new MediaCache();
    cache.set(entry());
    cache.set({ ...entry(), key: "k2", file: "Attachments/w.mp4" });
    cache.setThumbFailed("k", "a");
    cache.setThumbFailed("k2", "b");
    cache.clearThumbFailures();
    expect(cache.get("k")?.thumbFailed).toBeUndefined();
    expect(cache.get("k2")?.thumbFailed).toBeUndefined();
  });

  it("survives a round trip through JSON", () => {
    const cache = new MediaCache();
    cache.set(entry());
    cache.setThumbFailed("k", "no frame");
    expect(MediaCache.fromJSON(JSON.parse(JSON.stringify(cache))).get("k")?.thumbFailed).toBe(
      "no frame"
    );
  });

  it("shrugs at a key it never held", () => {
    const cache = new MediaCache();
    expect(() => cache.setThumbFailed("missing", "x")).not.toThrow();
  });
});
