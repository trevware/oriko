import { describe, expect, it } from "vitest";
import { extractPageImage, knownHostThumbnail, needsPageCover } from "../src/page-cover";

describe("knownHostThumbnail", () => {
  it("resolves a standard youtube watch url", () => {
    expect(knownHostThumbnail("https://www.youtube.com/watch?v=BZZoL_IoBZs")).toEqual({
      url: "https://img.youtube.com/vi/BZZoL_IoBZs/maxresdefault.jpg",
      fallbacks: [
        "https://img.youtube.com/vi/BZZoL_IoBZs/hq720.jpg",
        "https://img.youtube.com/vi/BZZoL_IoBZs/hqdefault.jpg",
      ],
    });
  });

  it("ignores extra query parameters", () => {
    const out = knownHostThumbnail("https://www.youtube.com/watch?v=BZZoL_IoBZs&t=42s&list=PL1");
    expect(out?.url).toContain("/vi/BZZoL_IoBZs/");
  });

  it("resolves a youtu.be short link", () => {
    expect(knownHostThumbnail("https://youtu.be/BZZoL_IoBZs")?.url).toContain(
      "/vi/BZZoL_IoBZs/"
    );
  });

  it("resolves an embed url", () => {
    expect(knownHostThumbnail("https://www.youtube.com/embed/BZZoL_IoBZs")?.url).toContain(
      "/vi/BZZoL_IoBZs/"
    );
  });

  it("resolves a shorts url", () => {
    expect(knownHostThumbnail("https://www.youtube.com/shorts/BZZoL_IoBZs")?.url).toContain(
      "/vi/BZZoL_IoBZs/"
    );
  });

  it("resolves the nocookie domain", () => {
    expect(
      knownHostThumbnail("https://www.youtube-nocookie.com/embed/BZZoL_IoBZs")?.url
    ).toContain("/vi/BZZoL_IoBZs/");
  });

  it("returns null for a non-video host", () => {
    expect(knownHostThumbnail("https://www.polygon.com/article")).toBeNull();
  });

  it("returns null for a youtube url with no video id", () => {
    expect(knownHostThumbnail("https://www.youtube.com/feed/subscriptions")).toBeNull();
  });

  it("returns null for an unparseable url", () => {
    expect(knownHostThumbnail("not a url")).toBeNull();
  });

  it("rejects an id of the wrong shape", () => {
    expect(knownHostThumbnail("https://youtu.be/toolongtobeavalidyoutubeid123")).toBeNull();
  });
});

describe("extractPageImage", () => {
  const base = "https://example.com/article";

  it("reads og:image from a property attribute", () => {
    const html = '<meta property="og:image" content="https://cdn.example.com/a.jpg">';
    expect(extractPageImage(html, base)).toBe("https://cdn.example.com/a.jpg");
  });

  it("reads og:image when the attributes are reversed", () => {
    const html = '<meta content="https://cdn.example.com/a.jpg" property="og:image">';
    expect(extractPageImage(html, base)).toBe("https://cdn.example.com/a.jpg");
  });

  it("accepts name instead of property", () => {
    const html = '<meta name="og:image" content="https://cdn.example.com/a.jpg">';
    expect(extractPageImage(html, base)).toBe("https://cdn.example.com/a.jpg");
  });

  it("falls back to twitter:image", () => {
    const html = '<meta name="twitter:image" content="https://cdn.example.com/t.jpg">';
    expect(extractPageImage(html, base)).toBe("https://cdn.example.com/t.jpg");
  });

  it("prefers og:image over twitter:image", () => {
    const html =
      '<meta name="twitter:image" content="https://cdn.example.com/t.jpg">' +
      '<meta property="og:image" content="https://cdn.example.com/o.jpg">';
    expect(extractPageImage(html, base)).toBe("https://cdn.example.com/o.jpg");
  });

  it("resolves a root-relative url against the page", () => {
    const html = '<meta property="og:image" content="/images/a.jpg">';
    expect(extractPageImage(html, base)).toBe("https://example.com/images/a.jpg");
  });

  it("resolves a protocol-relative url", () => {
    const html = '<meta property="og:image" content="//cdn.example.com/a.jpg">';
    expect(extractPageImage(html, base)).toBe("https://cdn.example.com/a.jpg");
  });

  it("decodes html entities in the url", () => {
    const html = '<meta property="og:image" content="https://x.com/a.jpg?w=1&amp;h=2">';
    expect(extractPageImage(html, base)).toBe("https://x.com/a.jpg?w=1&h=2");
  });

  it("handles single-quoted attributes", () => {
    const html = "<meta property='og:image' content='https://cdn.example.com/a.jpg'>";
    expect(extractPageImage(html, base)).toBe("https://cdn.example.com/a.jpg");
  });

  it("returns null when the page declares no image", () => {
    expect(extractPageImage("<html><head><title>x</title></head></html>", base)).toBeNull();
  });

  it("returns null for an empty document", () => {
    expect(extractPageImage("", base)).toBeNull();
  });

  it("ignores an empty content attribute", () => {
    expect(extractPageImage('<meta property="og:image" content="">', base)).toBeNull();
  });

  it("does not match a different og property", () => {
    const html = '<meta property="og:image:width" content="1200">';
    expect(extractPageImage(html, base)).toBeNull();
  });
});

describe("needsPageCover", () => {
  const source = "https://x.com/someone/status/2089473141126922435";

  const record = {
    source,
    media: [{ url: "https://pbs.twimg.com/media/abc?format=jpg", kind: "image" as const, alt: "" }],
  };

  const nothingArchived = () => undefined;

  it("wants one when the clipping has archived nothing at all", () => {
    expect(needsPageCover(record, nothingArchived)).toBe(true);
  });

  it("wants nothing for a clipping with no source to ask about", () => {
    expect(needsPageCover({ source: "", media: [] }, nothingArchived)).toBe(false);
  });

  it("skips it when an inline image of the clipping is already archived", () => {
    const archived = (key: string) => (key.includes("pbs.twimg.com") ? "f.jpg" : undefined);
    expect(needsPageCover(record, archived)).toBe(false);
  });

  it("skips it once the post's own video has been pulled", () => {
    // tile.ts prefers that video, so the page's still would never be shown.
    const archived = (key: string) => (key.startsWith("ytdlp:") ? "video.mp4" : undefined);
    expect(needsPageCover(record, archived)).toBe(false);
  });
});
