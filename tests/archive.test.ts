import { describe, expect, it, vi } from "vitest";
import { archiveAll, archiveFilename, archiveOne, sourceVideoCandidates } from "../src/archive";
import { hashUrl } from "../src/hash";
import type { ArchiveDeps, Fetcher } from "../src/archive";
import type { CanonicalMedia } from "../src/normalize";

function pngBuffer(width: number, height: number): ArrayBuffer {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(b.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return b.buffer;
}

function asciiBuffer(text: string): ArrayBuffer {
  const b = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) b[i] = text.charCodeAt(i);
  return b.buffer;
}

const media: CanonicalMedia = {
  key: "https://x.com/a.jpg",
  url: "https://x.com/a.jpg?w=1920",
  kind: "image",
  alt: "a",
};

function deps(overrides: Partial<ArchiveDeps> = {}): ArchiveDeps {
  return {
    fetch: vi.fn(async () => ({ status: 200, arrayBuffer: pngBuffer(1920, 1080) })),
    exists: vi.fn(async () => false),
    write: vi.fn(async () => {}),
    folder: "Attachments/Clippings",
    maxBytes: 26214400,
    ...overrides,
  };
}

describe("archiveFilename", () => {
  it("combines a url hash with the original basename", () => {
    expect(archiveFilename(media)).toMatch(/^[0-9a-f]{12}-a\.jpg$/);
  });

  it("is stable across size variants of the same asset", () => {
    const small = archiveFilename({ ...media, url: "https://x.com/a.jpg?w=750" });
    const large = archiveFilename({ ...media, url: "https://x.com/a.jpg?w=1920" });
    expect(small).toBe(large);
  });

  it("sanitizes characters that are illegal in filenames", () => {
    const name = archiveFilename({ ...media, url: "https://x.com/a b:c*.jpg" });
    expect(name).not.toMatch(/[:*\s]/);
  });

  it("supplies an extension when the url has none", () => {
    expect(archiveFilename({ ...media, url: "https://x.com/image" })).toMatch(/\.jpg$/);
  });

  it("uses mp4 for video with no extension", () => {
    const name = archiveFilename({ ...media, kind: "video", url: "https://x.com/clip" });
    expect(name).toMatch(/\.mp4$/);
  });

  it("handles the real twimg shape, whose path has no extension", () => {
    const name = archiveFilename({
      key: "https://pbs.twimg.com/media/HP7q-WqXoAAqzO0?format=jpg&name=large",
      url: "https://pbs.twimg.com/media/HP7q-WqXoAAqzO0?format=jpg&name=large",
      kind: "image",
      alt: "",
    });
    expect(name).toMatch(/^[0-9a-f]{12}-HP7q-WqXoAAqzO0\.jpg$/);
  });

  it("truncates a very long basename", () => {
    const name = archiveFilename({ ...media, url: `https://x.com/${"y".repeat(200)}.jpg` });
    expect(name.length).toBeLessThanOrEqual(93);
    expect(name).toMatch(/\.jpg$/);
  });
});

