import { describe, expect, it } from "vitest";
import { classifyDrop, describeSkipped, titleForDropped, wantsDrop } from "../src/core/drop";
import type { DroppedFile } from "../src/core/drop";

const file = (name: string, type = ""): DroppedFile => ({ name, type });

describe("wantsDrop", () => {
  it("takes an interest in files and in web links", () => {
    expect(wantsDrop(["Files"])).toBe(true);
    expect(wantsDrop(["text/uri-list", "text/plain"])).toBe(true);
  });

  it("stays out of the way of a drag carrying only text", () => {
    // Which is what dragging a note out of the file explorer looks like.
    expect(wantsDrop(["text/plain"])).toBe(false);
    expect(wantsDrop([])).toBe(false);
  });
});

describe("classifyDrop", () => {
  it("takes an image by its MIME", () => {
    const plan = classifyDrop([file("shot.png", "image/png")], "");
    expect(plan).toEqual({ kind: "media", files: [file("shot.png", "image/png")], skipped: [] });
  });

  it("takes a video, which is half of what this vault holds", () => {
    const plan = classifyDrop([file("clip.mp4", "video/mp4")], "");
    expect(plan.kind).toBe("media");
  });

  it("falls back to the extension when the source reported no MIME", () => {
    const plan = classifyDrop([file("shot.webp")], "");
    expect(plan.kind).toBe("media");
  });

  it("keeps what it can and reports what it could not", () => {
    const plan = classifyDrop(
      [file("a.png", "image/png"), file("notes.pdf", "application/pdf")],
      ""
    );
    expect(plan).toMatchObject({ kind: "media", skipped: ["notes.pdf"] });
    expect(plan.kind === "media" && plan.files.map((f) => f.name)).toEqual(["a.png"]);
  });

  it("refuses a drop it can do nothing with, naming what was refused", () => {
    const plan = classifyDrop([file("notes.pdf", "application/pdf")], "");
    expect(plan).toEqual({ kind: "unsupported", skipped: ["notes.pdf"] });
  });

  it("prefers files to the text beside them", () => {
    // Finder sends both, the text being the path of the very file it carries,
    // so reading text first would turn every file drop into a failed capture.
    const plan = classifyDrop([file("a.png", "image/png")], "/Users/me/a.png");
    expect(plan.kind).toBe("media");
  });

  it("takes a web link when there are no files", () => {
    expect(classifyDrop([], "https://example.com/post")).toEqual({
      kind: "url",
      url: "https://example.com/post",
    });
  });

  it("reads the first real line of a uri-list, comments and all", () => {
    const plan = classifyDrop([], "# a comment\r\nhttps://example.com/a\r\nhttps://example.com/b");
    expect(plan).toEqual({ kind: "url", url: "https://example.com/a" });
  });

  it("ignores a drag that is neither a file nor a web link", () => {
    // Obsidian's own drags land here, and answering them with a complaint
    // would mean picking a fight over every gesture that crossed the wall.
    expect(classifyDrop([], "Some Note.md").kind).toBe("ignore");
    expect(classifyDrop([], "obsidian://open?vault=Aegis").kind).toBe("ignore");
    expect(classifyDrop([], "/Users/me/notes.txt").kind).toBe("ignore");
    expect(classifyDrop([], "").kind).toBe("ignore");
  });
});

describe("titleForDropped", () => {
  it("uses the file's own name, without the extension", () => {
    expect(titleForDropped("sunset over the bay.jpg")).toBe("sunset over the bay");
  });

  it("keeps every earlier dot", () => {
    expect(titleForDropped("shot.2026.final.png")).toBe("shot.2026.final");
  });

  it("leaves a name with no extension alone", () => {
    expect(titleForDropped("screenshot")).toBe("screenshot");
  });

  it("does not eat a leading dot, which is the whole name", () => {
    expect(titleForDropped(".hidden")).toBe(".hidden");
  });
});

describe("describeSkipped", () => {
  it("names the one file, because which one is the useful part", () => {
    expect(describeSkipped(["notes.pdf"])).toBe("notes.pdf is not a picture or a video");
  });

  it("counts several rather than listing them", () => {
    expect(describeSkipped(["a.pdf", "b.txt", "c.zip"])).toBe(
      "3 files were not pictures or videos"
    );
  });

  it("says nothing when nothing was skipped", () => {
    expect(describeSkipped([])).toBe("");
  });
});
