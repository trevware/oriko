import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  amazonOriginal,
  amazonProduct,
  cleanUrl,
  directMediaKind,
  directMediaLink,
  firstHttpUrl,
  isThreadsUrl,
  pickSniffedVideo,
  sharedHttpUrl,
  fxApiUrl,
  instagramPost,
  isHttpUrl,
  noteNameFor,
  parseAmazonPage,
  parseFxTweet,
  parsePageMeta,
  supportsSourceDownload,
  xStatus,
} from "../src/core/resolve";

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


});

describe("amazonProduct", () => {
  it("recognises a product page on any Amazon storefront", () => {
    expect(amazonProduct("https://www.amazon.ca/Putting-Out-Your-Mind-Rotella/dp/0743212134")).toEqual(
      { asin: "0743212134" }
    );
    expect(amazonProduct("https://www.amazon.co.uk/gp/product/B08N5WRWNW?th=1")).toEqual({
      asin: "B08N5WRWNW",
    });
    expect(amazonProduct("https://amazon.com/dp/B08N5WRWNW/ref=sr_1_1")).toEqual({
      asin: "B08N5WRWNW",
    });
  });

  it("ignores the rest of Amazon, and the rest of the web", () => {
    expect(amazonProduct("https://www.amazon.ca/s?k=golf")).toBeNull();
    expect(amazonProduct("https://www.amazonaws.com/dp/B08N5WRWNW")).toBeNull();
    expect(amazonProduct("https://example.com/dp/B08N5WRWNW")).toBeNull();
    expect(amazonProduct("not a url")).toBeNull();
  });
});

describe("amazonOriginal", () => {
  it("strips the size modifier so the CDN serves the original", () => {
    expect(amazonOriginal("https://m.media-amazon.com/images/I/61f8IVzjEDL._SL1000_.jpg")).toBe(
      "https://m.media-amazon.com/images/I/61f8IVzjEDL.jpg"
    );
    expect(
      amazonOriginal("https://m.media-amazon.com/images/I/41LnLW+QvpL._SX38_SY50_CR,0,0,38,50_.jpg")
    ).toBe("https://m.media-amazon.com/images/I/41LnLW+QvpL.jpg");
  });

  it("leaves an image that has no modifier, or is not Amazon's, alone", () => {
    expect(amazonOriginal("https://m.media-amazon.com/images/I/61f8IVzjEDL.jpg")).toBe(
      "https://m.media-amazon.com/images/I/61f8IVzjEDL.jpg"
    );
    expect(amazonOriginal("https://example.com/a._SL1000_.jpg")).toBe("https://example.com/a._SL1000_.jpg");
  });
});

describe("parseAmazonPage", () => {
  const html = readFileSync(new URL("./fixtures/amazon-product.html", import.meta.url), "utf8");
  const url = "https://www.amazon.ca/Putting-Out-Your-Mind-Rotella/dp/0743212134";

  it("takes the hi-res cover at its original size", () => {
    const link = parseAmazonPage(html, url);
    expect(link.media).toEqual([
      { url: "https://m.media-amazon.com/images/I/61f8IVzjEDL.jpg", kind: "image" },
    ]);
  });

  it("titles the clipping by the product, not the storefront", () => {
    expect(parseAmazonPage(html, url).title).toBe("Putting Out of Your Mind");
  });

  it("falls back to the hiRes entry, then the page title, when the landing image is missing", () => {
    const stripped = html.replace(/data-old-hires="[^"]*"/, "").replace(/<span id="productTitle"[\s\S]*?<\/span>/, "");
    const link = parseAmazonPage(stripped, url);
    expect(link.media[0]?.url).toBe("https://m.media-amazon.com/images/I/61f8IVzjEDL.jpg");
    expect(link.title).toBe("Putting Out of Your Mind: Rotella, Dr. Bob: 9780743212137: Books");
  });

  it("gives up cleanly on a page with no cover", () => {
    expect(parseAmazonPage("<html><title>x</title></html>", url).media).toEqual([]);
  });
});

describe("parsePageMeta title fallback", () => {
  it("uses the document title when a page declares no og:title", () => {
    const link = parsePageMeta("<html><head><title>Plain &amp; simple</title></head></html>", "https://example.com/");
    expect(link.title).toBe("Plain & simple");
  });
});

