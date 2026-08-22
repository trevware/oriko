import { describe, expect, it } from "vitest";
import { MediaCache } from "../src/cache";
import { scanClipping } from "../src/scan";
import { buildTiles } from "../src/tile";
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

describe("buildTiles", () => {
  it("uses the first archived image as the cover", () => {
    const cache = cacheWith([[COMBO_7, { thumb: "T7.webp", file: "F7.jpg", width: 1920, height: 1080 }]]);
    const tiles = buildTiles([combolands], cache);
    expect(tiles).toHaveLength(1);
    expect(tiles[0].filePath).toBe("F7.jpg");
    expect(tiles[0].posterPath).toBe("");
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
    expect(tiles[0].filePath).toBe("F6.jpg");
  });

  it("uses the local original when the thumbnail is not derived yet", () => {
    const cache = cacheWith([
      [COMBO_7, { file: "F7.jpg", thumb: "", width: 1920, height: 1080 }],
    ]);
    const tiles = buildTiles([combolands], cache);
    expect(tiles[0].filePath).toBe("F7.jpg");
    expect(tiles[0].remote).toBe(false);
  });

  it("uses the video for a video-only clipping", () => {
    const cache = cacheWith([
      [NOOK_MP4, { kind: "video", file: "clip.mp4", thumb: "clip.poster.webp", width: 886, height: 1920 }],
    ]);
    const tiles = buildTiles([nook], cache);
    expect(tiles[0].kind).toBe("video");
    expect(tiles[0].filePath).toBe("clip.mp4");
    expect(tiles[0].posterPath).toBe("clip.poster.webp");
  });

  it("omits a clipping with no media and no source page", () => {
    const empty = scanClipping("Clippings/E.md", { title: "E" }, "just prose");
    expect(buildTiles([empty], new MediaCache())).toEqual([]);
  });

  it("omits a record whose current cover is known to fail", () => {
    const signature = buildTiles([combolands], new MediaCache())[0].signature;
    const failed = new Map([["Clippings/C.md", signature]]);
    expect(buildTiles([combolands], new MediaCache(), failed)).toEqual([]);
  });

  it("brings a clipping back once its cover changes", () => {
    const staleSignature = buildTiles([combolands], new MediaCache())[0].signature;
    const failed = new Map([["Clippings/C.md", staleSignature]]);
    // Archiving replaces the dead remote cover with a local file, so the
    // signature changes and the old failure no longer applies.
    const cache = cacheWith([
      [COMBO_7, { file: "F7.jpg", thumb: "", width: 1920, height: 1080 }],
    ]);
    const tiles = buildTiles([combolands], cache, failed);
    expect(tiles).toHaveLength(1);
    expect(tiles[0].filePath).toBe("F7.jpg");
  });

  it("honors an explicit cover in frontmatter", () => {
    const record = scanClipping(
      "Clippings/C.md",
      { ...COMBOLANDS_FM, cover: "Attachments/Clippings/manual.png" },
      COMBOLANDS_BODY
    );
    const tiles = buildTiles([record], new MediaCache());
    expect(tiles[0].filePath).toBe("Attachments/Clippings/manual.png");
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
    expect(tiles[0].filePath).toContain("combolands-7.jpg");
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
    expect(tiles[0].filePath).toBe("F7.jpg");
  });

  it("does not show a ref remotely when its archive failed", () => {
    const cache = new MediaCache();
    cache.mergeOutcome({ key: COMBO_7, kind: "image", failed: "unexpected content type text/html" });
    cache.mergeOutcome({ key: COMBO_6, kind: "image", failed: "HTTP 404" });
    // Polygon's source page has no cached preview image either, so nothing
    // is left to show and the clipping drops out of the grid.
    expect(buildTiles([combolands], cache)).toEqual([]);
  });

  it("falls back to a later ref when an earlier one failed", () => {
    const cache = new MediaCache();
    cache.mergeOutcome({ key: COMBO_7, kind: "image", failed: "HTTP 404" });
    const tiles = buildTiles([combolands], cache);
    expect(tiles[0].remote).toBe(true);
    expect(tiles[0].filePath).toContain("combolands-6.jpg");
  });

  it("shows a remote video before it is archived", () => {
    const tiles = buildTiles([nook], new MediaCache());
    expect(tiles[0].kind).toBe("video");
    expect(tiles[0].remote).toBe(true);
    expect(tiles[0].filePath).toContain(".mp4");
  });

  it("omits a clipping with no media at all", () => {
    const empty = scanClipping("Clippings/E.md", { title: "E" }, "no media here");
    expect(buildTiles([empty], new MediaCache())).toEqual([]);
  });
});

