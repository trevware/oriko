import { describe, expect, it } from "vitest";
import { buildNote, buildPastedImageNote } from "../src/resolve";
import type { ResolvedLink } from "../src/resolve";

function link(overrides: Partial<ResolvedLink> = {}): ResolvedLink {
  return {
    url: "https://x.com/eduardwieandt/status/2089380732896768126",
    title: "Eduard: What if you could slide away the input?",
    description: "What if you could slide away the input?\nBuilt a small Swift prototype.",
    author: "Eduard",
    published: "Mon Aug 11 09:00:00 +0000 2026",
    media: [{ url: "https://video.twimg.com/a/38KA2aK29RyqEM5a.mp4?tag=29", kind: "video" }],
    ...overrides,
  };
}

describe("buildNote", () => {
  it("opens with frontmatter carrying the clipper's keys", () => {
    const note = buildNote(link());
    expect(note.startsWith("---\n")).toBe(true);
    for (const key of ["title:", "source:", "author:", "published:", "created:", "description:", "tags:"]) {
      expect(note).toContain(key);
    }
  });

  it("tags the note as a clipping, which is what Clippings.base filters on", () => {
    expect(buildNote(link())).toContain('  - "clippings"');
  });

  it("does not add type, categories or status, leaving it in the parse queue", () => {
    const note = buildNote(link());
    expect(note).not.toContain("type: clipping");
    expect(note).not.toContain("categories:");
    expect(note).not.toContain("status:");
  });

  it("embeds video as a video element the scanner can find", () => {
    expect(buildNote(link())).toContain(
      '<video src="https://video.twimg.com/a/38KA2aK29RyqEM5a.mp4?tag=29" controls=""></video>'
    );
  });

  it("embeds images as markdown", () => {
    const note = buildNote(link({ media: [{ url: "https://cdn/a.jpg", kind: "image" }] }));
    expect(note).toContain("![](https://cdn/a.jpg)");
  });

  it("embeds every resolved item", () => {
    const note = buildNote(
      link({
        media: [
          { url: "https://cdn/a.mp4", kind: "video" },
          { url: "https://cdn/b.jpg", kind: "image" },
        ],
      })
    );
    expect(note).toContain("https://cdn/a.mp4");
    expect(note).toContain("https://cdn/b.jpg");
  });

  it("keeps the source link in the body", () => {
    expect(buildNote(link())).toContain(
      "[https://x.com/eduardwieandt/status/2089380732896768126]"
    );
  });

  it("escapes quotes so the frontmatter still parses", () => {
    const note = buildNote(link({ title: 'He said "hi"' }));
    expect(note).toContain('title: "He said \\"hi\\""');
  });

  it("flattens newlines inside a quoted value", () => {
    const note = buildNote(link({ description: "one\ntwo" }));
    expect(note).toContain('description: "one two"');
  });

  it("omits the author entry when there is no author", () => {
    const note = buildNote(link({ author: "" }));
    expect(note).toContain("author:\npublished:");
  });

  it("leaves published empty rather than inventing a date", () => {
    expect(buildNote(link({ published: "" }))).toContain("published:\n");
  });

  it("writes created as an ISO date", () => {
    expect(buildNote(link())).toMatch(/created: \d{4}-\d{2}-\d{2}/);
  });

  it("includes the description as body text", () => {
    expect(buildNote(link())).toContain("Built a small Swift prototype.");
  });
});

describe("buildPastedImageNote", () => {
  const note = buildPastedImageNote(
    "Pasted image 2026-08-17",
    "Attachments/Clippings/pasted-1.png",
    "2026-08-17"
  );

  it("carries the clipper's frontmatter keys", () => {
    for (const key of ["title:", "source:", "author:", "published:", "created:", "tags:"]) {
      expect(note).toContain(key);
    }
  });

  it("tags it as a clipping", () => {
    expect(note).toContain('  - "clippings"');
  });

  it("points cover at the vault path as a plain string", () => {
    expect(note).toContain('cover: "Attachments/Clippings/pasted-1.png"');
    expect(note).not.toContain("cover:\n  -");
  });

  it("embeds the image so the note renders it too", () => {
    expect(note).toContain("![[Attachments/Clippings/pasted-1.png]]");
  });

  it("leaves it unparsed, so it lands in the queue", () => {
    expect(note).not.toContain("type: clipping");
    expect(note).not.toContain("categories:");
  });
});

describe("buildNote with archived media", () => {
  it("embeds the local file rather than the expiring url", () => {
    const note = buildNote(
      link({
        media: [
          {
            url: "https://scontent.cdninstagram.com/v/a.mp4?oe=6A85",
            kind: "video",
            localPath: "Attachments/Clippings/abc-video.mp4",
          },
        ],
      })
    );
    expect(note).toContain("![[Attachments/Clippings/abc-video.mp4]]");
    expect(note).not.toContain("<video src=");
  });

  it("embeds a local image the same way", () => {
    const note = buildNote(
      link({
        media: [{ url: "https://cdn/a.jpg", kind: "image", localPath: "Attachments/a.jpg" }],
      })
    );
    expect(note).toContain("![[Attachments/a.jpg]]");
  });

  it("keeps the remote url when archiving did not land", () => {
    const note = buildNote(
      link({ media: [{ url: "https://cdn/a.mp4", kind: "video" }] })
    );
    expect(note).toContain('<video src="https://cdn/a.mp4"');
  });

  it("mixes archived and unarchived media in one note", () => {
    const note = buildNote(
      link({
        media: [
          { url: "https://cdn/a.mp4", kind: "video", localPath: "Attachments/a.mp4" },
          { url: "https://cdn/b.jpg", kind: "image" },
        ],
      })
    );
    expect(note).toContain("![[Attachments/a.mp4]]");
    expect(note).toContain("![](https://cdn/b.jpg)");
  });
});
