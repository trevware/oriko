import { describe, expect, it } from "vitest";
import { derivedTarget, posterPath, previewPath, scaledSize, thumbPath } from "../src/core/derive";

describe("thumbPath", () => {
  it("appends a thumb suffix before the extension", () => {
    expect(thumbPath("Attachments/Clippings/abc-a.jpg")).toBe(
      "Attachments/Clippings/abc-a.thumb.webp"
    );
  });

  it("handles files with no extension", () => {
    expect(thumbPath("Attachments/Clippings/abc")).toBe("Attachments/Clippings/abc.thumb.webp");
  });

  it("is not confused by a dot in a folder name", () => {
    expect(thumbPath("My.Files/abc")).toBe("My.Files/abc.thumb.webp");
  });
});

describe("posterPath", () => {
  it("appends a poster suffix before the extension", () => {
    expect(posterPath("Attachments/Clippings/abc-clip.mp4")).toBe(
      "Attachments/Clippings/abc-clip.poster.webp"
    );
  });

  it("differs from the thumb path for the same file", () => {
    expect(posterPath("a/b.mp4")).not.toBe(thumbPath("a/b.mp4"));
  });
});

describe("scaledSize", () => {
  it("scales down to the target width and preserves the ratio", () => {
    expect(scaledSize(1920, 1080, 400)).toEqual({ width: 400, height: 225 });
  });

  it("never upscales", () => {
    expect(scaledSize(200, 100, 400)).toEqual({ width: 200, height: 100 });
  });

  it("guards against zero dimensions", () => {
    expect(scaledSize(0, 0, 400)).toEqual({ width: 400, height: 400 });
  });

  it("rounds to whole pixels", () => {
    expect(Number.isInteger(scaledSize(1000, 333, 400).height)).toBe(true);
  });

  it("handles the real portrait video shape", () => {
    expect(scaledSize(886, 1920, 400)).toEqual({ width: 400, height: 867 });
  });
});

describe("previewPath", () => {
  it("appends a preview suffix before the extension", () => {
    expect(previewPath("Attachments/Clippings/abc-shot.heic")).toBe(
      "Attachments/Clippings/abc-shot.preview.png"
    );
  });

  it("handles files with no extension", () => {
    expect(previewPath("Attachments/Clippings/abc")).toBe(
      "Attachments/Clippings/abc.preview.png"
    );
  });
});

describe("derivedTarget", () => {
  const dir = "Attachments/Clippings/abc123abc123-";

  it("converts formats the page cannot decode into a png preview", () => {
    expect(derivedTarget(`${dir}a.heic`, "image")).toEqual({ path: `${dir}a.preview.png`, via: "convert" });
    expect(derivedTarget(`${dir}a.avi`, "video")).toEqual({ path: `${dir}a.preview.png`, via: "convert" });
  });

  it("draws an svg into a still, so the markup itself is never painted", () => {
    expect(derivedTarget(`${dir}og.svg`, "image")).toEqual({ path: `${dir}og.thumb.webp`, via: "draw" });
  });

  it("gives a video a poster and a gif a still to freeze on", () => {
    expect(derivedTarget(`${dir}a.mp4`, "video")).toEqual({ path: `${dir}a.poster.webp`, via: "draw" });
    expect(derivedTarget(`${dir}a.gif`, "image")).toEqual({ path: `${dir}a.thumb.webp`, via: "draw" });
  });

  it("leaves a plain image alone", () => {
    expect(derivedTarget(`${dir}a.jpg`, "image")).toBeNull();
  });
});
