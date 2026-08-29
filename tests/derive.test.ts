import { describe, expect, it } from "vitest";
import { posterPath, previewPath, scaledSize, thumbPath } from "../src/derive";

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
