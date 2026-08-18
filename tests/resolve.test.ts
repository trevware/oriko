import { describe, expect, it } from "vitest";
import {
  cleanUrl,
  directMediaKind,
  directMediaLink,
  fxApiUrl,
  instagramPost,
  isHttpUrl,
  noteNameFor,
  parseFxTweet,
  parsePageMeta,
  sourceVideoKey,
  supportsSourceDownload,
  xStatus,
} from "../src/resolve";

describe("cleanUrl", () => {
  it("strips the share parameter you get from a copy button", () => {
    expect(cleanUrl("https://x.com/a/status/123?s=20")).toBe("https://x.com/a/status/123");
  });

  it("strips utm parameters", () => {
    expect(cleanUrl("https://e.com/a?utm_source=x&utm_medium=y")).toBe("https://e.com/a");
  });

  it("keeps parameters that identify content", () => {
    expect(cleanUrl("https://youtube.com/watch?v=abc&s=20")).toBe(
      "https://youtube.com/watch?v=abc"
    );
  });

  it("trims surrounding whitespace from a paste", () => {
    expect(cleanUrl("  https://e.com/a  ")).toBe("https://e.com/a");
  });

  it("returns unparseable input unchanged", () => {
    expect(cleanUrl("not a url")).toBe("not a url");
  });
});

describe("isHttpUrl", () => {
  it("accepts http and https", () => {
    expect(isHttpUrl("https://e.com")).toBe(true);
    expect(isHttpUrl("http://e.com")).toBe(true);
  });

  it("rejects other schemes and plain text", () => {
    expect(isHttpUrl("obsidian://open")).toBe(false);
    expect(isHttpUrl("file:///tmp/a")).toBe(false);
    expect(isHttpUrl("just some copied text")).toBe(false);
    expect(isHttpUrl("")).toBe(false);
  });
});

describe("xStatus", () => {
  it("recognises an x.com status", () => {
    expect(xStatus("https://x.com/eduardwieandt/status/2089380732896768126")).toEqual({
      user: "eduardwieandt",
      id: "2089380732896768126",
    });
  });

  it("recognises twitter.com and mobile hosts", () => {
    expect(xStatus("https://twitter.com/a/status/123456")?.user).toBe("a");
    expect(xStatus("https://mobile.x.com/a/status/123456")?.user).toBe("a");
  });

  it("ignores query parameters", () => {
    expect(xStatus("https://x.com/a/status/123456?s=20")?.id).toBe("123456");
  });

  it("returns null for a profile url", () => {
    expect(xStatus("https://x.com/eduardwieandt")).toBeNull();
  });

  it("returns null for another host", () => {
    expect(xStatus("https://www.threads.com/@a/post/B")).toBeNull();
  });

  it("builds the resolver endpoint", () => {
    expect(fxApiUrl({ user: "a", id: "123" })).toBe("https://api.fxtwitter.com/a/status/123");
  });
});

