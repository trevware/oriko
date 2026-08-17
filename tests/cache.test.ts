import { describe, expect, it } from "vitest";
import { MediaCache } from "../src/cache";

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
