import { describe, expect, it } from "vitest";
import { dedupeMedia, normalizeUrl, sourceVideoKeyFor } from "../src/core/normalize";
import { scanClipping } from "../src/core/scan";
import { COMBOLANDS_BODY, COMBOLANDS_FM } from "./fixtures/clippings";
import type { MediaRef } from "../src/core/scan";

describe("normalizeUrl", () => {
  it("strips sizing query parameters", () => {
    expect(normalizeUrl("https://x.com/a.jpg?q=49&fit=contain&w=750&h=422&dpr=2")).toBe(
      "https://x.com/a.jpg"
    );
  });

  it("collapses the same asset requested at two sizes", () => {
    const small = normalizeUrl("https://x.com/a.jpg?w=750&h=422&dpr=2");
    const large = normalizeUrl("https://x.com/a.jpg?w=1920&h=1080&dpr=2");
    expect(small).toBe(large);
  });

  it("keeps query parameters that are not about size", () => {
    expect(normalizeUrl("https://x.com/a.jpg?token=abc")).toBe("https://x.com/a.jpg?token=abc");
  });

  it("drops the fragment and lowercases the host", () => {
    expect(normalizeUrl("https://X.COM/a.jpg#frag")).toBe("https://x.com/a.jpg");
  });

  it("returns the input unchanged when it will not parse", () => {
    expect(normalizeUrl("not a url")).toBe("not a url");
  });
});

describe("dedupeMedia", () => {
  it("collapses Combolands duplicates and keeps the largest variant", () => {
    const record = scanClipping("Clippings/C.md", COMBOLANDS_FM, COMBOLANDS_BODY);
    const canonical = dedupeMedia(record.media);
    expect(canonical).toHaveLength(2);
    expect(canonical[0].url).toContain("w=1920");
    expect(canonical[1].url).toContain("w=1920");
  });

  it("collapses three size tiers to the largest, as the real vault serves them", () => {
    const refs: MediaRef[] = [750, 1920, 2560].map((w) => ({
      url: `https://static0.polygonimages.com/a/combolands-7.jpg?q=49&fit=contain&w=${w}&h=422&dpr=2`,
      kind: "image",
      alt: "A snowy city",
      widthHint: w,
    }));
    const canonical = dedupeMedia(refs);
    expect(canonical).toHaveLength(1);
    expect(canonical[0].url).toContain("w=2560");
  });

  it("preserves first-appearance order", () => {
    const record = scanClipping("Clippings/C.md", COMBOLANDS_FM, COMBOLANDS_BODY);
    const canonical = dedupeMedia(record.media);
    expect(canonical[0].url).toContain("combolands-7.jpg");
    expect(canonical[1].url).toContain("combolands-6.jpg");
  });

  it("keys each entry by the normalized url", () => {
    const canonical = dedupeMedia([
      { url: "https://x.com/a.jpg?w=750", kind: "image", alt: "", widthHint: 750 },
    ]);
    expect(canonical[0].key).toBe("https://x.com/a.jpg");
  });

  it("keeps the first alt text it saw", () => {
    const canonical = dedupeMedia([
      { url: "https://x.com/a.jpg?w=750", kind: "image", alt: "first", widthHint: 750 },
      { url: "https://x.com/a.jpg?w=1920", kind: "image", alt: "second", widthHint: 1920 },
    ]);
    expect(canonical[0].alt).toBe("first");
    expect(canonical[0].url).toContain("w=1920");
  });

  it("leaves distinct assets alone", () => {
    const canonical = dedupeMedia([
      { url: "https://x.com/a.jpg", kind: "image", alt: "" },
      { url: "https://x.com/b.jpg", kind: "image", alt: "" },
    ]);
    expect(canonical).toHaveLength(2);
  });

  it("returns an empty list for no refs", () => {
    expect(dedupeMedia([])).toEqual([]);
  });
});

describe("signed CDN urls", () => {
  it("collapses two signed instagram urls for the same asset", () => {
    const a =
      "https://scontent.cdninstagram.com/v/t51/731823694_n.jpg?stp=cmp1_dst-jpg&_nc_cat=110&_nc_gid=AAA&oh=00_X&oe=6A897B02";
    const b =
      "https://scontent.cdninstagram.com/v/t51/731823694_n.jpg?stp=c0.594.1&_nc_cat=107&_nc_gid=BBB&oh=00_Y&oe=6A899999";
    expect(normalizeUrl(a)).toBe(normalizeUrl(b));
  });

  it("collapses a twitter video url across tag values", () => {
    expect(normalizeUrl("https://video.twimg.com/a/b.mp4?tag=29")).toBe(
      normalizeUrl("https://video.twimg.com/a/b.mp4?tag=31")
    );
  });

  it("still separates genuinely different assets on the same host", () => {
    expect(normalizeUrl("https://scontent.cdninstagram.com/v/t51/aaa.jpg?oh=1")).not.toBe(
      normalizeUrl("https://scontent.cdninstagram.com/v/t51/bbb.jpg?oh=1")
    );
  });

  it("leaves a meaningful parameter alone", () => {
    expect(normalizeUrl("https://youtube.com/watch?v=abc&oh=1")).toBe(
      "https://youtube.com/watch?v=abc"
    );
  });
});

describe("sourceVideoKeyFor", () => {
  it("keys a page-sourced video apart from the page itself", () => {
    expect(sourceVideoKeyFor("https://x.com/a/status/1")).not.toBe("https://x.com/a/status/1");
  });

  it("normalises the source, so a tracking parameter cannot split the key", () => {
    expect(sourceVideoKeyFor("https://x.com/a/status/1?oh=1")).toBe(
      sourceVideoKeyFor("https://x.com/a/status/1")
    );
  });
});

describe("normalizeUrl on Amazon images", () => {
  it("keys every rendition of a product image to its original", () => {
    const original = "https://m.media-amazon.com/images/I/61f8IVzjEDL.jpg";
    expect(normalizeUrl("https://m.media-amazon.com/images/I/61f8IVzjEDL._SL1000_.jpg")).toBe(original);
    expect(normalizeUrl("https://m.media-amazon.com/images/I/61f8IVzjEDL._SY522_.jpg")).toBe(original);
    expect(normalizeUrl(original)).toBe(original);
  });
});