describe("parseFxTweet", () => {
  const payload = {
    tweet: {
      url: "https://x.com/eduardwieandt/status/2089380732896768126",
      text: "What if you could just slide away the input when you want to read?\nSecond line",
      created_at: "Mon Aug 11 09:00:00 +0000 2026",
      author: { name: "Eduard" },
      media: {
        videos: [{ type: "video", url: "https://video.twimg.com/a/38KA2aK29RyqEM5a.mp4?tag=29" }],
        all: [{ type: "video", url: "https://video.twimg.com/a/38KA2aK29RyqEM5a.mp4?tag=29" }],
      },
    },
  };

  it("pulls the video url out", () => {
    const out = parseFxTweet(payload, "https://x.com/x/status/1")!;
    expect(out.media).toHaveLength(1);
    expect(out.media[0].kind).toBe("video");
    expect(out.media[0].url).toContain(".mp4");
  });

  it("does not repeat media listed under several keys", () => {
    expect(parseFxTweet(payload, "")!.media).toHaveLength(1);
  });

  it("uses the author and first line of text as the title", () => {
    const out = parseFxTweet(payload, "")!;
    expect(out.title).toContain("Eduard");
    expect(out.title).toContain("slide away the input");
    expect(out.title).not.toContain("Second line");
  });

  it("keeps the full text as the description", () => {
    expect(parseFxTweet(payload, "")!.description).toContain("Second line");
  });

  it("caps the title length", () => {
    const long = {
      tweet: { ...payload.tweet, text: "x".repeat(400), media: {} },
    };
    expect(parseFxTweet(long, "")!.title.length).toBeLessThanOrEqual(120);
  });

  it("classifies photos as images", () => {
    const photos = {
      tweet: { ...payload.tweet, media: { photos: [{ type: "photo", url: "https://p/1.jpg" }] } },
    };
    expect(parseFxTweet(photos, "")!.media[0].kind).toBe("image");
  });

  it("returns a link with no media when the post has none", () => {
    const bare = { tweet: { ...payload.tweet, media: {} } };
    expect(parseFxTweet(bare, "")!.media).toEqual([]);
  });

  it("returns null for a malformed payload", () => {
    expect(parseFxTweet(null, "")).toBeNull();
    expect(parseFxTweet({}, "")).toBeNull();
    expect(parseFxTweet({ tweet: "nope" }, "")).toBeNull();
  });

  it("falls back to the source url when the payload has none", () => {
    const noUrl = { tweet: { ...payload.tweet, url: undefined } };
    expect(parseFxTweet(noUrl, "https://fallback")!.url).toBe("https://fallback");
  });
});

describe("parsePageMeta", () => {
  const base = "https://www.threads.com/@a/post/B";

  it("reads title, description and image", () => {
    const html =
      '<meta property="og:title" content="A post">' +
      '<meta property="og:description" content="Some words">' +
      '<meta property="og:image" content="https://cdn/a.jpg">';
    const out = parsePageMeta(html, base);
    expect(out.title).toBe("A post");
    expect(out.description).toBe("Some words");
    expect(out.media).toEqual([{ url: "https://cdn/a.jpg", kind: "image" }]);
  });

  it("puts video ahead of the poster image", () => {
    const html =
      '<meta property="og:image" content="https://cdn/a.jpg">' +
      '<meta property="og:video" content="https://cdn/a.mp4">';
    const out = parsePageMeta(html, base);
    expect(out.media[0].kind).toBe("video");
    expect(out.media[1].kind).toBe("image");
  });

  it("prefers the secure video url", () => {
    const html =
      '<meta property="og:video" content="http://cdn/a.mp4">' +
      '<meta property="og:video:secure_url" content="https://cdn/a.mp4">';
    expect(parsePageMeta(html, base).media[0].url).toBe("https://cdn/a.mp4");
  });

  it("resolves relative urls against the page", () => {
    expect(parsePageMeta('<meta property="og:image" content="/a.jpg">', base).media[0].url).toBe(
      "https://www.threads.com/a.jpg"
    );
  });

  it("does not repeat an image declared twice", () => {
    const html =
      '<meta property="og:image" content="https://cdn/a.jpg">' +
      '<meta name="twitter:image" content="https://cdn/a.jpg">';
    expect(parsePageMeta(html, base).media).toHaveLength(1);
  });

  it("returns empty media for a page with no tags", () => {
    expect(parsePageMeta("<html></html>", base).media).toEqual([]);
  });
});

