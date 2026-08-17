import { describe, expect, it } from "vitest";
import { MediaCache } from "../src/cache";
import { scanClipping } from "../src/scan";
import { buildTiles, gradientFor } from "../src/tile";
import { COMBOLANDS_BODY, COMBOLANDS_FM, NOOK_BODY, NOOK_FM } from "./fixtures/clippings";

const COMBO_7 =
  "https://static0.polygonimages.com/wordpress/wp-content/uploads/2026/07/combolands-7.jpg";
const COMBO_6 =
  "https://static0.polygonimages.com/wordpress/wp-content/uploads/2026/07/combolands-6.jpg";
const NOOK_MP4 =
  "https://cdn.spottedinprod.com/community-clips/19305/797/1786251277681-transcoded.mp4";

function cacheWith(
  entries: Array<[string, Partial<Omit<import("../src/cache").CacheEntry, "key">>]>
): MediaCache {
  const cache = new MediaCache();
  for (const [key, e] of entries) {
    cache.set({
      key,
      file: e.file ?? "f.jpg",
      thumb: e.thumb ?? "t.webp",
      kind: e.kind ?? "image",
      width: e.width ?? 100,
      height: e.height ?? 100,
      bytes: e.bytes ?? 1,
      ...(e.failed ? { failed: e.failed } : {}),
    });
  }
  return cache;
}

const combolands = scanClipping("Clippings/C.md", COMBOLANDS_FM, COMBOLANDS_BODY);
const nook = scanClipping("Clippings/N.md", NOOK_FM, NOOK_BODY);

