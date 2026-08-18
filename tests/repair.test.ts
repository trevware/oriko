import { describe, expect, it } from "vitest";
import { MediaCache } from "../src/cache";
import { localReplacement } from "../src/normalize";

function cache(): MediaCache {
  const c = new MediaCache();
  c.set({
    key: "https://x.com/a.jpg",
    file: "Attachments/Clippings/abc-a.jpg",
    thumb: "Attachments/Clippings/abc-a.thumb.webp",
    kind: "image",
    width: 100,
    height: 100,
    bytes: 1,
  });
  return c;
}

describe("localReplacement", () => {
  it("finds the archived original for an exact url", () => {
    expect(localReplacement("https://x.com/a.jpg", cache())).toBe(
      "Attachments/Clippings/abc-a.jpg"
    );
  });

  it("finds it for a size variant of the same url", () => {
    expect(localReplacement("https://x.com/a.jpg?w=750&h=422&dpr=2", cache())).toBe(
      "Attachments/Clippings/abc-a.jpg"
    );
  });

  it("finds it for a re-signed CDN url", () => {
    const c = new MediaCache();
    c.set({
      key: "https://scontent.cdninstagram.com/v/t51/a.jpg",
      file: "Attachments/Clippings/xyz-a.jpg",
      thumb: "",
      kind: "image",
      width: 1,
      height: 1,
      bytes: 1,
    });
    expect(
      localReplacement("https://scontent.cdninstagram.com/v/t51/a.jpg?oh=00_X&oe=6A89", c)
    ).toBe("Attachments/Clippings/xyz-a.jpg");
  });

  it("returns the original rather than the thumbnail", () => {
    expect(localReplacement("https://x.com/a.jpg", cache())).not.toContain("thumb");
  });

  it("returns null for an unknown url", () => {
    expect(localReplacement("https://x.com/other.jpg", cache())).toBeNull();
  });

  it("returns null when the archive failed", () => {
    const c = new MediaCache();
    c.mergeOutcome({ key: "https://x.com/a.jpg", kind: "image", failed: "HTTP 404" });
    expect(localReplacement("https://x.com/a.jpg", c)).toBeNull();
  });

  it("ignores a src that is already local", () => {
    expect(localReplacement("app://local/whatever.jpg", cache())).toBeNull();
    expect(localReplacement("", cache())).toBeNull();
  });
});
