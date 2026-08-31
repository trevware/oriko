import { describe, expect, it } from "vitest";
import { MediaCache } from "../src/core/cache";
import { buildDiagnostics } from "../src/core/diagnose";
import { scanClipping } from "../src/core/scan";
import { buildTiles } from "../src/core/tile";

const onimusha = scanClipping(
  "Clippings/O.md",
  { title: "Onimusha", source: "https://www.youtube.com/watch?v=VK4FwpKMBho", grid: "Gaming" },
  '<video src="https://www.youtube.com/embed/VK4FwpKMBho"></video>\n\n![[Attachments/Clippings/32814825d7a3-maxresdefault.jpg]]\n'
);

function base() {
  return {
    version: "0.0.0",
    platform: "test",
    activeGrid: "Gaming",
    home: "Clippings",
    registered: ["Gaming"],
    records: [onimusha],
    cache: new MediaCache(),
    unloadable: [] as Array<[string, string]>,
    filtered: false,
  };
}

describe("buildDiagnostics", () => {
  it("reports a healthy tile as ok with its cover", () => {
    const report = buildDiagnostics(base());
    expect(report).toContain("1 in this grid, 1 tiled");
    expect(report).toContain('ok: "Clippings/O.md" -> image local Attachments/Clippings/32814825d7a3-maxresdefault.jpg');
  });

  it("names a grid value that fell back to home", () => {
    const report = buildDiagnostics({ ...base(), registered: ["Other"], activeGrid: "Other" });
    expect(report).toContain('FALLBACK: "Clippings/O.md" names unregistered grid "Gaming" -> home');
    expect(report).toContain("0 in this grid");
  });

  it("shows a dropped cover with its media and cache state", () => {
    const signature = buildTiles([onimusha], new MediaCache())[0].signature;
    const report = buildDiagnostics({ ...base(), unloadable: [["Clippings/O.md", signature]] });
    expect(report).toContain('DROPPED: "Clippings/O.md"');
    expect(report).toContain("media video https://www.youtube.com/embed/VK4FwpKMBho [no cache entry]");
    expect(report).toContain("media image Attachments/Clippings/32814825d7a3-maxresdefault.jpg [no cache entry]");
  });

  it("a stale unloadable signature does not hide the tile", () => {
    const report = buildDiagnostics({ ...base(), unloadable: [["Clippings/O.md", "stale"]] });
    expect(report).toContain("ok:");
  });

  it("flags an active ad-hoc filter", () => {
    const report = buildDiagnostics({ ...base(), filtered: true });
    expect(report).toContain("ad-hoc filter is active");
  });
});