describe("gradientFor", () => {
  it("is stable for the same seed", () => {
    expect(gradientFor("polygon.com")).toBe(gradientFor("polygon.com"));
  });

  it("differs across seeds", () => {
    expect(gradientFor("polygon.com")).not.toBe(gradientFor("github.com"));
  });

  it("produces a css gradient", () => {
    expect(gradientFor("x")).toMatch(/^linear-gradient\(/);
  });
});

describe("buildTiles", () => {
  it("uses the first archived image as the cover", () => {
    const cache = cacheWith([[COMBO_7, { thumb: "T7.webp", file: "F7.jpg", width: 1920, height: 1080 }]]);
    const tiles = buildTiles([combolands], cache);
    expect(tiles).toHaveLength(1);
    expect(tiles[0].thumbPath).toBe("T7.webp");
    expect(tiles[0].kind).toBe("image");
    expect(tiles[0].width).toBe(1920);
  });

  it("skips to the next media ref when the first failed to archive", () => {
    const cache = new MediaCache();
    cache.mergeOutcome({ key: COMBO_7, kind: "image", failed: "HTTP 404" });
    cache.set({
      key: COMBO_6,
      file: "F6.jpg",
      thumb: "T6.webp",
      kind: "image",
      width: 800,
      height: 600,
      bytes: 1,
    });
    const tiles = buildTiles([combolands], cache);
    expect(tiles[0].thumbPath).toBe("T6.webp");
  });

  it("uses the local original when the thumbnail is not derived yet", () => {
    const cache = cacheWith([
      [COMBO_7, { file: "F7.jpg", thumb: "", width: 1920, height: 1080 }],
    ]);
    const tiles = buildTiles([combolands], cache);
    expect(tiles[0].thumbPath).toBe("F7.jpg");
    expect(tiles[0].remote).toBe(false);
  });

  it("uses the video for a video-only clipping", () => {
    const cache = cacheWith([
      [NOOK_MP4, { kind: "video", file: "clip.mp4", thumb: "clip.poster.webp", width: 886, height: 1920 }],
    ]);
    const tiles = buildTiles([nook], cache);
    expect(tiles[0].kind).toBe("video");
    expect(tiles[0].filePath).toBe("clip.mp4");
    expect(tiles[0].thumbPath).toBe("clip.poster.webp");
  });

  it("falls back to a gradient tile when the clipping has no media", () => {
    const empty = scanClipping("Clippings/E.md", { title: "E" }, "just prose");
    const tiles = buildTiles([empty], new MediaCache());
    expect(tiles[0].kind).toBe("fallback");
    expect(tiles[0].thumbPath).toBe("");
    expect(tiles[0].gradient).toMatch(/^linear-gradient\(/);
  });

  it("gives fallback tiles a sane default aspect ratio", () => {
    const empty = scanClipping("Clippings/E.md", { title: "E" }, "just prose");
    const tiles = buildTiles([empty], new MediaCache());
    expect(tiles[0].width).toBe(4);
    expect(tiles[0].height).toBe(3);
  });

  it("honors an explicit cover in frontmatter", () => {
    const record = scanClipping(
      "Clippings/C.md",
      { ...COMBOLANDS_FM, cover: "Attachments/Clippings/manual.png" },
      COMBOLANDS_BODY
    );
    const tiles = buildTiles([record], new MediaCache());
    expect(tiles[0].thumbPath).toBe("Attachments/Clippings/manual.png");
  });

  it("uses the note path as the tile id", () => {
    expect(buildTiles([combolands], new MediaCache())[0].id).toBe("Clippings/C.md");
  });

  it("falls back to a default ratio when the cache has no dimensions", () => {
    const cache = cacheWith([[COMBO_7, { thumb: "T.webp", width: 0, height: 0 }]]);
    const tiles = buildTiles([combolands], cache);
    expect(tiles[0].width).toBe(4);
    expect(tiles[0].height).toBe(3);
  });

  it("keeps records in the order it was given", () => {
    const tiles = buildTiles([nook, combolands], new MediaCache());
    expect(tiles.map((t) => t.id)).toEqual(["Clippings/N.md", "Clippings/C.md"]);
  });

  it("returns an empty list for no records", () => {
    expect(buildTiles([], new MediaCache())).toEqual([]);
  });
});

describe("remote covers before archiving", () => {
  it("uses the remote url when nothing is archived yet", () => {
    const tiles = buildTiles([combolands], new MediaCache());
    expect(tiles[0].kind).toBe("image");
    expect(tiles[0].remote).toBe(true);
    expect(tiles[0].thumbPath).toContain("combolands-7.jpg");
  });

  it("marks remote dimensions as provisional", () => {
    const tiles = buildTiles([combolands], new MediaCache());
    expect(tiles[0].provisional).toBe(true);
  });

  it("takes provisional dimensions from the url size hints", () => {
    const tiles = buildTiles([combolands], new MediaCache());
    expect(tiles[0].width).toBe(1920);
    expect(tiles[0].height).toBe(1080);
  });

  it("prefers an archived local file over the remote url", () => {
    const cache = cacheWith([
      [COMBO_7, { file: "F7.jpg", thumb: "T7.webp", width: 1920, height: 1080 }],
    ]);
    const tiles = buildTiles([combolands], cache);
    expect(tiles[0].remote).toBe(false);
    expect(tiles[0].provisional).toBe(false);
    expect(tiles[0].thumbPath).toBe("T7.webp");
  });

  it("does not show a ref remotely when its archive failed", () => {
    const cache = new MediaCache();
    cache.mergeOutcome({ key: COMBO_7, kind: "image", failed: "unexpected content type text/html" });
    cache.mergeOutcome({ key: COMBO_6, kind: "image", failed: "HTTP 404" });
    const tiles = buildTiles([combolands], cache);
    expect(tiles[0].kind).toBe("fallback");
  });

  it("falls back to a later ref when an earlier one failed", () => {
    const cache = new MediaCache();
    cache.mergeOutcome({ key: COMBO_7, kind: "image", failed: "HTTP 404" });
    const tiles = buildTiles([combolands], cache);
    expect(tiles[0].remote).toBe(true);
    expect(tiles[0].thumbPath).toContain("combolands-6.jpg");
  });

  it("shows a remote video before it is archived", () => {
    const tiles = buildTiles([nook], new MediaCache());
    expect(tiles[0].kind).toBe("video");
    expect(tiles[0].remote).toBe(true);
    expect(tiles[0].filePath).toContain(".mp4");
  });

  it("still falls back to a gradient when there is no media at all", () => {
    const empty = scanClipping("Clippings/E.md", { title: "E" }, "no media here");
    expect(buildTiles([empty], new MediaCache())[0].kind).toBe("fallback");
  });
});

describe("signature", () => {
  it("changes when a tile swaps from remote to local", () => {
    const before = buildTiles([combolands], new MediaCache())[0];
    const after = buildTiles(
      [combolands],
      cacheWith([[COMBO_7, { file: "F7.jpg", thumb: "T7.webp", width: 1920, height: 1080 }]])
    )[0];
    expect(before.signature).not.toBe(after.signature);
  });

  it("is stable for an unchanged tile", () => {
    const cache = cacheWith([[COMBO_7, { file: "F7.jpg", thumb: "T7.webp" }]]);
    expect(buildTiles([combolands], cache)[0].signature).toBe(
      buildTiles([combolands], cache)[0].signature
    );
  });
});

describe("animated covers", () => {
  it("marks a gif cover as animated", () => {
    const cache = cacheWith([
      [COMBO_7, { file: "F7.gif", thumb: "T7.webp", width: 960, height: 420, bytes: 101_000 }],
    ]);
    expect(buildTiles([combolands], cache)[0].animated).toBe(true);
  });

  it("does not mark a jpg as animated", () => {
    const cache = cacheWith([
      [COMBO_7, { file: "F7.jpg", thumb: "T7.webp", width: 1920, height: 1080 }],
    ]);
    expect(buildTiles([combolands], cache)[0].animated).toBe(false);
  });

  it("does not animate a gif over the size threshold", () => {
    const cache = cacheWith([
      [COMBO_7, { file: "F7.gif", thumb: "T7.webp", width: 960, height: 420, bytes: 50_000_000 }],
    ]);
    expect(buildTiles([combolands], cache)[0].animated).toBe(false);
  });

  it("does not mark video as animated, since video has its own path", () => {
    const cache = cacheWith([
      [NOOK_MP4, { kind: "video", file: "c.mp4", thumb: "c.poster.webp", width: 886, height: 1920 }],
    ]);
    expect(buildTiles([nook], cache)[0].animated).toBe(false);
  });

  it("never marks a fallback tile as animated", () => {
    const empty = scanClipping("Clippings/E.md", { title: "E" }, "just prose");
    expect(buildTiles([empty], new MediaCache())[0].animated).toBe(false);
  });

  // A remote gif animates on its own, but there is no still to swap back to,
  // so playback has nothing to manage until it is archived.
  it("does not manage a remote gif that is not archived yet", () => {
    const record = scanClipping(
      "Clippings/G.md",
      { title: "G" },
      "![demo](https://x.com/demo.gif)"
    );
    expect(buildTiles([record], new MediaCache())[0].animated).toBe(false);
  });
});
