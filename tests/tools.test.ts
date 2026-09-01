import { describe, expect, it } from "vitest";
import { executableCandidates } from "../src/core/tools";

describe("executableCandidates", () => {
  it("walks PATH directories in order, then the fixed fallbacks", () => {
    const candidates = executableCandidates(
      "yt-dlp",
      { pathVar: "/opt/homebrew/bin:/usr/bin", delimiter: ":", windows: false },
      ["/fallback/yt-dlp"]
    );
    expect(candidates).toEqual([
      "/opt/homebrew/bin/yt-dlp",
      "/usr/bin/yt-dlp",
      "/fallback/yt-dlp",
    ]);
  });

  it("appends .exe on Windows and joins with backslashes", () => {
    const candidates = executableCandidates(
      "yt-dlp",
      { pathVar: "C:\\Tools;D:\\bin", delimiter: ";", windows: true },
      []
    );
    expect(candidates).toEqual(["C:\\Tools\\yt-dlp.exe", "D:\\bin\\yt-dlp.exe"]);
  });

  it("puts an explicit override first and keeps the rest as fallback", () => {
    const candidates = executableCandidates(
      "ffmpeg",
      { pathVar: "/usr/bin", delimiter: ":", windows: false },
      [],
      "/my/own/ffmpeg"
    );
    expect(candidates[0]).toBe("/my/own/ffmpeg");
    expect(candidates).toContain("/usr/bin/ffmpeg");
  });

  it("skips empty PATH segments and trims stray whitespace", () => {
    const candidates = executableCandidates(
      "yt-dlp",
      { pathVar: "::/usr/bin: ", delimiter: ":", windows: false },
      []
    );
    expect(candidates).toEqual(["/usr/bin/yt-dlp"]);
  });

  it("drops a trailing separator from a PATH directory", () => {
    const candidates = executableCandidates(
      "yt-dlp",
      { pathVar: "/usr/bin/", delimiter: ":", windows: false },
      []
    );
    expect(candidates).toEqual(["/usr/bin/yt-dlp"]);
  });
});
