import { describe, expect, it } from "vitest";
import { scanClipping } from "../src/core/scan";
import { parseFxDetails, xPostOf } from "../src/core/xpost";

const webClipper = scanClipping(
  "Clippings/nadainishi.md",
  {
    title: "なだいにし: そしてなんと！",
    source: "https://x.com/nadainishi/status/2096817665419735487",
    author: ["なだいにし"],
    description: "そしてなんと！\n『ダンダダン』",
  },
  ""
);

describe("xPostOf", () => {
  it("reads the post off the note", () => {
    expect(xPostOf(webClipper)).toEqual({
      site: "x",
      id: "2096817665419735487",
      handle: "nadainishi",
      name: "なだいにし",
      text: "そしてなんと！ 『ダンダダン』",
    });
  });

  it("falls back to the handle for the name, and the title for the words", () => {
    const bare = scanClipping(
      "Clippings/x.md",
      { title: "PERFECTL00P: keep climbing", source: "https://twitter.com/PERFECTL00P/status/2090086481281069566" },
      ""
    );
    expect(xPostOf(bare)).toMatchObject({ name: "PERFECTL00P", text: "keep climbing" });
  });

  it("ignores anything that is not a post", () => {
    expect(xPostOf(scanClipping("a.md", { source: "https://x.com/someone" }, ""))).toBeNull();
    expect(xPostOf(scanClipping("b.md", { source: "https://example.com" }, ""))).toBeNull();
  });
});

describe("parseFxDetails", () => {
  it("takes the avatar, the badge and the likes", () => {
    const json = {
      code: 200,
      tweet: {
        likes: 9472,
        author: { avatar_url: "https://pbs.twimg.com/a.jpg", verification: { verified: true } },
      },
    };
    expect(parseFxDetails(json)).toEqual({
      avatar: "https://pbs.twimg.com/a.jpg",
      verified: true,
      count: 9472,
    });
  });

  it("returns null for a post fxtwitter could not find", () => {
    expect(parseFxDetails({ code: 404, message: "NOT_FOUND" })).toBeNull();
    expect(parseFxDetails(null)).toBeNull();
  });
});
