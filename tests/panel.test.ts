import { describe, expect, it } from "vitest";
import { windowRange } from "../src/core/layout";
import { previewOf } from "../src/core/tile";
import type { TileModel } from "../src/core/tile";

describe("windowRange", () => {
  // 40px rows, an 800px panel: twenty rows fit, and a few either side are
  // built early so a fast scroll does not show empty space.
  const range = (scrollTop: number, count: number) =>
    windowRange({ scrollTop, viewportHeight: 800, rowHeight: 40, count, overscan: 3 });

  it("starts at the top of the list rather than before it", () => {
    expect(range(0, 500).start).toBe(0);
  });

  it("covers the visible rows plus the overscan", () => {
    expect(range(0, 500).end).toBe(23);
  });

  it("follows the scroll", () => {
    expect(range(4000, 500)).toEqual({ start: 97, end: 123 });
  });

  it("stops at the end of the list", () => {
    expect(range(19_600, 500).end).toBe(500);
  });

  it("returns nothing for an empty list", () => {
    expect(range(0, 0)).toEqual({ start: 0, end: 0 });
  });

  it("covers a list shorter than the panel entirely", () => {
    expect(range(0, 5)).toEqual({ start: 0, end: 5 });
  });

  it("refuses to divide by a zero row height", () => {
    expect(windowRange({ scrollTop: 0, viewportHeight: 800, rowHeight: 0, count: 10 })).toEqual({
      start: 0,
      end: 0,
    });
  });

  it("keeps the window a constant size however long the list is", () => {
    const small = range(4000, 500);
    const huge = range(4000, 500_000);
    expect(huge.end - huge.start).toBe(small.end - small.start);
  });
});

function tile(over: Partial<TileModel> = {}): TileModel {
  return {
    id: "Clippings/A.md",
    record: {} as TileModel["record"],
    posterPath: "",
    filePath: "Attachments/Clippings/aaaaaaaaaaaa-one.jpg",
    remote: false,
    kind: "image",
    animated: false,
    width: 100,
    height: 100,
    provisional: false,
    signature: "s",
    ...over,
  };
}

describe("previewOf", () => {
  it("uses the archived image itself when there is no smaller still", () => {
    expect(previewOf(tile())).toEqual({
      path: "Attachments/Clippings/aaaaaaaaaaaa-one.jpg",
      remote: false,
    });
  });

  it("prefers the generated still, which is smaller and holds no motion", () => {
    const gif = tile({
      filePath: "Attachments/Clippings/aaaaaaaaaaaa-one.gif",
      posterPath: "Attachments/Clippings/aaaaaaaaaaaa-one.thumb.webp",
      animated: true,
    });
    expect(previewOf(gif)?.path).toBe("Attachments/Clippings/aaaaaaaaaaaa-one.thumb.webp");
  });

  it("shows a video through its poster, since a row cannot hold a video", () => {
    const video = tile({
      kind: "video",
      filePath: "Attachments/Clippings/aaaaaaaaaaaa-one.mp4",
      posterPath: "Attachments/Clippings/aaaaaaaaaaaa-one.poster.webp",
    });
    expect(previewOf(video)?.path).toBe("Attachments/Clippings/aaaaaaaaaaaa-one.poster.webp");
  });

  it("has nothing to show for a video with no poster", () => {
    expect(previewOf(tile({ kind: "video", posterPath: "" }))).toBeNull();
  });

  it("carries the remote flag, since a remote cover is a url not a vault path", () => {
    const remote = tile({ filePath: "https://cdn.example.com/one.jpg", remote: true });
    expect(previewOf(remote)).toEqual({ path: "https://cdn.example.com/one.jpg", remote: true });
  });
});
