import { describe, expect, it } from "vitest";
import { scanClipping } from "../src/scan";
import {
  COMBOLANDS_BODY,
  COMBOLANDS_FM,
  MANGA_BODY,
  MANGA_FM,
  NOOK_BODY,
  NOOK_FM,
} from "./fixtures/clippings";

describe("scanClipping", () => {
  it("pulls metadata off the clipper frontmatter", () => {
    const r = scanClipping("Clippings/Combolands.md", COMBOLANDS_FM, COMBOLANDS_BODY);
    expect(r.path).toBe("Clippings/Combolands.md");
    expect(r.title).toContain("Cities: Skylines");
    expect(r.source).toBe("https://www.polygon.com/combolands-demo-preview-impressions/");
    expect(r.categories).toEqual(["games", "roguelike", "indie"]);
    expect(r.status).toBe("unread");
    expect(r.created).toBe("2026-08-14");
  });

  it("finds markdown images in document order", () => {
    const r = scanClipping("Clippings/Combolands.md", COMBOLANDS_FM, COMBOLANDS_BODY);
    expect(r.media).toHaveLength(4);
    expect(r.media[0].kind).toBe("image");
    expect(r.media[0].alt).toBe("A snowy city in Combolands");
    expect(r.media[0].url).toContain("combolands-7.jpg");
  });

  it("parses the width hint out of the query string", () => {
    const r = scanClipping("Clippings/Combolands.md", COMBOLANDS_FM, COMBOLANDS_BODY);
    expect(r.media[0].widthHint).toBe(750);
    expect(r.media[2].widthHint).toBe(1920);
  });

  it("finds both markdown and html images, and ignores fenced code", () => {
    const r = scanClipping("Clippings/Manga.md", MANGA_FM, MANGA_BODY);
    expect(r.media).toHaveLength(2);
    expect(r.media[0].url).toContain("prompt.gif");
    expect(r.media[1].url).toContain("download.gif");
    expect(r.media[1].alt).toBe("download img");
    expect(r.media.some((m) => m.url.includes("mangadex.org"))).toBe(false);
  });

  it("finds video tags", () => {
    const r = scanClipping("Clippings/Nook.md", NOOK_FM, NOOK_BODY);
    expect(r.media).toHaveLength(1);
    expect(r.media[0].kind).toBe("video");
    expect(r.media[0].url).toContain(".mp4");
  });

  it("builds a lowercase search haystack from title, description and domain", () => {
    const r = scanClipping("Clippings/Nook.md", NOOK_FM, NOOK_BODY);
    expect(r.haystack).toContain("nook - write mode");
    expect(r.haystack).toContain("spottedinprod.com");
    expect(r.haystack).toContain("design");
  });

  it("skips data URIs and vault-relative links", () => {
    const body = "![a](data:image/png;base64,AAAA)\n![b](Attachments/local.png)\n![[embed.png]]";
    const r = scanClipping("Clippings/X.md", NOOK_FM, body);
    expect(r.media).toHaveLength(0);
  });

  it("tolerates missing frontmatter fields", () => {
    const r = scanClipping("Clippings/X.md", {}, "");
    expect(r.title).toBe("X");
    expect(r.categories).toEqual([]);
    expect(r.status).toBe("unread");
    expect(r.media).toEqual([]);
  });
});
