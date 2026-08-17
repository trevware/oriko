import { describe, expect, it } from "vitest";
import { scanClipping } from "../src/scan";
import {
  COMBOLANDS_BODY,
  COMBOLANDS_FM,
  MANGA_BODY,
  MANGA_FM,
  NOOK_BODY,
  NOOK_FM,
  RACHEL_BODY,
  RACHEL_FM,
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

  it("finds video declared with a nested source element", () => {
    const r = scanClipping("Clippings/Rachel How.md", RACHEL_FM, RACHEL_BODY);
    expect(r.media).toHaveLength(2);
    expect(r.media[0].kind).toBe("video");
    expect(r.media[0].url).toContain("interfaces-new.mp4");
    expect(r.media[1].url).toContain("tinycamp.mp4");
  });

  it("falls back to aria-label when a video has no alt", () => {
    const r = scanClipping("Clippings/Rachel How.md", RACHEL_FM, RACHEL_BODY);
    expect(r.media[0].alt).toBe("interfaces.new");
  });

  it("prefers src on the video tag over a nested source", () => {
    const body =
      '<video src="https://x.com/outer.mp4"><source src="https://x.com/inner.mp4"></video>';
    const r = scanClipping("Clippings/X.md", NOOK_FM, body);
    expect(r.media).toHaveLength(1);
    expect(r.media[0].url).toContain("outer.mp4");
  });

  it("still finds a self-closing video tag with src", () => {
    const r = scanClipping("Clippings/X.md", NOOK_FM, '<video src="https://x.com/a.mp4" />');
    expect(r.media).toHaveLength(1);
    expect(r.media[0].kind).toBe("video");
  });

  it("ignores a video element with no resolvable source", () => {
    const r = scanClipping("Clippings/X.md", NOOK_FM, "<video controls=''></video>");
    expect(r.media).toHaveLength(0);
  });

  it("does not treat a picture source as video", () => {
    const body =
      '<picture><source srcset="https://x.com/a.webp"><img src="https://x.com/a.jpg"></picture>';
    const r = scanClipping("Clippings/X.md", NOOK_FM, body);
    expect(r.media).toHaveLength(1);
    expect(r.media[0].kind).toBe("image");
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
