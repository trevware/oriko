import { describe, expect, it } from "vitest";
import type { CacheEntry } from "../src/cache";
import {
  deadKeys,
  describeFiles,
  filesForRefs,
  isPluginOwned,
  liveRefs,
  orphanFiles,
} from "../src/media-refs";
import { normalizeUrl, sourceVideoKeyFor } from "../src/normalize";
import type { ClippingRecord } from "../src/scan";

const FOLDER = "Attachments/Clippings";

function clipping(over: Partial<ClippingRecord> = {}): ClippingRecord {
  return {
    path: "Clippings/A.md",
    title: "A",
    source: "",
    description: "",
    categories: [],
    status: "unread",
    created: "2026-08-18",
    cover: "",
    grid: "",
    media: [],
    haystack: "",
    properties: {},
    ...over,
  };
}

const SHARED = "https://cdn.example.com/one.jpg";

function entry(key: string, file: string, thumb = ""): CacheEntry {
  return { key, file, thumb, kind: "image", width: 0, height: 0, bytes: 0 };
}

describe("liveRefs", () => {
  it("keeps the key of every media a clipping embeds", () => {
    const record = clipping({ media: [{ url: SHARED, kind: "image", alt: "" }] });
    expect(liveRefs([record]).keys.has(normalizeUrl(SHARED))).toBe(true);
  });

  it("keeps the page cover and pulled-video keys derived from the source", () => {
    const source = "https://example.com/post/1";
    const live = liveRefs([clipping({ source })]);
    expect(live.keys.has(normalizeUrl(source))).toBe(true);
    expect(live.keys.has(sourceVideoKeyFor(source))).toBe(true);
  });

  it("keeps a pasted image, which is a vault path rather than a key", () => {
    const cover = `${FOLDER}/pasted-2026-08-18 215104.png`;
    expect(liveRefs([clipping({ cover })]).paths.has(cover)).toBe(true);
  });

  it("does not mistake a remote cover for a vault path", () => {
    const live = liveRefs([clipping({ cover: "https://example.com/cover.jpg" })]);
    expect(live.paths.size).toBe(0);
  });
});

describe("orphanFiles", () => {
  const cache = [
    entry(normalizeUrl(SHARED), `${FOLDER}/aaaaaaaaaaaa-one.jpg`, `${FOLDER}/aaaaaaaaaaaa-one.poster.webp`),
    entry("https://cdn.example.com/two.mp4", `${FOLDER}/bbbbbbbbbbbb-two.mp4`),
  ];
  const onDisk = [
    `${FOLDER}/aaaaaaaaaaaa-one.jpg`,
    `${FOLDER}/aaaaaaaaaaaa-one.poster.webp`,
    `${FOLDER}/bbbbbbbbbbbb-two.mp4`,
  ];
  const sharer = clipping({ media: [{ url: SHARED, kind: "image", alt: "" }] });

  it("leaves every file alone while something still references it", () => {
    const other = clipping({
      path: "Clippings/B.md",
      media: [{ url: "https://cdn.example.com/two.mp4", kind: "video", alt: "" }],
    });
    expect(orphanFiles({ live: liveRefs([sharer, other]), cache, onDisk })).toEqual([]);
  });

  it("orphans the files of a clipping nothing else shares", () => {
    expect(orphanFiles({ live: liveRefs([sharer]), cache, onDisk })).toEqual([
      `${FOLDER}/bbbbbbbbbbbb-two.mp4`,
    ]);
  });

  it("takes a thumbnail with the file it was made from", () => {
    expect(orphanFiles({ live: liveRefs([]), cache, onDisk })).toEqual(onDisk);
  });

  it("keeps media two clippings share when only one of them goes", () => {
    const second = clipping({ path: "Clippings/B.md", media: [{ url: SHARED, kind: "image", alt: "" }] });
    // B survives, so A's deletion must not take the file they both point at.
    const orphans = orphanFiles({ live: liveRefs([second]), cache, onDisk });
    expect(orphans).not.toContain(`${FOLDER}/aaaaaaaaaaaa-one.jpg`);
  });

  it("keeps a pasted image its clipping still points at", () => {
    const pasted = `${FOLDER}/pasted-2026-08-18 215104.png`;
    const orphans = orphanFiles({
      live: liveRefs([clipping({ cover: pasted })]),
      cache: [],
      onDisk: [pasted],
    });
    expect(orphans).toEqual([]);
  });

  it("sweeps up a pasted image whose clipping is gone", () => {
    const pasted = `${FOLDER}/pasted-2026-08-18 215104.png`;
    expect(orphanFiles({ live: liveRefs([]), cache: [], onDisk: [pasted] })).toEqual([pasted]);
  });

  it("never touches a file the plugin did not make", () => {
    const mine = `${FOLDER}/holiday photo.jpg`;
    expect(orphanFiles({ live: liveRefs([]), cache: [], onDisk: [mine] })).toEqual([]);
  });

  it("ignores a cache entry whose file has already gone from disk", () => {
    expect(orphanFiles({ live: liveRefs([]), cache, onDisk: [] })).toEqual([]);
  });
});

describe("isPluginOwned", () => {
  it("recognises an archived file by its hash prefix", () => {
    expect(isPluginOwned("aaaaaaaaaaaa-one.jpg")).toBe(true);
  });

  it("recognises a pasted capture by its stamped name", () => {
    expect(isPluginOwned("pasted-2026-08-18 215104.png")).toBe(true);
  });

  it("does not claim a file that follows neither convention", () => {
    expect(isPluginOwned("holiday photo.jpg")).toBe(false);
  });
});

