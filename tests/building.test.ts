import { describe, expect, it } from "vitest";
import { advance, previewBlur, previewFor, stepIcon } from "../src/core/building";

describe("stepIcon", () => {
  it("gives each step of a clip its icon", () => {
    expect(stepIcon("Starting…")).toBe("link");
    expect(stepIcon("Reading link…")).toBe("link");
    expect(stepIcon("Downloading media…")).toBe("arrow-down-to-line");
    expect(stepIcon("Downloading 2/3…")).toBe("arrow-down-to-line");
    expect(stepIcon("Saving image…")).toBe("arrow-down-to-line");
    expect(stepIcon("Fetching video…")).toBe("video");
    expect(stepIcon("Saving video…")).toBe("video");
    expect(stepIcon("Rendering previews…")).toBe("image");
    expect(stepIcon("Loading page…")).toBe("scan-line");
    expect(stepIcon("Rendering scan…")).toBe("scan-line");
    expect(stepIcon("Saving scan…")).toBe("scan-line");
    expect(stepIcon("Creating clipping…")).toBe("file-plus");
    expect(stepIcon("Fetching store details…")).toBe("gamepad-2");
    expect(stepIcon("Clipped")).toBe("check");
  });

  it("falls back to a neutral icon for a step it does not know", () => {
    expect(stepIcon("Thinking about it…")).toBe("loader");
  });
});

describe("previewBlur", () => {
  it("runs from heavy to nearly sharp", () => {
    expect(previewBlur(0)).toBe(22);
    expect(previewBlur(0.5)).toBe(12);
    expect(previewBlur(1)).toBe(2);
  });

  it("clamps progress outside the run", () => {
    expect(previewBlur(-1)).toBe(22);
    expect(previewBlur(4)).toBe(2);
  });
});

describe("advance", () => {
  it("never goes backwards", () => {
    expect(advance(0.5, 0.3)).toBe(0.5);
    expect(advance(0.5, 0.8)).toBe(0.8);
    expect(advance(0.5, null)).toBe(0.5);
    expect(advance(0.5, 3)).toBe(1);
  });
});

describe("previewFor", () => {
  it("takes the first image", () => {
    const media = [
      { url: "https://x/v.mp4", kind: "video" as const },
      { url: "https://x/a.jpg", kind: "image" as const },
    ];
    expect(previewFor(media, "https://example.com")).toBe("https://x/a.jpg");
  });

  it("falls back to a video host's thumbnail", () => {
    expect(previewFor([], "https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toMatch(/img\.youtube\.com/);
  });

  it("has nothing for a page with only a video", () => {
    expect(previewFor([{ url: "https://x/v.mp4", kind: "video" }], "https://example.com")).toBeNull();
  });
});