describe("archiveOne", () => {
  it("writes the file and reports dimensions read from the header", async () => {
    const d = deps();
    const out = await archiveOne(media, "https://ref", d);
    expect(out.failed).toBeUndefined();
    expect(out.width).toBe(1920);
    expect(out.height).toBe(1080);
    expect(out.file).toBe(`Attachments/Clippings/${archiveFilename(media)}`);
    expect(d.write).toHaveBeenCalledOnce();
  });

  it("keys the outcome by the normalized url", async () => {
    const out = await archiveOne(media, "https://ref", deps());
    expect(out.key).toBe("https://x.com/a.jpg");
  });

  it("skips the download when the file already exists", async () => {
    const d = deps({ exists: vi.fn(async () => true) });
    const out = await archiveOne(media, "https://ref", d);
    expect(d.fetch).not.toHaveBeenCalled();
    expect(d.write).not.toHaveBeenCalled();
    expect(out.file).toBeDefined();
  });

  it("retries once with a Referer header after a 403", async () => {
    const fetch = vi
      .fn<Fetcher>()
      .mockResolvedValueOnce({ status: 403, arrayBuffer: new ArrayBuffer(0) })
      .mockResolvedValueOnce({ status: 200, arrayBuffer: pngBuffer(10, 10) });
    const d = deps({ fetch });
    const out = await archiveOne(media, "https://polygon.com/article", d);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][1]).not.toHaveProperty("Referer");
    expect(fetch.mock.calls[1][1].Referer).toBe("https://polygon.com/article");
    expect(out.failed).toBeUndefined();
  });

  it("gives up after the retry also fails", async () => {
    const fetch = vi.fn(async () => ({ status: 403, arrayBuffer: new ArrayBuffer(0) }));
    const out = await archiveOne(media, "https://ref", deps({ fetch }));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(out.failed).toContain("403");
    expect(out.file).toBeUndefined();
  });

  it("does not retry a 404", async () => {
    const fetch = vi.fn(async () => ({ status: 404, arrayBuffer: new ArrayBuffer(0) }));
    const out = await archiveOne(media, "https://ref", deps({ fetch }));
    expect(fetch).toHaveBeenCalledOnce();
    expect(out.failed).toContain("404");
  });

  it("does not retry when there is no referer to send", async () => {
    const fetch = vi.fn(async () => ({ status: 403, arrayBuffer: new ArrayBuffer(0) }));
    const out = await archiveOne(media, "", deps({ fetch }));
    expect(fetch).toHaveBeenCalledOnce();
    expect(out.failed).toContain("403");
  });

  it("refuses a response that is not image or video content", async () => {
    const d = deps({
      fetch: vi.fn(async () => ({
        status: 200,
        arrayBuffer: asciiBuffer("<!doctype html><html>"),
        contentType: "text/html; charset=utf-8",
      })),
    });
    const out = await archiveOne(
      { ...media, url: "https://www.youtube.com/watch?v=BZZoL_IoBZs" },
      "https://ref",
      d
    );
    expect(out.failed).toContain("text/html");
    expect(d.write).not.toHaveBeenCalled();
  });

  it("accepts image and video content types", async () => {
    for (const contentType of ["image/jpeg", "video/mp4", "image/gif"]) {
      const d = deps({
        fetch: vi.fn(async () => ({ status: 200, arrayBuffer: pngBuffer(4, 3), contentType })),
      });
      const out = await archiveOne(media, "https://ref", d);
      expect(out.failed).toBeUndefined();
    }
  });

  it("accepts a response with no content-type rather than guessing", async () => {
    const d = deps({
      fetch: vi.fn(async () => ({ status: 200, arrayBuffer: pngBuffer(10, 10) })),
    });
    const out = await archiveOne(media, "https://ref", d);
    expect(out.failed).toBeUndefined();
    expect(d.write).toHaveBeenCalledOnce();
  });

  it("refuses files over the size cap without writing them", async () => {
    const d = deps({
      maxBytes: 100,
      fetch: vi.fn(async () => ({ status: 200, arrayBuffer: new ArrayBuffer(500) })),
    });
    const out = await archiveOne(media, "https://ref", d);
    expect(out.failed).toContain("too large");
    expect(d.write).not.toHaveBeenCalled();
  });

  it("treats an empty body as a failure", async () => {
    const d = deps({
      fetch: vi.fn(async () => ({ status: 200, arrayBuffer: new ArrayBuffer(0) })),
    });
    const out = await archiveOne(media, "https://ref", d);
    expect(out.failed).toContain("empty");
    expect(d.write).not.toHaveBeenCalled();
  });

  it("records a network error as a failure rather than throwing", async () => {
    const d = deps({
      fetch: vi.fn(async () => {
        throw new Error("offline");
      }),
    });
    const out = await archiveOne(media, "https://ref", d);
    expect(out.failed).toContain("offline");
  });

  it("records a write error as a failure rather than throwing", async () => {
    const d = deps({
      write: vi.fn(async () => {
        throw new Error("disk full");
      }),
    });
    const out = await archiveOne(media, "https://ref", d);
    expect(out.failed).toContain("disk full");
    expect(out.file).toBeUndefined();
  });

  it("still writes the file when the header will not parse", async () => {
    const d = deps({
      fetch: vi.fn(async () => ({ status: 200, arrayBuffer: new ArrayBuffer(64) })),
    });
    const out = await archiveOne(media, "https://ref", d);
    expect(d.write).toHaveBeenCalledOnce();
    expect(out.width).toBeUndefined();
    expect(out.failed).toBeUndefined();
  });

  it("does not try to read dimensions from video", async () => {
    const d = deps({
      fetch: vi.fn(async () => ({ status: 200, arrayBuffer: pngBuffer(1920, 1080) })),
    });
    const out = await archiveOne({ ...media, kind: "video" }, "https://ref", d);
    expect(out.width).toBeUndefined();
    expect(out.file).toBeDefined();
  });
});