describe("page covers", () => {
  const youtube = scanClipping(
    "Clippings/GITS.md",
    { title: "Ghost in the Shell", source: "https://www.youtube.com/watch?v=BZZoL_IoBZs" },
    "no inline media at all"
  );

  const article = scanClipping(
    "Clippings/A.md",
    { title: "An article", source: "https://www.polygon.com/article" },
    "no inline media at all"
  );

  it("resolves a youtube page to its thumbnail with no fetch", () => {
    const tiles = buildTiles([youtube], new MediaCache());
    expect(tiles).toHaveLength(1);
    expect(tiles[0].remote).toBe(true);
    expect(tiles[0].filePath).toBe(
      "https://img.youtube.com/vi/BZZoL_IoBZs/maxresdefault.jpg"
    );
  });

  it("prefers the archived page cover over the remote thumbnail", () => {
    const cache = cacheWith([
      [
        "https://www.youtube.com/watch?v=BZZoL_IoBZs",
        { file: "yt.jpg", thumb: "yt.thumb.webp", width: 1280, height: 720 },
      ],
    ]);
    const tiles = buildTiles([youtube], cache);
    expect(tiles[0].remote).toBe(false);
    expect(tiles[0].filePath).toBe("yt.jpg");
  });

  it("uses an archived og:image for a page that is not a known host", () => {
    const cache = cacheWith([
      [
        "https://www.polygon.com/article",
        { file: "og.jpg", thumb: "og.thumb.webp", width: 1200, height: 630 },
      ],
    ]);
    const tiles = buildTiles([article], cache);
    expect(tiles).toHaveLength(1);
    expect(tiles[0].filePath).toBe("og.jpg");
  });

  it("omits a page whose cover resolution already failed", () => {
    const cache = new MediaCache();
    cache.mergeOutcome({
      key: "https://www.polygon.com/article",
      kind: "image",
      failed: "no preview image",
    });
    expect(buildTiles([article], cache)).toEqual([]);
  });

  it("omits a non-known-host page with no cached cover yet", () => {
    expect(buildTiles([article], new MediaCache())).toEqual([]);
  });

  it("prefers inline media over the page cover", () => {
    const withMedia = scanClipping(
      "Clippings/GITS.md",
      { title: "G", source: "https://www.youtube.com/watch?v=BZZoL_IoBZs" },
      "![a](https://x.com/inline.jpg)"
    );
    expect(buildTiles([withMedia], new MediaCache())[0].filePath).toContain("inline.jpg");
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

  it("does not manage an archived gif that has no thumbnail to swap back to", () => {
    const cache = cacheWith([
      [COMBO_7, { file: "F7.gif", thumb: "", width: 960, height: 420, bytes: 101_000 }],
    ]);
    expect(buildTiles([combolands], cache)[0].animated).toBe(false);
  });

  it("keeps a still for a gif, so playback has something to freeze on", () => {
    const cache = cacheWith([
      [COMBO_7, { file: "F7.gif", thumb: "T7.webp", width: 960, height: 420, bytes: 101_000 }],
    ]);
    const tile = buildTiles([combolands], cache)[0];
    expect(tile.filePath).toBe("F7.gif");
    expect(tile.posterPath).toBe("T7.webp");
  });

  it("keeps a poster for video", () => {
    const cache = cacheWith([
      [NOOK_MP4, { kind: "video", file: "c.mp4", thumb: "c.poster.webp", width: 886, height: 1920 }],
    ]);
    expect(buildTiles([nook], cache)[0].posterPath).toBe("c.poster.webp");
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

describe("buildTiles with local embeds", () => {
  const record = scanClipping(
    "Clippings/Putting Out of Your Mind.md",
    { title: "Putting Out of Your Mind", source: "https://www.amazon.ca/dp/0743212134" },
    "![[Attachments/Clippings/df1c6f006c20-61f8IVzjEDL.jpg]]"
  );

  it("shows a clipping's own embedded file, at the size the archive knows", () => {
    const cache = cacheWith([
      [
        "https://m.media-amazon.com/images/I/61f8IVzjEDL.jpg",
        { file: "Attachments/Clippings/df1c6f006c20-61f8IVzjEDL.jpg", thumb: "", width: 725, height: 1000 },
      ],
    ]);
    const [tile] = buildTiles([record], cache);
    expect(tile).toBeDefined();
    expect(tile.filePath).toBe("Attachments/Clippings/df1c6f006c20-61f8IVzjEDL.jpg");
    expect(tile.remote).toBe(false);
    expect(tile.width).toBe(725);
    expect(tile.height).toBe(1000);
  });

  it("shows an embedded file the archive has never seen, provisionally", () => {
    const [tile] = buildTiles([record], new MediaCache());
    expect(tile.filePath).toBe("Attachments/Clippings/df1c6f006c20-61f8IVzjEDL.jpg");
    expect(tile.remote).toBe(false);
    expect(tile.provisional).toBe(true);
  });

  it("prefers the embedded file over a page cover archived for the source", () => {
    const cache = cacheWith([
      ["https://www.amazon.ca/dp/0743212134", { file: "Attachments/Clippings/social.png" }],
    ]);
    const [tile] = buildTiles([record], cache);
    expect(tile.filePath).toBe("Attachments/Clippings/df1c6f006c20-61f8IVzjEDL.jpg");
  });

  it("has nothing to show for an embedded video with no poster", () => {
    const video = scanClipping("Clippings/V.md", { title: "V" }, "![[Attachments/Clippings/a.mp4]]");
    expect(buildTiles([video], new MediaCache())).toEqual([]);
  });
});
