import { describe, expect, it } from "vitest";
import { dedupeMedia, normalizeUrl } from "../src/normalize";
import { scanClipping } from "../src/scan";
import { COMBOLANDS_BODY, COMBOLANDS_FM } from "./fixtures/clippings";
import type { MediaRef } from "../src/scan";

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