describe("fallback urls", () => {
  const withFallbacks: CanonicalMedia = {
    key: "https://www.youtube.com/watch?v=BZZoL_IoBZs",
    url: "https://img.youtube.com/vi/BZZoL_IoBZs/maxresdefault.jpg",
    kind: "image",
    alt: "",
    fallbacks: [
      "https://img.youtube.com/vi/BZZoL_IoBZs/hq720.jpg",
      "https://img.youtube.com/vi/BZZoL_IoBZs/hqdefault.jpg",
    ],
  };

  it("uses the primary when it succeeds", async () => {
    const d = deps();
    const out = await archiveOne(withFallbacks, "", d);
    expect(out.file).toContain("maxresdefault");
    expect(d.fetch).toHaveBeenCalledOnce();
  });

  it("walks down to the next candidate on a 404", async () => {
    const fetch = vi
      .fn<Fetcher>()
      .mockResolvedValueOnce({ status: 404, arrayBuffer: new ArrayBuffer(0) })
      .mockResolvedValueOnce({ status: 200, arrayBuffer: pngBuffer(1280, 720) });
    const out = await archiveOne(withFallbacks, "", deps({ fetch }));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(out.file).toContain("hq720");
    expect(out.width).toBe(1280);
  });

  it("reaches the last candidate when the earlier ones fail", async () => {
    const fetch = vi
      .fn<Fetcher>()
      .mockResolvedValueOnce({ status: 404, arrayBuffer: new ArrayBuffer(0) })
      .mockResolvedValueOnce({ status: 404, arrayBuffer: new ArrayBuffer(0) })
      .mockResolvedValueOnce({ status: 200, arrayBuffer: pngBuffer(480, 360) });
    const out = await archiveOne(withFallbacks, "", deps({ fetch }));
    expect(out.file).toContain("hqdefault");
  });

  it("reports the last failure when every candidate fails", async () => {
    const fetch = vi.fn(async () => ({ status: 404, arrayBuffer: new ArrayBuffer(0) }));
    const out = await archiveOne(withFallbacks, "", deps({ fetch }));
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(out.failed).toContain("404");
    expect(out.file).toBeUndefined();
  });

  it("skips the download when a fallback was already archived", async () => {
    const d = deps({
      exists: vi.fn(async (path: string) => path.includes("hqdefault")),
    });
    const out = await archiveOne(withFallbacks, "", d);
    expect(d.fetch).not.toHaveBeenCalled();
    expect(out.file).toContain("hqdefault");
  });

  it("keys every candidate under the same cache key", async () => {
    const fetch = vi
      .fn<Fetcher>()
      .mockResolvedValueOnce({ status: 404, arrayBuffer: new ArrayBuffer(0) })
      .mockResolvedValueOnce({ status: 200, arrayBuffer: pngBuffer(10, 10) });
    const out = await archiveOne(withFallbacks, "", deps({ fetch }));
    expect(out.key).toBe("https://www.youtube.com/watch?v=BZZoL_IoBZs");
  });
});

describe("archiveAll", () => {
  const list: CanonicalMedia[] = Array.from({ length: 9 }, (_, i) => ({
    key: `https://x.com/${i}.jpg`,
    url: `https://x.com/${i}.jpg`,
    kind: "image",
    alt: "",
  }));

  it("processes every item", async () => {
    const out = await archiveAll(list, "https://ref", deps(), 4);
    expect(out).toHaveLength(9);
    expect(out.every((o) => o.file)).toBe(true);
  });

  it("returns outcomes in input order", async () => {
    const out = await archiveAll(list, "https://ref", deps(), 4);
    expect(out.map((o) => o.key)).toEqual(list.map((m) => m.key));
  });

  it("returns an empty list for no input", async () => {
    expect(await archiveAll([], "https://ref", deps(), 4)).toEqual([]);
  });

  it("never exceeds the concurrency cap", async () => {
    let inFlight = 0;
    let peak = 0;
    const d = deps({
      fetch: vi.fn(async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return { status: 200, arrayBuffer: pngBuffer(10, 10) };
      }),
    });
    const many: CanonicalMedia[] = Array.from({ length: 12 }, (_, i) => ({
      key: `https://x.com/${i}.jpg`,
      url: `https://x.com/${i}.jpg`,
      kind: "image",
      alt: "",
    }));
    await archiveAll(many, "https://ref", d, 4);
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });

  it("one failure does not abort the rest", async () => {
    let call = 0;
    const d = deps({
      fetch: vi.fn(async () => {
        call++;
        if (call === 2) throw new Error("boom");
        return { status: 200, arrayBuffer: pngBuffer(10, 10) };
      }),
    });
    const out = await archiveAll(list, "https://ref", d, 1);
    expect(out.filter((o) => o.failed)).toHaveLength(1);
    expect(out.filter((o) => o.file)).toHaveLength(8);
  });
});

describe("sourceVideoCandidates", () => {
  it("lists one path per playable extension, under the folder, keyed by hash", () => {
    const paths = sourceVideoCandidates("source-video:https://a/reel/1", "Attachments/Clippings");
    const hash = hashUrl("source-video:https://a/reel/1");
    expect(paths).toContain(`Attachments/Clippings/${hash}-video.mp4`);
    expect(paths.every((p) => p.startsWith(`Attachments/Clippings/${hash}-video.`))).toBe(true);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("matches the filename downloadSourceVideoFor writes", () => {
    const hash = hashUrl("source-video:https://a/reel/1");
    expect(sourceVideoCandidates("source-video:https://a/reel/1", "F")[0]).toBe(
      `F/${hash}-video.mp4`
    );
  });
});