describe("noteNameFor", () => {
  it("uses the title", () => {
    expect(noteNameFor("A good post", "https://e.com/a")).toBe("A good post");
  });

  it("strips characters that break vault paths", () => {
    expect(noteNameFor('a/b:c*d?"e<f>g|h#i^j[k]', "https://e.com")).not.toMatch(
      /[\\/:*?"<>|#^[\]]/
    );
  });

  it("collapses whitespace", () => {
    expect(noteNameFor("a    b", "https://e.com")).toBe("a b");
  });

  it("caps the length", () => {
    expect(noteNameFor("x".repeat(300), "https://e.com").length).toBeLessThanOrEqual(100);
  });

  it("falls back to the url when there is no title", () => {
    expect(noteNameFor("", "https://x.com/a/status/123")).toBe("x.com a status 123");
  });

  it("never returns an empty name", () => {
    expect(noteNameFor("", "not a url")).toBe("Untitled clipping");
    expect(noteNameFor("///", "not a url")).toBe("Untitled clipping");
  });
});

describe("directMediaKind", () => {
  it("recognises a video url", () => {
    expect(directMediaKind("https://cdn/a.mp4")).toBe("video");
    expect(directMediaKind("https://cdn/a.webm")).toBe("video");
  });

  it("recognises an image url", () => {
    expect(directMediaKind("https://cdn/a.jpg")).toBe("image");
    expect(directMediaKind("https://cdn/a.PNG")).toBe("image");
  });

  it("sees through a long signed query string", () => {
    const fbcdn =
      "https://instagram.fymq2-1.fna.fbcdn.net/o1/v/t16/f2/m84/AQMh5iLz.mp4?_nc_cat=104&oe=6A8576AC";
    expect(directMediaKind(fbcdn)).toBe("video");
  });

  it("returns null for a page url", () => {
    expect(directMediaKind("https://www.threads.com/@a/post/B")).toBeNull();
    expect(directMediaKind("https://x.com/a/status/123")).toBeNull();
  });

  it("returns null for unparseable input", () => {
    expect(directMediaKind("not a url")).toBeNull();
  });
});

describe("directMediaLink", () => {
  it("uses the filename in the title", () => {
    expect(directMediaLink("https://cdn/clip.mp4", "video").title).toBe("Video: clip.mp4");
  });

  it("falls back to the host when there is no filename", () => {
    expect(directMediaLink("https://cdn.example.com/", "image").title).toBe(
      "Image from cdn.example.com"
    );
  });

  it("carries exactly one media item of the given kind", () => {
    const out = directMediaLink("https://cdn/a.mp4", "video");
    expect(out.media).toEqual([{ url: "https://cdn/a.mp4", kind: "video" }]);
  });
});

describe("instagramPost", () => {
  it("recognises a reel", () => {
    expect(instagramPost("https://www.instagram.com/reel/DaX4yElxg7_/")).toEqual({
      kind: "reel",
      code: "DaX4yElxg7_",
    });
  });

  it("normalises the plural reels path", () => {
    expect(instagramPost("https://www.instagram.com/reels/DaX4yElxg7_/")?.kind).toBe("reel");
  });

  it("recognises a post and a tv url", () => {
    expect(instagramPost("https://instagram.com/p/ABC12345/")?.kind).toBe("p");
    expect(instagramPost("https://instagram.com/tv/ABC12345/")?.kind).toBe("tv");
  });

  it("ignores query parameters", () => {
    expect(instagramPost("https://www.instagram.com/reel/DaX4yElxg7_/?igsh=x")?.code).toBe(
      "DaX4yElxg7_"
    );
  });

  it("returns null for a profile or another host", () => {
    expect(instagramPost("https://www.instagram.com/someuser/")).toBeNull();
    expect(instagramPost("https://www.threads.com/@a/post/B")).toBeNull();
    expect(instagramPost("not a url")).toBeNull();
  });

  it("marks instagram and x as downloadable by a local yt-dlp", () => {
    expect(supportsSourceDownload("https://www.instagram.com/reel/ABC/")).toBe(true);
    expect(supportsSourceDownload("https://x.com/a/status/1")).toBe(true);
  });

  it("does not spend a subprocess on an ordinary article", () => {
    expect(supportsSourceDownload("https://www.polygon.com/article")).toBe(false);
    expect(supportsSourceDownload("not a url")).toBe(false);
  });

  it("keys a page-sourced video apart from the page's own preview image", () => {
    expect(sourceVideoKey("https://x.com/a/status/1")).not.toBe("https://x.com/a/status/1");
  });
});