describe("firstHttpUrl", () => {
  it("returns a bare URL as itself", () => {
    expect(firstHttpUrl("https://www.instagram.com/reel/abc/")).toBe(
      "https://www.instagram.com/reel/abc/"
    );
  });

  it("pulls the URL out of share-sheet prose", () => {
    expect(firstHttpUrl("Check this out! https://x.com/user/status/123 so good")).toBe(
      "https://x.com/user/status/123"
    );
  });

  it("takes the first URL when there are several", () => {
    expect(firstHttpUrl("https://a.com/1 and https://b.com/2")).toBe("https://a.com/1");
  });

  it("drops sentence punctuation stuck to the end", () => {
    expect(firstHttpUrl("look: https://a.com/post.")).toBe("https://a.com/post");
    expect(firstHttpUrl("(see https://a.com/post)")).toBe("https://a.com/post");
  });

  it("keeps query strings and fragments intact", () => {
    expect(firstHttpUrl("https://a.com/watch?v=x&t=1#top here")).toBe(
      "https://a.com/watch?v=x&t=1#top"
    );
  });

  it("returns null when there is no link at all", () => {
    expect(firstHttpUrl("just some words")).toBeNull();
    expect(firstHttpUrl("")).toBeNull();
  });

  it("ignores non-web schemes", () => {
    expect(firstHttpUrl("mailto:a@b.com ftp://x")).toBeNull();
  });
});

describe("sharedHttpUrl", () => {
  it("passes a clean URL or prose straight through firstHttpUrl", () => {
    expect(sharedHttpUrl("https://a.com/x")).toBe("https://a.com/x");
    expect(sharedHttpUrl("look https://a.com/x now")).toBe("https://a.com/x");
  });

  it("recovers a URL that arrived percent-encoded", () => {
    // iOS Shortcuts' Open URL action can re-encode an already-encoded
    // value, so the handler may receive the encoding instead of the URL.
    expect(sharedHttpUrl("https%3A%2F%2Fa.com%2Freel%2Fx%2F")).toBe("https://a.com/reel/x/");
  });

  it("recovers a URL that arrived encoded twice", () => {
    expect(sharedHttpUrl("https%253A%252F%252Fa.com%252Fx")).toBe("https://a.com/x");
  });

  it("keeps the recovered URL's own query intact", () => {
    expect(sharedHttpUrl("https%3A%2F%2Fa.com%2Freel%3Figsh%3Dabc")).toBe(
      "https://a.com/reel?igsh=abc"
    );
  });

  it("returns null for text with no URL under any decoding", () => {
    expect(sharedHttpUrl("just words")).toBeNull();
    expect(sharedHttpUrl("")).toBeNull();
    // A lone percent sign makes decodeURIComponent throw; that must not escape.
    expect(sharedHttpUrl("100% organic")).toBeNull();
  });
});

describe("isThreadsUrl", () => {
  it("matches threads.com and threads.net posts, www or bare", () => {
    expect(isThreadsUrl("https://www.threads.com/@radiofun8/post/Dco6LUokplj")).toBe(true);
    expect(isThreadsUrl("https://threads.net/@a/post/x")).toBe(true);
    expect(isThreadsUrl("https://www.threads.com/share/BAVz6_-9G3/")).toBe(true);
  });

  it("rejects other hosts and junk", () => {
    expect(isThreadsUrl("https://www.instagram.com/reel/x/")).toBe(false);
    expect(isThreadsUrl("not a url")).toBe(false);
  });
});

describe("pickSniffedVideo", () => {
  it("picks the first fetchable mp4 and strips byte-range windowing", () => {
    expect(
      pickSniffedVideo([
        "https://static.cdninstagram.com/rsrc.php/app.js",
        "https://scontent.cdninstagram.com/o1/v/t16/f2/m86/clip.mp4?efg=abc&bytestart=0&byteend=131071",
      ])
    ).toBe("https://scontent.cdninstagram.com/o1/v/t16/f2/m86/clip.mp4?efg=abc");
  });

  it("prefers the video element's own source when it is a real URL", () => {
    expect(
      pickSniffedVideo(["https://cdn.example.com/v/clip.mp4?sig=1", "https://cdn.example.com/other.mp4"])
    ).toBe("https://cdn.example.com/v/clip.mp4?sig=1");
  });

  it("ignores blob and data sources, which cannot be fetched", () => {
    expect(pickSniffedVideo(["blob:app://obsidian.md/uuid", "data:video/mp4;base64,AAAA"])).toBeNull();
  });

  it("ignores DASH segments and posters", () => {
    expect(
      pickSniffedVideo([
        "https://cdn.example.com/v/init.m4s",
        "https://cdn.example.com/v/poster.jpg",
      ])
    ).toBeNull();
  });

  it("returns null with nothing to pick", () => {
    expect(pickSniffedVideo([])).toBeNull();
    expect(pickSniffedVideo([""])).toBeNull();
  });
});