describe("deadKeys", () => {
  const cache = [
    entry("https://cdn.example.com/one.jpg", `${FOLDER}/aaaaaaaaaaaa-one.jpg`),
    entry("https://cdn.example.com/two.mp4", `${FOLDER}/bbbbbbbbbbbb-two.mp4`),
  ];

  it("names the entries whose file has just been removed", () => {
    expect(deadKeys(cache, [`${FOLDER}/bbbbbbbbbbbb-two.mp4`])).toEqual([
      "https://cdn.example.com/two.mp4",
    ]);
  });

  it("leaves an entry alone while its file is still there", () => {
    expect(deadKeys(cache, [])).toEqual([]);
  });

  it("ignores an entry that never had a file, such as a failed download", () => {
    expect(deadKeys([entry("https://cdn.example.com/x.jpg", "")], [""])).toEqual([]);
  });
});

describe("filesForRefs", () => {
  const cache = [
    entry(normalizeUrl(SHARED), `${FOLDER}/aaaaaaaaaaaa-one.jpg`, `${FOLDER}/aaaaaaaaaaaa-one.poster.webp`),
    entry("https://cdn.example.com/two.mp4", `${FOLDER}/bbbbbbbbbbbb-two.mp4`),
  ];

  it("resolves a key to the file and the thumbnail made from it", () => {
    const refs = liveRefs([clipping({ media: [{ url: SHARED, kind: "image", alt: "" }] })]);
    expect(filesForRefs(refs, cache)).toEqual([
      `${FOLDER}/aaaaaaaaaaaa-one.jpg`,
      `${FOLDER}/aaaaaaaaaaaa-one.poster.webp`,
    ]);
  });

  it("includes a vault path that never went through the cache", () => {
    const pasted = `${FOLDER}/pasted-2026-08-18 215104.png`;
    expect(filesForRefs(liveRefs([clipping({ cover: pasted })]), cache)).toEqual([pasted]);
  });

  it("says nothing for a key the cache never archived", () => {
    const refs = liveRefs([clipping({ media: [{ url: "https://cdn.example.com/nope.jpg", kind: "image", alt: "" }] })]);
    expect(filesForRefs(refs, cache)).toEqual([]);
  });

  it("lists a file shared by two clippings once", () => {
    const both = liveRefs([
      clipping({ media: [{ url: SHARED, kind: "image", alt: "" }] }),
      clipping({ path: "Clippings/B.md", media: [{ url: SHARED, kind: "image", alt: "" }] }),
    ]);
    expect(filesForRefs(both, cache).filter((f) => f.endsWith("one.jpg"))).toHaveLength(1);
  });
});

describe("describeFiles", () => {
  it("counts one file without pluralising it", () => {
    expect(describeFiles({ paths: ["a"], bytes: 900 })).toBe("1 file (900 B)");
  });

  it("scales into kilobytes and megabytes", () => {
    expect(describeFiles({ paths: ["a", "b"], bytes: 2048 })).toBe("2 files (2.0 KB)");
    expect(describeFiles({ paths: [], bytes: 5 * 1024 * 1024 })).toBe("0 files (5.0 MB)");
  });

  it("drops the decimal once the number is big enough not to need it", () => {
    expect(describeFiles({ paths: ["a"], bytes: 165 * 1024 * 1024 })).toBe("1 file (165 MB)");
  });
});

describe("liveRefs and a post whose video was pulled", () => {
  const source = "https://x.com/someone/status/2089473141126922435";
  const pageKey = normalizeUrl(source);
  const videoKey = sourceVideoKeyFor(source);
  const record = clipping({ source });

  const video = (file: string, thumb: string): CacheEntry => ({
    ...entry(videoKey, file, thumb),
    kind: "video",
  });

  it("keeps the page cover while no video has been pulled", () => {
    expect(liveRefs([record], []).keys.has(pageKey)).toBe(true);
  });

  it("drops the page cover once a playable video stands in front of it", () => {
    // tile.ts prefers the pulled video, so the still X published for the same
    // post is downloaded and then never shown.
    const cache = [video(`${FOLDER}/aaaaaaaaaaaa-video.mp4`, `${FOLDER}/aaaaaaaaaaaa-video.poster.webp`)];
    expect(liveRefs([record], cache).keys.has(pageKey)).toBe(false);
  });

  it("still keeps the video's own key", () => {
    const cache = [video(`${FOLDER}/aaaaaaaaaaaa-video.mp4`, "")];
    expect(liveRefs([record], cache).keys.has(videoKey)).toBe(true);
  });

  it("keeps the page cover when the pulled video cannot be shown at all", () => {
    // A container Chromium will not play, with no extracted frame either:
    // the tile falls through to the page cover, so it is not spare.
    const cache = [video(`${FOLDER}/aaaaaaaaaaaa-video.avi`, "")];
    expect(liveRefs([record], cache).keys.has(pageKey)).toBe(true);
  });

  it("keeps the page cover when the video entry has no file, only a failure", () => {
    const failed: CacheEntry = { ...video("", ""), failed: "404" };
    expect(liveRefs([record], [failed]).keys.has(pageKey)).toBe(true);
  });
});

describe("isPluginOwned", () => {
  it("claims archived files, pastes and scans, and nothing else", () => {
    expect(isPluginOwned("0123456789ab-photo.jpg")).toBe(true);
    expect(isPluginOwned("pasted-2026-08-18 215104.png")).toBe(true);
    expect(isPluginOwned("scan-2026-08-21 203000.jpg")).toBe(true);
    expect(isPluginOwned("holiday.jpg")).toBe(false);
    expect(isPluginOwned("scanner-manual.pdf")).toBe(false);
  });
});
